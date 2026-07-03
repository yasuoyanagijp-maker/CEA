import { N_STATES, BLINDNESS_SOCIETAL_COST_WEIGHT } from "./constants.js";
import {
  phaseForCycle,
  cyclesPerYear,
  normalizeTransitionProbs,
  isOnTreatment,
} from "./utils.js";
import { SUBTYPES, getClinicalDataset } from "./clinical.js";
import { getDrug } from "./drugs.js";
import { getCostPaper } from "./papers/index.js";
import { transportationCostPerVisit } from "./config/transport.js";
import { annualMortalityForAge, DEFAULT_MALE_RATIO } from "./config/mortality.js";

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

/* ------------------------------------------------------------------ */
/* 1. 入力解決層 — カタログ・論文・データセット・フォールバックの解決 */
/* ------------------------------------------------------------------ */

/**
 * runMarkov の入力を計算可能なパラメータ一式に解決する。
 * フォールバック(論文1 → 論文2 社会的費用)と警告の確定もここで行い、
 * シミュレーション・集計層には解決済みの値のみを渡す。
 */
function resolveRunInputs(input) {
  const {
    drugId,
    subtypeId,
    costPaperId,
    clinicalCase = "base",
    modelParams = {},
  } = input;

  const drug = getDrug(drugId);
  const subtype = SUBTYPES[subtypeId];
  const paper = getCostPaper(costPaperId);
  const dataset = getClinicalDataset(clinicalCase);
  const clinicalKey = drug.clinicalKey;

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
  if (
    dataset.missingInjectionsWarning &&
    !dataset.hasInjections(drugId, subtypeId, clinicalKey)
  ) {
    warnings.push(dataset.missingInjectionsWarning(drug.name));
  }
  if (!dataset.hasTransitions(subtypeId, clinicalKey)) {
    return {
      error: {
        drugId,
        incomplete: true,
        reason: `臨床データなし: ${subtypeId} × ${clinicalKey}`,
        warnings,
      },
    };
  }

  const drugPrice = paper.drugPrices[drugId];
  if (drugPrice == null) {
    warnings.push(`コスト論文に ${drug.name} の薬価がありません`);
  }
  const societalPaper = paper.societal ?? getCostPaper("paper2_rbz").societal;
  if (!paper.societal && costPaperId === "paper1_faricimab") {
    warnings.push(
      "論文1: 社会的費用は論文2 Table S11 を暫定適用（介護・訪問）"
    );
  }

  return {
    drug,
    drugId,
    subtype,
    subtypeId,
    paper,
    dataset,
    clinicalKey,
    qaly,
    mort,
    drugPrice,
    societalPaper,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* 2. コホートシミュレーション層 — 純粋な状態遷移(コストと無関係)     */
/* ------------------------------------------------------------------ */

/**
 * Markov コホートを走らせ、サイクルごとの状態スナップショットを返す。
 * QALY・コストの計算は行わない。
 *
 * @returns {Array<{
 *   cycle: number, df: number, yearIndex: number, phase: string,
 *   onTreatment: boolean, annualInj: number, injThisCycle: number,
 *   cohort: number[], fellowDist: number[], pSecond: number, aliveMass: number,
 * }>}
 */
function simulateCohort(resolved, horizon, treatmentDurationYears, modelParams) {
  const { subtype, subtypeId, drugId, clinicalKey, dataset, mort } = resolved;

  const cycleLen = horizon.cycleLengthYears;
  const cpy = cyclesPerYear(cycleLen);
  const cycles = Math.round(horizon.timeHorizonYears / cycleLen);
  const disc = horizon.discountRate * cycleLen;

  let aliveMass = 1;
  let dist = [...subtype.treatedInitial];
  let fellowDist = [...subtype.fellowInitial];
  let pSecond = subtype.bothEyesBaseline;

  const series = [];

  for (let c = 0; c < cycles; c++) {
    const df = Math.pow(1 + disc, -c);
    const yearIndex = Math.min(
      Math.floor(c / cpy),
      horizon.timeHorizonYears - 1
    );
    const phase = phaseForCycle(c, cycleLen);
    const onTreatment = isOnTreatment(c, cycleLen, treatmentDurationYears);
    const treatedProbs = dataset.getTransitions(subtypeId, clinicalKey, phase);
    const probs = onTreatment
      ? normalizeTransitionProbs(treatedProbs)
      : dataset.getBscTransitions(subtypeId, phase) ??
        normalizeTransitionProbs(treatedProbs);

    const annualInj = onTreatment
      ? dataset.getAnnualInjections({ subtypeId, drugId, clinicalKey, phase })
      : 0;
    const injThisCycle = annualInj * cycleLen;
    const cohort = dist.map((s) => s * aliveMass);

    series.push({
      cycle: c,
      df,
      yearIndex,
      phase,
      onTreatment,
      annualInj,
      injThisCycle,
      cohort,
      fellowDist: [...fellowDist],
      pSecond,
      aliveMass,
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

  return series;
}

/* ------------------------------------------------------------------ */
/* 3. 集計層 — シミュレーション系列に QALY・コストを適用              */
/* ------------------------------------------------------------------ */

/** @returns {{ total: number, perCycle: number[] }} 割引済み QALY */
function accumulateQaly(series, qaly, cycleLen) {
  const perCycle = series.map((s) =>
    expectedBetterEyeUtility(s.cohort, s.fellowDist, s.pSecond, qaly) *
    cycleLen *
    s.df
  );
  return { total: perCycle.reduce((a, b) => a + b, 0), perCycle };
}

/**
 * @returns {{
 *   total: number, perCycle: number[],
 *   breakdown: { drugAdmin, monitoring, adverseEvents, societalCare, physicianVisit },
 * }} 割引済みコスト(円)
 */
function accumulateCosts(series, resolved, modelParams, cycleLen) {
  const { drug, drugId, paper, societalPaper } = resolved;
  const breakdown = {
    drugAdmin: 0,
    monitoring: 0,
    adverseEvents: 0,
    societalCare: 0,
    physicianVisit: 0,
  };
  const perCycle = [];

  for (const s of series) {
    let cost = 0;

    if (s.onTreatment) {
      const admin = drugAdminCost(drugId, s.injThisCycle, s.aliveMass, s.df, paper);
      if (!admin.missing) {
        breakdown.drugAdmin += admin.cost;
        cost += admin.cost;
      }

      const ae = adverseEventCost(
        s.injThisCycle * s.aliveMass,
        s.df,
        modelParams.adverseEvents,
        modelParams.includeScenarioAe
      );
      breakdown.adverseEvents += ae;
      cost += ae;
    }

    const mon =
      monitoringCost(
        s.yearIndex,
        s.onTreatment ? drug.monitoringRegimen : "bsc",
        cycleLen,
        s.df,
        paper
      ) * s.aliveMass;
    breakdown.monitoring += mon;
    cost += mon;

    const { care, visit } = societalCosts(
      s.cohort,
      s.pSecond,
      cycleLen,
      s.df,
      { societal: societalPaper }
    );
    breakdown.societalCare += care;
    breakdown.physicianVisit += visit;
    cost += care + visit;

    perCycle.push(cost);
  }

  return {
    total: perCycle.reduce((a, b) => a + b, 0),
    perCycle,
    breakdown,
  };
}

/** 年次スナップショット(UI の推移チャート用) */
function buildTrajectory(series, qalyPerCycle, costPerCycle, cycleLen) {
  const cpy = cyclesPerYear(cycleLen);
  const trajectory = [];
  let cumQALY = 0;
  let cumCost = 0;

  series.forEach((s, i) => {
    if (qalyPerCycle) cumQALY += qalyPerCycle[i];
    cumCost += costPerCycle[i];
    if (s.cycle % cpy !== 0) return;
    const alive = Math.max(s.aliveMass, 1e-9);
    trajectory.push({
      year: s.cycle * cycleLen,
      none: ((s.cohort[0] / alive) * 100).toFixed(1),
      mild: ((s.cohort[1] / alive) * 100).toFixed(1),
      moderate: ((s.cohort[2] / alive) * 100).toFixed(1),
      severe: ((s.cohort[3] / alive) * 100).toFixed(1),
      blind: ((s.cohort[4] / alive) * 100).toFixed(1),
      bothEyes: (s.pSecond * 100).toFixed(1),
      alive: (s.aliveMass * 100).toFixed(1),
      cumQALY: qalyPerCycle ? cumQALY.toFixed(3) : null,
      cumCost: Math.round(cumCost),
    });
  });

  return trajectory;
}

/* ------------------------------------------------------------------ */
/* 合成 — runMarkov                                                    */
/* ------------------------------------------------------------------ */

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
    horizon,
    clinicalCase = "base",
    treatmentDurationYears = null,
    modelParams = {},
  } = input;

  const resolved = resolveRunInputs(input);
  if (resolved.error) return resolved.error;

  const cycleLen = horizon.cycleLengthYears;
  const series = simulateCohort(
    resolved,
    horizon,
    treatmentDurationYears,
    modelParams
  );

  const qalyResult = resolved.qaly
    ? accumulateQaly(series, resolved.qaly, cycleLen)
    : null;
  const costResult = accumulateCosts(series, resolved, modelParams, cycleLen);
  const trajectory = buildTrajectory(
    series,
    qalyResult?.perCycle ?? null,
    costResult.perCycle,
    cycleLen
  );

  return {
    drugId,
    totalQALY: qalyResult ? qalyResult.total : null,
    totalCost: costResult.total,
    trajectory,
    costBreakdown: costResult.breakdown,
    incomplete: !resolved.qaly || resolved.drugPrice == null,
    reason: !resolved.qaly
      ? "効用パラメータ未設定"
      : resolved.drugPrice == null
        ? "薬価未設定"
        : null,
    warnings: resolved.warnings,
    costPaperId: input.costPaperId,
    clinicalCase,
    subtypeId: input.subtypeId,
    treatmentDurationYears,
  };
}
