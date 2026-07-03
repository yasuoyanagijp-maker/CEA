/**
 * 個別患者マイクロシミュレーション
 * — 年齢・性別・病型を指定し、月次で直接医療費・患者負担（高額療養費）を算出
 *
 * 薬剤比較時は drugId ごとに注射回数を算出（遷移 S5 は transitionKey、注射 S6 は薬剤×病型）。
 * コスト用タイムラインは transitionKey 中最長生存経路（同一 seed）を共用。
 */

import { N_STATES } from "./constants.js";
import {
  phaseForCycle,
  normalizeTransitionProbs,
  isOnTreatment,
} from "./utils.js";
import {
  SUBTYPES,
  getClinicalTables,
  getBscTransitionProbs,
  injectionsForMonth,
} from "./clinical.js";
import { getDrug, DRUG_CATALOG, DRUG_IDS, getDrugTransitionKey, sortByDrugDisplayOrder } from "./drugs.js";
import { getCostPaper } from "./papers/index.js";
import { computeMonthlyPatientOop } from "./config/japan-nhi.js";
import { cycleDeathProbability, analysisHorizonYears, remainingLifeExpectancy } from "./config/mortality.js";
import { distributionFromMeanBcva, isMarkovDefaultBcva, getMarkovBaselineBcva } from "./config/baseline-characteristics.js";
import { computeQalyFromClinicalPath } from "./qaly.js";
import { DEFAULT_HORIZON } from "./constants.js";

/** Mulberry32 決定論的 RNG */
export function createRng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleCategorical(probs, rng) {
  const u = rng();
  let cum = 0;
  for (let i = 0; i < probs.length; i++) {
    cum += probs[i];
    if (u < cum) return i;
  }
  return probs.length - 1;
}

function quarterlyToMonthly(probs) {
  const scale = (p) => (p <= 0 ? 0 : 1 - Math.pow(1 - p, 1 / 3));
  return normalizeTransitionProbs({
    imp2: scale(probs.imp2),
    imp1: scale(probs.imp1),
    remain: scale(probs.remain),
    wors1: scale(probs.wors1),
    wors2: scale(probs.wors2),
  });
}

function transitionProbsToArray(probs) {
  return [probs.wors2, probs.wors1, probs.remain, probs.imp1, probs.imp2];
}

function sampleTransition(state, probs, rng) {
  const arr = transitionProbsToArray(probs);
  const offset = 2;
  const outcomes = [];
  for (let d = -2; d <= 2; d++) {
    const idx = d + offset;
    if (arr[idx] > 0) {
      outcomes.push({
        next: Math.max(0, Math.min(N_STATES - 1, state + d)),
        p: arr[idx],
      });
    }
  }
  const u = rng();
  let cum = 0;
  for (const o of outcomes) {
    cum += o.p;
    if (u < cum) return o.next;
  }
  return state;
}

/** 個別患者: 余命に基づく解析期間（設定上限内） */
function patientEffectiveHorizon(entryAge, sex, configuredHorizonYears) {
  return analysisHorizonYears(entryAge, configuredHorizonYears, {
    sex,
    useLifeExpectancyCap: true,
  });
}

/** 患眼・対側眼 BCVA — Markov デフォルト時は Table S2、それ以外は BCVA から分布を導出 */
export function resolvePatientVisionBaseline(subtypeId, patientBaseline = {}) {
  const subtype = SUBTYPES[subtypeId];
  const markovDefault = getMarkovBaselineBcva(subtypeId);
  const baselineBcvaAffected =
    patientBaseline.baselineBcvaAffected ?? markovDefault.baselineBcvaAffected;
  const baselineBcvaFellow =
    patientBaseline.baselineBcvaFellow ?? markovDefault.baselineBcvaFellow;
  const useTableS2 = isMarkovDefaultBcva(
    subtypeId,
    baselineBcvaAffected,
    baselineBcvaFellow
  );
  return {
    baselineBcvaAffected,
    baselineBcvaFellow,
    treatedInitialDist: useTableS2
      ? subtype.treatedInitial
      : distributionFromMeanBcva(baselineBcvaAffected),
    fellowInitialDist: useTableS2
      ? subtype.fellowInitial
      : distributionFromMeanBcva(baselineBcvaFellow),
    bothEyesBaseline: subtype.bothEyesBaseline,
    initialDistributionSource: useTableS2 ? "Table S2 (Markov base)" : "BCVA-derived",
  };
}

