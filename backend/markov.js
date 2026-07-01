import { N_STATES, BLINDNESS_SOCIETAL_COST_WEIGHT } from "./constants.js";
import {
  phaseForCycle,
  cyclesPerYear,
  normalizeTransitionProbs,
  isOnTreatment,
} from "./utils.js";
import { SUBTYPES, getClinicalTables, getBscTransitionProbs, injectionsForCycle } from "./clinical.js";
import { getDrug } from "./drugs.js";
import { getCostPaper } from "./papers/index.js";
import { transportationCostPerVisit } from "./config/transport.js";
import { cycleDeathProbability, DEFAULT_MALE_RATIO, analysisHorizonYears, remainingLifeExpectancy } from "./config/mortality.js";
import { getInjections2026MetaForDrug } from "./config/injections-2026-meta.js";
import {
  expectedBetterEyeUtility,
  qalyForCycle,
} from "./qaly.js";

function applyTransition(dist, probs) {
  const next = [0, 0, 0, 0, 0];
  for (let i = 0; i < N_STATES; i++) {
    const s = dist[i];
    if (s <= 0) continue;
    next[Math.min(N_STATES - 1, i + 2)] += s * probs.imp2;
    next[Math.min(N_STATES - 1, i + 1)] += s * probs.imp1;
    next[i] += s * probs.remain;
    next[Math.max(0, i - 1)] += s * probs.wors1;
    next[Math.max(0, i - 2)] += s * probs.wors2;
  }
  return next;
}

function monthlyIncidencePerCycle(cycleLengthYears, monthlyRate) {
  if (monthlyRate == null) return 0;
  return 1 - Math.pow(1 - monthlyRate, cycleLengthYears * 12);
}

function monitoringCostPerYear(yearIndex, regimen, paper) {
  const mon = paper.monitoring;
  if (!mon) return 0;
  const table = regimen === "bsc" ? mon.bsc : mon.tae;
  const u = yearIndex === 0 ? table.year1 : table.year2plus;
  const unit = mon.unitCosts;
  return (
    u.physician * unit.physician +
    u.oct * unit.oct +
    u.slit * unit.slit +
    u.fa * unit.fa
  );
}

function computeCycleCosts({
  drugId,
  drug,
  paper,
  societalPaper,
  cohort,
  aliveMass,
  pSecond,
  yearIndex,
  onTreatment,
  injThisCycle,
  cycleLen,
  df,
  modelParams,
}) {
  const out = {
    drugAdmin: 0,
    monitoring: 0,
    adverseEvents: 0,
    societalCare: 0,
    physicianVisit: 0,
    total: 0,
  };
  if (aliveMass <= 0) return out;

  if (onTreatment) {
    const admin = drugAdminCost(drugId, injThisCycle, aliveMass, 1, paper);
    if (!admin.missing) out.drugAdmin = admin.cost * df;

    out.adverseEvents =
      adverseEventCost(
        injThisCycle * aliveMass,
        1,
        modelParams.adverseEvents,
        modelParams.includeScenarioAe
      ) * df;
  }

  const monAnnual = monitoringCostPerYear(
    yearIndex,
    onTreatment ? drug.monitoringRegimen : "bsc",
    paper
  );
  out.monitoring = monAnnual * cycleLen * aliveMass * df;

  const { care, visit } = societalCosts(cohort, pSecond, cycleLen, 1, {
    societal: societalPaper,
  });
  out.societalCare = care * df;
  out.physicianVisit = visit * df;

  out.total =
    out.drugAdmin +
    out.monitoring +
    out.adverseEvents +
    out.societalCare +
    out.physicianVisit;
  return out;
}

function addHalfCycleCosts(target, start, end) {
  target.drugAdmin += (start.drugAdmin + end.drugAdmin) / 2;
  target.monitoring += (start.monitoring + end.monitoring) / 2;
  target.adverseEvents += (start.adverseEvents + end.adverseEvents) / 2;
  target.societalCare += (start.societalCare + end.societalCare) / 2;
  target.physicianVisit += (start.physicianVisit + end.physicianVisit) / 2;
  return (start.total + end.total) / 2;
}

function drugAdminCost(drugId, injCount, aliveMass, df, paper) {
  const price = paper.drugPrices[drugId];
  if (price == null) return { cost: 0, missing: true };
  let perInj;
  if (paper.administrationBundled) {
    perInj = price + (paper.administrationPerInjection ?? 0);
  } else {
    perInj = price + (paper.injectionFee ?? 0);
  }
  return { cost: perInj * injCount * aliveMass * df, missing: false };
}

function adverseEventCost(injCount, df, adverseEvents, includeScenarioAe) {
  if (!adverseEvents?.length) return 0;
  let perInj = 0;
  for (const ae of adverseEvents) {
    if (ae.scenarioOnly && !includeScenarioAe) continue;
    perInj += (ae.rate ?? 0) * (ae.unitCost ?? 0);
  }
  return perInj * injCount * df;
}

