import { N_STATES, BLINDNESS_SOCIETAL_COST_WEIGHT } from "./constants.js";
import {
  phaseForCycle,
  cyclesPerYear,
  normalizeTransitionProbs,
  isOnTreatment,
} from "./utils.js";
import { SUBTYPES, getClinicalTables, getBscTransitionProbs, getInjectionRate } from "./clinical.js";
import { getDrug } from "./drugs.js";
import { getCostPaper } from "./papers/index.js";
import { transportationCostPerVisit } from "./config/transport.js";
import { annualMortalityForAge, DEFAULT_MALE_RATIO } from "./config/mortality.js";
import { getInjections2026MetaForDrug } from "./config/injections-2026-meta.js";

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

function expectedBetterEyeUtility(cohort, fellowDist, pSecond, qaly) {
  const { utilities: u, utilityNone: uNone } = qaly;
  let expected = 0;
  for (let i = 0; i < N_STATES; i++) {
    if (cohort[i] <= 0) continue;
    expected += (1 - pSecond) * cohort[i] * Math.max(u[i], uNone);
    for (let j = 0; j < N_STATES; j++) {
      expected += pSecond * cohort[i] * fellowDist[j] * Math.max(u[i], u[j]);
    }
  }
  return expected;
}

function monthlyIncidencePerCycle(cycleLengthYears, monthlyRate) {
  if (monthlyRate == null) return 0;
  return 1 - Math.pow(1 - monthlyRate, cycleLengthYears * 12);
}

function monitoringCost(yearIndex, regimen, cycleLen, df, paper) {
  const mon = paper.monitoring;
  if (!mon) return 0;
  const table = regimen === "bsc" ? mon.bsc : mon.tae;
  const u = yearIndex === 0 ? table.year1 : table.year2plus;
  const unit = mon.unitCosts;
  const perCycle =
    u.physician * unit.physician +
    u.oct * unit.oct +
    u.slit * unit.slit +
    u.fa * unit.fa;
  return perCycle * cycleLen * df;
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
          entryAge: subtype.meanAge,
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
  let totalCost = 0;
  const trajectory = [];
  const costBreakdown = {
    drugAdmin: 0,
    monitoring: 0,
    adverseEvents: 0,
    societalCare: 0,
    physicianVisit: 0,
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

    const annualInj = onTreatment
      ? getInjectionRate(
          clinicalCase,
          injections,
          subtypeId,
          drugId,
          clinicalKey,
          phase
        )
      : 0;
    const injThisCycle = annualInj * cycleLen;
    const cohort = dist.map((s) => s * aliveMass);

    if (qaly) {
      totalQALY +=
        expectedBetterEyeUtility(cohort, fellowDist, pSecond, qaly) *
        cycleLen *
        df;
    }

    if (onTreatment) {
      const admin = drugAdminCost(drugId, injThisCycle, aliveMass, df, paper);
      if (!admin.missing) {
        costBreakdown.drugAdmin += admin.cost;
        totalCost += admin.cost;
      }

      const ae = adverseEventCost(
        injThisCycle * aliveMass,
        df,
        modelParams.adverseEvents,
        modelParams.includeScenarioAe
      );
      costBreakdown.adverseEvents += ae;
      totalCost += ae;
    }

    const mon = monitoringCost(
      yearIndex,
      onTreatment ? drug.monitoringRegimen : "bsc",
      cycleLen,
      df,
      paper
    );
    costBreakdown.monitoring += mon * aliveMass;
    totalCost += mon * aliveMass;

    const { care, visit } = societalCosts(
      cohort,
      pSecond,
      cycleLen,
      df,
      { societal: societalPaper }
    );
    costBreakdown.societalCare += care;
    costBreakdown.physicianVisit += visit;
    totalCost += care + visit;

    if (c % cpy === 0) {
      trajectory.push({
        year: c * cycleLen,
        none: ((cohort[0] / Math.max(aliveMass, 1e-9)) * 100).toFixed(1),
        mild: ((cohort[1] / Math.max(aliveMass, 1e-9)) * 100).toFixed(1),
        moderate: ((cohort[2] / Math.max(aliveMass, 1e-9)) * 100).toFixed(1),
        severe: ((cohort[3] / Math.max(aliveMass, 1e-9)) * 100).toFixed(1),
        blind: ((cohort[4] / Math.max(aliveMass, 1e-9)) * 100).toFixed(1),
        bothEyes: (pSecond * 100).toFixed(1),
        alive: (aliveMass * 100).toFixed(1),
        cumQALY: qaly ? totalQALY.toFixed(3) : null,
        cumCost: Math.round(totalCost),
      });
    }

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
      const annualRate = mort.useLifeTable
        ? annualMortalityForAge(currentAge, { maleRatio: mort.maleRatio })
        : annualMortalityForAge(currentAge, {
            useLifeTable: false,
            fixedRate: mort.fixedRate,
            maleRatio: mort.maleRatio,
          });
      const m = annualRate * cycleLen;
      const blindExtra = (mort.blindMortalityHr - 1) * m;
      aliveMass = Math.max(0, aliveMass - aliveMass * (m + dist[4] * blindExtra));
    }

    dist = applyTransition(dist, probs);
    fellowDist = applyTransition(fellowDist, probs);
  }

  return {
    drugId,
    totalQALY: qaly ? totalQALY : null,
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