function computePatientPathQaly(path, input) {
  return computeQalyFromClinicalPath(path, {
    modelParams: input.modelParams ?? {},
    discountRate: input.discountRate ?? DEFAULT_HORIZON.discountRate,
    cycleLengthYears: input.cycleLengthYears ?? DEFAULT_HORIZON.cycleLengthYears,
  });
}

function monthlyMortality(age, sex, blind, blindHr, useLifeTable, fixedRate) {
  let deathProb = cycleDeathProbability(age, 1 / 12, {
    sex,
    fixedRate: useLifeTable && fixedRate == null ? null : (fixedRate ?? null),
  });
  if (blind && blindHr > 1) deathProb = Math.min(1, deathProb * blindHr);
  return deathProb;
}

function perInjectionCost(drugId, paper) {
  const price = paper.drugPrices[drugId];
  if (price == null) return null;
  if (paper.administrationBundled) {
    return price + (paper.administrationPerInjection ?? 0);
  }
  return price + (paper.injectionFee ?? 0);
}

function monthlyMonitoringCost(yearIndex, regimen, paper) {
  const mon = paper.monitoring;
  if (!mon) return 0;
  const table = regimen === "bsc" ? mon.bsc : mon.tae;
  const u = yearIndex === 0 ? table.year1 : table.year2plus;
  const unit = mon.unitCosts;
  const annual =
    u.physician * unit.physician +
    u.oct * unit.oct +
    u.slit * unit.slit +
    u.fa * unit.fa;
  return annual / 12;
}

function perInjectionAeCost(adverseEvents, includeScenarioAe) {
  if (!adverseEvents?.length) return 0;
  let sum = 0;
  for (const ae of adverseEvents) {
    if (ae.scenarioOnly && !includeScenarioAe) continue;
    sum += (ae.rate ?? 0) * (ae.unitCost ?? 0);
  }
  return sum;
}

function phaseForMonth(monthIndex) {
  return phaseForCycle(Math.floor(monthIndex / 3), 0.25);
}

function onTreatmentForMonth(monthIndex, treatmentDurationYears) {
  return isOnTreatment(Math.floor(monthIndex / 3), 0.25, treatmentDurationYears);
}

function getTransitionProbs(transitions, subtypeId, clinicalKey, phase, onTreatment) {
  const treatedRaw = transitions[subtypeId][clinicalKey][phase];
  const raw = onTreatment
    ? normalizeTransitionProbs(treatedRaw)
    : getBscTransitionProbs(transitions, subtypeId, phase) ??
      normalizeTransitionProbs(treatedRaw);
  return quarterlyToMonthly(raw);
}

/**
 * transitionKey 単位で臨床経路を1本生成（最長生存タイムライン決定用）
 */
function simulateClinicalPath({
  entryAge,
  sex,
  subtypeId,
  transitionKey,
  clinicalCase,
  timeHorizonYears,
  treatmentDurationYears,
  modelParams,
  patientBaseline,
  rng,
}) {
  const subtype = SUBTYPES[subtypeId];
  const { transitions } = getClinicalTables(clinicalCase);
  const vision = resolvePatientVisionBaseline(subtypeId, patientBaseline);

  const useLifeTable =
    modelParams.useAgeSpecificMortality !== false && modelParams.annualMortality == null;
  const blindHr = modelParams.blindMortalityHr ?? 1.4;
  const fixedMort = modelParams.annualMortality ?? null;
  const secondEyeMonthly = modelParams.secondEyeMonthlyIncidence ?? 0.008;

  if (!transitions[subtypeId]?.[transitionKey]) return null;

  let treatedState = sampleCategorical(vision.treatedInitialDist, rng);
  let fellowState = sampleCategorical(vision.fellowInitialDist, rng);
  let secondEye = rng() < vision.bothEyesBaseline;

  const months = [];
  const maxMonths = Math.round(timeHorizonYears * 12);

  for (let month = 0; month < maxMonths; month++) {
    const age = entryAge + month / 12;
    const yearIndex = Math.floor(month / 12);
    const phase = phaseForMonth(month);
    const onTreatment = onTreatmentForMonth(month, treatmentDurationYears);
    const probs = getTransitionProbs(
      transitions,
      subtypeId,
      transitionKey,
      phase,
      onTreatment
    );

    const startTreated = treatedState;
    const startFellow = fellowState;
    const startSecondEye = secondEye;

    months.push({
      month,
      yearIndex,
      age,
      phase,
      onTreatment,
      treatedState: startTreated,
      fellowState: startFellow,
      secondEye: startSecondEye,
    });

    if (!secondEye && secondEyeMonthly > 0 && rng() < secondEyeMonthly) {
      secondEye = true;
      fellowState = sampleCategorical(vision.treatedInitialDist, rng);
    }

    treatedState = sampleTransition(treatedState, probs, rng);
    fellowState = sampleTransition(fellowState, probs, rng);

    months[months.length - 1].endTreatedState = treatedState;
    months[months.length - 1].endFellowState = fellowState;
    months[months.length - 1].endSecondEye = secondEye;

    const blind = treatedState === N_STATES - 1;
    const m = monthlyMortality(age, sex, blind, blindHr, useLifeTable, fixedMort);
    if (rng() < m) {
      return { months, deathMonth: month, alive: false, visionBaseline: vision };
    }
  }

  return { months, deathMonth: null, alive: true, visionBaseline: vision };
}