function societalCosts(cohort, pBoth, cycleLen, df, paper) {
  const soc = paper.societal;
  if (!soc) return { care: 0, visit: 0 };
  const transport = soc.transport
    ? transportationCostPerVisit(soc.transport)
    : soc.transportationPerVisit ?? 0;
  const visitAnnual = soc.dailyWage + transport;
  let care = 0;
  let visit = 0;
  for (let i = 0; i < N_STATES; i++) {
    const w = BLINDNESS_SOCIETAL_COST_WEIGHT[i] ?? 1;
    const annualCare =
      w *
      (pBoth * soc.dailyCareBoth[i] + (1 - pBoth) * soc.dailyCareSingle[i]);
    care += cohort[i] * annualCare * cycleLen * df;
    const annualVisit =
      w *
      ((1 - pBoth) * (soc.physicianVisitSingle[i] ? visitAnnual : 0) +
        pBoth * (soc.physicianVisitBoth[i] ? visitAnnual : 0));
    visit += cohort[i] * annualVisit * cycleLen * df;
  }
  return { care, visit };
}

/**
 * @param {object} input
 * @param {string} input.drugId
 * @param {string} input.subtypeId
 * @param {string} input.costPaperId
 * @param {'base'|'scenario'|'2026_meta'} input.clinicalCase
 * @param {{timeHorizonYears,cycleLengthYears,discountRate}} input.horizon
 * @param {number|null} [input.treatmentDurationYears] — null=生涯治療、2/5=その年数後にBSC
 * @param {object|null} input.modelParams — utilities, mortality, etc.
 */