/**
 * 臨床経路に薬剤コストを適用（月次・高額療養費）
 */
function applyDrugCostsToPath({
  path,
  drugId,
  subtypeId,
  costPaperId,
  clinicalCase,
  incomeBracket,
  elderlyCopay,
  modelParams,
  treatmentDurationYears,
}) {
  const drug = getDrug(drugId);
  const paper = getCostPaper(costPaperId);
  const { injections } = getClinicalTables(clinicalCase);
  const injUnit = perInjectionCost(drugId, paper);
  const aePerInj = perInjectionAeCost(
    modelParams.adverseEvents,
    modelParams.includeScenarioAe
  );

  let totalDirectMedical = 0;
  let totalPatientOop = 0;
  let totalDrugAdmin = 0;
  let totalMonitoring = 0;
  let totalAdverseEvents = 0;
  let totalInjections = 0;

  const monthlyRecords = [];
  const annualRecords = [];
  let yearDirect = 0;
  let yearOop = 0;
  let yearDrug = 0;
  let yearMon = 0;
  let yearAe = 0;
  let yearInj = 0;
  let injAccumulator = 0;

  const injContext = {
    clinicalCase,
    injections,
    subtypeId,
    drugId,
    treatmentDurationYears,
  };

  for (const step of path.months) {
    const { month, yearIndex, age, onTreatment } = step;
    let monthDirect = 0;
    let monthDrug = 0;
    let monthMon = 0;
    let monthAe = 0;
    let monthInj = 0;

    if (onTreatment && injUnit != null) {
      injAccumulator += injectionsForMonth(month, injContext);
      while (injAccumulator >= 1 - 1e-9) {
        monthInj += 1;
        injAccumulator -= 1;
      }
      if (monthInj > 0) {
        monthDrug += injUnit * monthInj;
        monthDirect += injUnit * monthInj;
        monthAe += aePerInj * monthInj;
        monthDirect += aePerInj * monthInj;
      }
    }

    const monCost = monthlyMonitoringCost(
      yearIndex,
      onTreatment ? drug.monitoringRegimen : "bsc",
      paper
    );
    monthMon += monCost;
    monthDirect += monCost;

    const { patientOop } = computeMonthlyPatientOop({
      monthlyDirectMedical: monthDirect,
      age,
      incomeBracket,
      elderlyCopay,
    });

    totalDirectMedical += monthDirect;
    totalPatientOop += patientOop;
    totalDrugAdmin += monthDrug;
    totalMonitoring += monthMon;
    totalAdverseEvents += monthAe;
    totalInjections += monthInj;

    yearDirect += monthDirect;
    yearOop += patientOop;
    yearDrug += monthDrug;
    yearMon += monthMon;
    yearAe += monthAe;
    yearInj += monthInj;

    monthlyRecords.push({
      month,
      year: yearIndex,
      age: Math.round(age * 10) / 10,
      injections: monthInj,
      directMedical: Math.round(monthDirect),
      patientOop: Math.round(patientOop),
      drugAdmin: Math.round(monthDrug),
      monitoring: Math.round(monthMon),
      adverseEvents: Math.round(monthAe),
      treatedState: step.treatedState,
      onTreatment,
      cumInjections: totalInjections,
      cumDirectMedical: Math.round(totalDirectMedical),
      cumPatientOop: Math.round(totalPatientOop),
    });

    if ((month + 1) % 12 === 0) {
      annualRecords.push({
        year: yearIndex,
        age: Math.round(age * 10) / 10,
        injections: yearInj,
        cumInjections: totalInjections,
        directMedical: Math.round(yearDirect),
        patientOop: Math.round(yearOop),
        drugAdmin: Math.round(yearDrug),
        monitoring: Math.round(yearMon),
        adverseEvents: Math.round(yearAe),
        cumDirectMedical: Math.round(totalDirectMedical),
        cumPatientOop: Math.round(totalPatientOop),
      });
      yearDirect = 0;
      yearOop = 0;
      yearDrug = 0;
      yearMon = 0;
      yearAe = 0;
      yearInj = 0;
    }
  }

  // 最終年の端数（12か月未満）を flush
  if (yearInj > 0 || yearDirect > 0 || yearMon > 0) {
    const last = path.months[path.months.length - 1];
    annualRecords.push({
      year: last.yearIndex,
      age: Math.round(last.age * 10) / 10,
      injections: yearInj,
      cumInjections: totalInjections,
      directMedical: Math.round(yearDirect),
      patientOop: Math.round(yearOop),
      drugAdmin: Math.round(yearDrug),
      monitoring: Math.round(yearMon),
      adverseEvents: Math.round(yearAe),
      cumDirectMedical: Math.round(totalDirectMedical),
      cumPatientOop: Math.round(totalPatientOop),
    });
  }

  return {
    totalDirectMedical,
    totalPatientOop,
    totalInjections,
    costBreakdown: {
      drugAdmin: totalDrugAdmin,
      monitoring: totalMonitoring,
      adverseEvents: totalAdverseEvents,
    },
    annualTrajectory: annualRecords,
    monthlyTrajectory: monthlyRecords,
    injUnitMissing: injUnit == null,
  };
}