export function runMarkov(input) {
  const {
    drugId,
    subtypeId,
    costPaperId,
    clinicalCase = "base",
    horizon,
    treatmentDurationYears = null,
    modelParams = {},
  } = input;

  const drug = getDrug(drugId);
  const subtype = SUBTYPES[subtypeId];
  const paper = getCostPaper(costPaperId);
  const { transitions, injections } = getClinicalTables(clinicalCase);
  const clinicalKey = drug.clinicalKey;

  const cycleLen = horizon.cycleLengthYears;
  const cpy = cyclesPerYear(cycleLen);
  const cycles = Math.round(horizon.timeHorizonYears / cycleLen);
  const disc = horizon.discountRate * cycleLen;

  const qaly =
    modelParams.utilities && modelParams.utilityNone != null
      ? {
          utilities: modelParams.utilities,
          utilityNone: modelParams.utilityNone,
        }
      : null;

  const useLifeTable =
    modelParams.useAgeSpecificMortality !== false &&
    modelParams.annualMortality == null;
  const mort =
    modelParams.blindMortalityHr != null
      ? {
          blindMortalityHr: modelParams.blindMortalityHr,
          useLifeTable,
          fixedRate: modelParams.annualMortality ?? null,
          maleRatio: modelParams.maleRatio ?? DEFAULT_MALE_RATIO,
          entryAge: modelParams.entryAge ?? subtype.meanAge,
        }
      : null;

  const warnings = [];
  if (drug.clinicalNote) warnings.push(drug.clinicalNote);
  if (clinicalCase === "2026_meta" && !getInjections2026MetaForDrug(drugId)) {
    warnings.push(`${drug.name}: 2026 meta 注射回数が未設定`);
  }
  if (!transitions[subtypeId]?.[clinicalKey]) {
    return {
      drugId,
      incomplete: true,
      reason: `臨床データなし: ${subtypeId} × ${clinicalKey}`,
      warnings,
    };
  }

  const drugPrice = paper.drugPrices[drugId];
  if (drugPrice == null) {
    warnings.push(`コスト論文に ${drug.name} の薬価がありません`);
  }
  const societalPaper =
    paper.societal ?? getCostPaper("paper2_rbz").societal;
  if (!paper.societal && costPaperId === "paper1_faricimab") {
    warnings.push(
      "論文1: 社会的費用は論文2 Table S11 を暫定適用（介護・訪問）"
    );
  }

  let aliveMass = 1;
  let dist = [...subtype.treatedInitial];
  let fellowDist = [...subtype.fellowInitial];
  let pSecond = subtype.bothEyesBaseline;

  let totalQALY = 0;
  let totalLifeYears = 0;
  let totalCost = 0;
  const trajectory = [];
  const costBreakdown = {
    drugAdmin: 0,
    monitoring: 0,
    adverseEvents: 0,
    societalCare: 0,
    physicianVisit: 0,
  };

  const injContext = {
    clinicalCase,
    injections,
    subtypeId,
    drugId,
    clinicalKey,
    treatmentDurationYears,
    cycleLengthYears: cycleLen,
  };

  for (let c = 0; c < cycles; c++) {
    const df = Math.pow(1 + disc, -c);
    const yearIndex = Math.min(
      Math.floor(c / cpy),
      horizon.timeHorizonYears - 1
    );
    const phase = phaseForCycle(c, cycleLen);
    const onTreatment = isOnTreatment(c, cycleLen, treatmentDurationYears);
    const treatedProbs = transitions[subtypeId][clinicalKey][phase];
    const probs = onTreatment
      ? normalizeTransitionProbs(treatedProbs)
      : getBscTransitionProbs(transitions, subtypeId, phase) ??
        normalizeTransitionProbs(treatedProbs);

    const injThisCycle = onTreatment
      ? injectionsForCycle(c, injContext)
      : 0;
    const cohort = dist.map((s) => s * aliveMass);
    const utilityStart = qaly
      ? expectedBetterEyeUtility(cohort, fellowDist, pSecond, qaly)
      : 0;
    const aliveStart = aliveMass;

    const costStart = computeCycleCosts({
      drugId,
      drug,
      paper,
      societalPaper,
      cohort,
      aliveMass: aliveStart,
      pSecond,
      yearIndex,
      onTreatment,
      injThisCycle,
      cycleLen,
      df,
      modelParams,
    });

    const pNew =
      (1 - pSecond) *
      monthlyIncidencePerCycle(cycleLen, modelParams.secondEyeMonthlyIncidence);
    if (pNew > 0) {
      const oldP = pSecond;
      pSecond = Math.min(1, pSecond + pNew);
      fellowDist = fellowDist.map(
        (s, i) => (oldP * s + pNew * subtype.treatedInitial[i]) / pSecond
      );
    }

    if (mort) {
      const currentAge = Math.min(105, mort.entryAge + c * cycleLen);
      const fixedRate = mort.useLifeTable ? null : mort.fixedRate;
      let deathProb = cycleDeathProbability(currentAge, cycleLen, {
        maleRatio: mort.maleRatio,
        fixedRate,
      });
      deathProb *= 1 + dist[4] * (mort.blindMortalityHr - 1);
      deathProb = Math.min(1, Math.max(0, deathProb));
      aliveMass = Math.max(0, aliveMass * (1 - deathProb));
    }

    dist = applyTransition(dist, probs);
    fellowDist = applyTransition(fellowDist, probs);

    const aliveEnd = aliveMass;
    const cohortEnd = dist.map((s) => s * aliveMass);

    const costEnd = computeCycleCosts({
      drugId,
      drug,
      paper,
      societalPaper,
      cohort: cohortEnd,
      aliveMass: aliveEnd,
      pSecond,
      yearIndex,
      onTreatment,
      injThisCycle,
      cycleLen,
      df,
      modelParams,
    });

    totalCost += addHalfCycleCosts(costBreakdown, costStart, costEnd);
    totalLifeYears += ((aliveStart + aliveEnd) / 2) * cycleLen;

    if (qaly) {
      const utilityEnd = expectedBetterEyeUtility(
        cohortEnd,
        fellowDist,
        pSecond,
        qaly
      );
      totalQALY += qalyForCycle(utilityStart, utilityEnd, cycleLen, df);
    }

    const yearComplete = (c + 1) % cpy === 0;
    if (yearComplete || c === cycles - 1) {
      trajectory.push({
        year: (c + 1) * cycleLen,
        none: ((cohortEnd[0] / Math.max(aliveMass, 1e-9)) * 100).toFixed(1),
        mild: ((cohortEnd[1] / Math.max(aliveMass, 1e-9)) * 100).toFixed(1),
        moderate: ((cohortEnd[2] / Math.max(aliveMass, 1e-9)) * 100).toFixed(1),
        severe: ((cohortEnd[3] / Math.max(aliveMass, 1e-9)) * 100).toFixed(1),
        blind: ((cohortEnd[4] / Math.max(aliveMass, 1e-9)) * 100).toFixed(1),
        bothEyes: (pSecond * 100).toFixed(1),
        alive: (aliveMass * 100).toFixed(1),
        cumQALY: qaly ? totalQALY.toFixed(3) : null,
        cumCost: Math.round(totalCost),
      });
    }
  }

  return {
    drugId,
    totalQALY: qaly ? totalQALY : null,
    totalLifeYears: mort ? totalLifeYears : null,
    totalCost,
    trajectory,
    costBreakdown,
    incomplete: !qaly || drugPrice == null,
    reason: !qaly
      ? "効用パラメータ未設定"
      : drugPrice == null
        ? "薬価未設定"
        : null,
    warnings,
    costPaperId,
    clinicalCase,
    subtypeId,
    treatmentDurationYears,
  };
}