/**
 * @param {object} input
 */
export function runPatientSimulation(input) {
  const {
    entryAge,
    sex,
    subtypeId,
    drugId,
    costPaperId,
    clinicalCase = "base",
    timeHorizonYears = DEFAULT_HORIZON.timeHorizonYears,
    treatmentDurationYears = null,
    discountRate = DEFAULT_HORIZON.discountRate,
    cycleLengthYears = DEFAULT_HORIZON.cycleLengthYears,
    incomeBracket = "standard",
    elderlyCopay = null,
    seed = 42,
    modelParams = {},
    patientBaseline = {},
    includeTrajectory = true,
  } = input;

  const drug = getDrug(drugId);
  const rng = createRng(seed);
  const effectiveHorizon = patientEffectiveHorizon(entryAge, sex, timeHorizonYears);
  const path = simulateClinicalPath({
    entryAge,
    sex,
    subtypeId,
    transitionKey: getDrugTransitionKey(drugId),
    clinicalCase,
    timeHorizonYears: effectiveHorizon,
    treatmentDurationYears,
    modelParams,
    patientBaseline,
    rng,
  });

  if (!path) {
    return {
      drugId,
      incomplete: true,
      reason: `臨床データなし`,
      warnings: [],
    };
  }

  const costs = applyDrugCostsToPath({
    path,
    drugId,
    subtypeId,
    costPaperId,
    clinicalCase,
    incomeBracket,
    elderlyCopay,
    modelParams,
    treatmentDurationYears,
  });

  const qalyResult = computePatientPathQaly(path, {
    modelParams,
    discountRate,
    cycleLengthYears,
  });

  const warnings = [];
  if (drug.clinicalNote) warnings.push(drug.clinicalNote);
  if (costs.injUnitMissing) warnings.push(`薬価未設定: ${drug.name}`);

  return {
    drugId,
    entryAge,
    sex,
    subtypeId,
    seed,
    incomeBracket,
    baselineBcvaAffected: path.visionBaseline?.baselineBcvaAffected,
    baselineBcvaFellow: path.visionBaseline?.baselineBcvaFellow,
    remainingLifeExpectancy: remainingLifeExpectancy(entryAge, { sex }),
    effectiveHorizonYears: effectiveHorizon,
    totalQALY: qalyResult.totalQALY,
    totalLifeYears: qalyResult.totalLifeYears,
    totalDirectMedical: costs.totalDirectMedical,
    totalPatientOop: costs.totalPatientOop,
    totalInjections: costs.totalInjections,
    costBreakdown: costs.costBreakdown,
    annualTrajectory: costs.annualTrajectory,
    monthlyTrajectory: includeTrajectory ? costs.monthlyTrajectory : undefined,
    incomplete: qalyResult.totalQALY == null || costs.injUnitMissing,
    warnings,
    costPaperId,
    clinicalCase,
    treatmentDurationYears,
  };
}

/**
 * 薬剤別・年度別比較テーブル用データ
 * @returns {{ years: number[], drugs: object[], flatRows: object[], byYear: object[] }}
 */
export function buildPatientAnnualDrugComparison(
  results,
  drugIds,
  drugCatalog = DRUG_CATALOG
) {
  const activeIds = drugIds.filter((id) => results[id]?.annualTrajectory?.length);
  if (!activeIds.length) {
    return { years: [], drugs: [], flatRows: [], byYear: [] };
  }

  const years = [
    ...new Set(
      activeIds.flatMap((id) => results[id].annualTrajectory.map((r) => r.year))
    ),
  ].sort((a, b) => a - b);

  const drugs = sortByDrugDisplayOrder(activeIds).map((id) => ({
    drugId: id,
    name: drugCatalog[id]?.name ?? id,
    color: drugCatalog[id]?.color,
    clinicalKey: drugCatalog[id]?.clinicalKey,
    injectionReference: drugCatalog[id]?.injectionReference ?? false,
  }));

  const flatRows = [];
  const byYear = [];

  for (const year of years) {
    const yearEntry = { year, age: null, drugs: {} };
    for (const drugId of sortByDrugDisplayOrder(activeIds)) {
      const row = results[drugId].annualTrajectory.find((r) => r.year === year);
      if (!row) continue;
      if (yearEntry.age == null) yearEntry.age = row.age;
      const metrics = {
        injections: row.injections ?? 0,
        directMedical: row.directMedical ?? 0,
        patientOop: row.patientOop ?? 0,
        cumInjections: row.cumInjections ?? 0,
        cumDirectMedical: row.cumDirectMedical ?? 0,
        cumPatientOop: row.cumPatientOop ?? 0,
      };
      yearEntry.drugs[drugId] = metrics;
      flatRows.push({
        year,
        age: row.age,
        drugId,
        name: drugCatalog[drugId]?.name ?? drugId,
        color: drugCatalog[drugId]?.color,
        clinicalKey: drugCatalog[drugId]?.clinicalKey,
        injectionReference: drugCatalog[drugId]?.injectionReference ?? false,
        ...metrics,
      });
    }
    byYear.push(yearEntry);
  }

  return { years, drugs, flatRows, byYear };
}

/**
 * 同一患者プロファイルで全薬剤（または選択薬剤）を比較
 * — コスト・注射は drugId ごと、タイムラインは transitionKey 中最長生存（同一 seed）
 */
export function runPatientDrugComparison(input) {
  const drugIds = input.selectedDrugIds?.length ? input.selectedDrugIds : DRUG_IDS;
  const baseSeed = input.seed ?? 42;

  const configuredHorizon = input.timeHorizonYears ?? DEFAULT_HORIZON.timeHorizonYears;
  const effectiveHorizon = patientEffectiveHorizon(
    input.entryAge,
    input.sex,
    configuredHorizon
  );
  const remainingYears = remainingLifeExpectancy(input.entryAge, { sex: input.sex });

  const pathCache = new Map();
  const qalyCache = new Map();
  const patientBaseline = input.patientBaseline ?? {};

  const getPathByTransitionKey = (transitionKey) => {
    if (!pathCache.has(transitionKey)) {
      const rng = createRng(baseSeed);
      const path = simulateClinicalPath({
        entryAge: input.entryAge,
        sex: input.sex,
        subtypeId: input.subtypeId,
        transitionKey,
        clinicalCase: input.clinicalCase ?? "base",
        timeHorizonYears: effectiveHorizon,
        treatmentDurationYears: input.treatmentDurationYears ?? null,
        modelParams: input.modelParams ?? {},
        patientBaseline,
        rng,
      });
      pathCache.set(transitionKey, path);
    }
    return pathCache.get(transitionKey);
  };

  const transitionKeys = [...new Set(drugIds.map(getDrugTransitionKey))];
  let masterPath = null;
  for (const tk of transitionKeys) {
    const p = getPathByTransitionKey(tk);
    if (!p) continue;
    if (!masterPath || p.months.length > masterPath.months.length) {
      masterPath = p;
    }
  }

  const getQaly = (transitionKey, path) => {
    if (!qalyCache.has(transitionKey)) {
      qalyCache.set(
        transitionKey,
        computePatientPathQaly(path, {
          modelParams: input.modelParams ?? {},
          discountRate: input.discountRate ?? DEFAULT_HORIZON.discountRate,
          cycleLengthYears: input.cycleLengthYears ?? DEFAULT_HORIZON.cycleLengthYears,
        })
      );
    }
    return qalyCache.get(transitionKey);
  };

  const results = {};
  const summary = [];

  for (const drugId of drugIds) {
    const drug = getDrug(drugId);
    const transitionKey = getDrugTransitionKey(drugId);
    const clinicalPath = getPathByTransitionKey(transitionKey);
    if (!clinicalPath || !masterPath) {
      results[drugId] = { drugId, incomplete: true, reason: "臨床データなし" };
      continue;
    }

    const costs = applyDrugCostsToPath({
      path: masterPath,
      drugId,
      subtypeId: input.subtypeId,
      costPaperId: input.costPaperId ?? "paper2_rbz",
      clinicalCase: input.clinicalCase ?? "base",
      incomeBracket: input.incomeBracket ?? "standard",
      elderlyCopay: input.elderlyCopay ?? null,
      modelParams: input.modelParams ?? {},
      treatmentDurationYears: input.treatmentDurationYears ?? null,
    });

    const qalyResult = getQaly(transitionKey, clinicalPath);

    const warnings = [];
    if (drug.clinicalNote) warnings.push(drug.clinicalNote);
    if (drug.injectionReference) {
      warnings.push(
        `注射回数は参考値（induction 薬剤別、year1以降 AFL 2 mg × 0.8、${input.subtypeId} 病型 S6）`
      );
    }
    if (costs.injUnitMissing) warnings.push(`薬価未設定: ${drug.name}`);

    results[drugId] = {
      drugId,
      entryAge: input.entryAge,
      sex: input.sex,
      subtypeId: input.subtypeId,
      clinicalKey: drug.clinicalKey,
      transitionKey,
      costTimelineMonths: masterPath.months.length,
      totalQALY: qalyResult.totalQALY,
      totalLifeYears: qalyResult.totalLifeYears,
      totalDirectMedical: costs.totalDirectMedical,
      totalPatientOop: costs.totalPatientOop,
      totalInjections: costs.totalInjections,
      costBreakdown: costs.costBreakdown,
      annualTrajectory: costs.annualTrajectory,
      monthlyTrajectory:
        input.includeTrajectory !== false ? costs.monthlyTrajectory : undefined,
      incomplete: qalyResult.totalQALY == null || costs.injUnitMissing,
      injectionReference: drug.injectionReference ?? false,
      warnings,
    };

    summary.push({
      drugId,
      name: DRUG_CATALOG[drugId].name,
      clinicalKey: drug.clinicalKey,
      injectionReference: drug.injectionReference ?? false,
      transitionKey,
      totalDirectMedical: costs.totalDirectMedical,
      totalPatientOop: costs.totalPatientOop,
      totalInjections: costs.totalInjections,
      totalQALY: qalyResult.totalQALY,
      totalLifeYears: qalyResult.totalLifeYears,
      costBreakdown: costs.costBreakdown,
    });
  }

  return {
    results,
    summary: sortByDrugDisplayOrder(summary.map((s) => s.drugId)).map(
      (id) => summary.find((s) => s.drugId === id)
    ),
    annualComparison: buildPatientAnnualDrugComparison(results, sortByDrugDisplayOrder(drugIds)),
    patientProfile: {
      entryAge: input.entryAge,
      sex: input.sex,
      subtypeId: input.subtypeId,
      incomeBracket: input.incomeBracket ?? "standard",
      baselineBcvaAffected:
        masterPath?.visionBaseline?.baselineBcvaAffected ??
        patientBaseline.baselineBcvaAffected,
      baselineBcvaFellow:
        masterPath?.visionBaseline?.baselineBcvaFellow ??
        patientBaseline.baselineBcvaFellow,
      initialDistributionSource: masterPath?.visionBaseline?.initialDistributionSource,
      remainingLifeExpectancy: remainingYears,
      effectiveHorizonYears: effectiveHorizon,
      configuredHorizonYears: configuredHorizon,
      seed: baseSeed,
      costTimelineMonths: masterPath?.months.length ?? 0,
      costTimelineNote:
        "コスト・注射は全薬剤共通の最長生存タイムライン（同一 seed）で算出。",
    },
  };
}
