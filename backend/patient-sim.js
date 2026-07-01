/**
 * 個別患者マイクロシミュレーション
 * — 年齢・性別・病型を指定し、月次で直接医療費・患者負担（高額療養費）・QALY を算出
 *
 * 薬剤比較時は clinicalKey ごとに臨床経路を共有し、同一患者像でコストのみ差し替える。
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
import { getDrug, DRUG_CATALOG, DRUG_IDS } from "./drugs.js";
import { getCostPaper } from "./papers/index.js";
import { computeMonthlyPatientOop } from "./config/japan-nhi.js";
import { cycleDeathProbability, analysisHorizonYears, remainingLifeExpectancy } from "./config/mortality.js";
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

/** 個別患者 QALY — 臨床経路（死亡打ち切り）と整合 */
function computePatientPathQaly(path, input) {
  const effectiveHorizon = patientEffectiveHorizon(
    input.entryAge,
    input.sex,
    input.timeHorizonYears ?? DEFAULT_HORIZON.timeHorizonYears
  );
  const qalyResult = computeQalyFromClinicalPath(path, {
    modelParams: input.modelParams ?? {},
    discountRate: input.discountRate ?? DEFAULT_HORIZON.discountRate,
    cycleLengthYears: input.cycleLengthYears ?? DEFAULT_HORIZON.cycleLengthYears,
  });

  return {
    ...qalyResult,
    effectiveHorizonYears: effectiveHorizon,
    remainingLifeExpectancy: remainingLifeExpectancy(input.entryAge, {
      sex: input.sex,
    }),
  };
}

function mergeCostTrajectoryWithQaly(costAnnual, annualQaly) {
  let prevCum = 0;
  return costAnnual.map((row) => {
    const qr = annualQaly.find((q) => q.year === row.year);
    const cumQALY = qr?.cumQALY ?? null;
    const qaly =
      qr?.qaly ?? (cumQALY != null ? cumQALY - prevCum : null);
    if (cumQALY != null) prevCum = cumQALY;
    return { ...row, qaly, cumQALY };
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
 * clinicalKey 単位で臨床経路を1本生成（状態・QALY・死亡）
 */
function simulateClinicalPath({
  entryAge,
  sex,
  subtypeId,
  clinicalKey,
  clinicalCase,
  timeHorizonYears,
  treatmentDurationYears,
  modelParams,
  rng,
}) {
  const subtype = SUBTYPES[subtypeId];
  const { transitions } = getClinicalTables(clinicalCase);

  const useLifeTable =
    modelParams.useAgeSpecificMortality !== false && modelParams.annualMortality == null;
  const blindHr = modelParams.blindMortalityHr ?? 1.4;
  const fixedMort = modelParams.annualMortality ?? null;
  const secondEyeMonthly = modelParams.secondEyeMonthlyIncidence ?? 0.008;

  if (!transitions[subtypeId]?.[clinicalKey]) return null;

  let treatedState = sampleCategorical(subtype.treatedInitial, rng);
  let fellowState = sampleCategorical(subtype.fellowInitial, rng);
  let secondEye = rng() < subtype.bothEyesBaseline;

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
      clinicalKey,
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
      fellowState = sampleCategorical(subtype.treatedInitial, rng);
    }

    treatedState = sampleTransition(treatedState, probs, rng);
    fellowState = sampleTransition(fellowState, probs, rng);

    months[months.length - 1].endTreatedState = treatedState;
    months[months.length - 1].endFellowState = fellowState;
    months[months.length - 1].endSecondEye = secondEye;

    const blind = treatedState === N_STATES - 1;
    const m = monthlyMortality(age, sex, blind, blindHr, useLifeTable, fixedMort);
    if (rng() < m) {
      return { months, deathMonth: month, alive: false };
    }
  }

  return { months, deathMonth: null, alive: true };
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
  const clinicalKey = drug.clinicalKey;
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
    clinicalKey,
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
    includeTrajectory = true,
  } = input;

  const drug = getDrug(drugId);
  const rng = createRng(seed);
  const effectiveHorizon = patientEffectiveHorizon(entryAge, sex, timeHorizonYears);
  const path = simulateClinicalPath({
    entryAge,
    sex,
    subtypeId,
    clinicalKey: drug.clinicalKey,
    clinicalCase,
    timeHorizonYears: effectiveHorizon,
    treatmentDurationYears,
    modelParams,
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
    entryAge,
    sex,
    timeHorizonYears,
    discountRate,
    cycleLengthYears,
    modelParams,
  });

  const annualTrajectory = mergeCostTrajectoryWithQaly(
    costs.annualTrajectory,
    qalyResult.annualQaly
  );

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
    alive: path.alive,
    deathMonth: path.deathMonth,
    totalQALY: qalyResult.totalQALY,
    totalLifeYears: qalyResult.totalLifeYears,
    remainingLifeExpectancy: qalyResult.remainingLifeExpectancy,
    effectiveHorizonYears: qalyResult.effectiveHorizonYears,
    totalDirectMedical: costs.totalDirectMedical,
    totalPatientOop: costs.totalPatientOop,
    totalInjections: costs.totalInjections,
    costBreakdown: costs.costBreakdown,
    annualTrajectory,
    monthlyTrajectory: includeTrajectory ? costs.monthlyTrajectory : undefined,
    incomplete: qalyResult.totalQALY == null || costs.injUnitMissing,
    warnings,
    costPaperId,
    clinicalCase,
    treatmentDurationYears,
  };
}

/**
 * 同一患者プロファイルで全薬剤（または選択薬剤）を比較
 * — clinicalKey ごとに臨床経路（視力・死亡・QALY）を生成。同一 key 内はコストのみ差し替え
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
  const getPath = (clinicalKey) => {
    if (!pathCache.has(clinicalKey)) {
      const rng = createRng(baseSeed + hashString(clinicalKey));
      const path = simulateClinicalPath({
        entryAge: input.entryAge,
        sex: input.sex,
        subtypeId: input.subtypeId,
        clinicalKey,
        clinicalCase: input.clinicalCase ?? "base",
        timeHorizonYears: effectiveHorizon,
        treatmentDurationYears: input.treatmentDurationYears ?? null,
        modelParams: input.modelParams ?? {},
        rng,
      });
      pathCache.set(clinicalKey, path);
    }
    return pathCache.get(clinicalKey);
  };

  const getQaly = (clinicalKey, path) => {
    if (!qalyCache.has(clinicalKey)) {
      qalyCache.set(
        clinicalKey,
        computePatientPathQaly(path, {
          entryAge: input.entryAge,
          sex: input.sex,
          timeHorizonYears: configuredHorizon,
          discountRate: input.discountRate ?? DEFAULT_HORIZON.discountRate,
          cycleLengthYears: input.cycleLengthYears ?? DEFAULT_HORIZON.cycleLengthYears,
          modelParams: input.modelParams ?? {},
        })
      );
    }
    return qalyCache.get(clinicalKey);
  };

  const results = {};
  const summary = [];

  for (const drugId of drugIds) {
    const drug = getDrug(drugId);
    const path = getPath(drug.clinicalKey);
    if (!path) {
      results[drugId] = { drugId, incomplete: true, reason: "臨床データなし" };
      continue;
    }

    const costs = applyDrugCostsToPath({
      path,
      drugId,
      subtypeId: input.subtypeId,
      costPaperId: input.costPaperId ?? "paper2_rbz",
      clinicalCase: input.clinicalCase ?? "base",
      incomeBracket: input.incomeBracket ?? "standard",
      elderlyCopay: input.elderlyCopay ?? null,
      modelParams: input.modelParams ?? {},
      treatmentDurationYears: input.treatmentDurationYears ?? null,
    });

    const qalyResult = getQaly(drug.clinicalKey, path);

    const annualTrajectory = mergeCostTrajectoryWithQaly(
      costs.annualTrajectory,
      qalyResult.annualQaly
    );

    const warnings = [];
    if (drug.clinicalNote) warnings.push(drug.clinicalNote);
    if (costs.injUnitMissing) warnings.push(`薬価未設定: ${drug.name}`);

    results[drugId] = {
      drugId,
      entryAge: input.entryAge,
      sex: input.sex,
      subtypeId: input.subtypeId,
      clinicalKey: drug.clinicalKey,
      totalQALY: qalyResult.totalQALY,
      totalLifeYears: qalyResult.totalLifeYears,
      deathMonth: path.deathMonth,
      alive: path.alive,
      totalDirectMedical: costs.totalDirectMedical,
      totalPatientOop: costs.totalPatientOop,
      totalInjections: costs.totalInjections,
      costBreakdown: costs.costBreakdown,
      annualTrajectory,
      monthlyTrajectory:
        input.includeTrajectory !== false ? costs.monthlyTrajectory : undefined,
      incomplete: qalyResult.totalQALY == null || costs.injUnitMissing,
      warnings,
    };

    summary.push({
      drugId,
      name: DRUG_CATALOG[drugId].name,
      clinicalKey: drug.clinicalKey,
      totalDirectMedical: costs.totalDirectMedical,
      totalPatientOop: costs.totalPatientOop,
      totalInjections: costs.totalInjections,
      totalQALY: qalyResult.totalQALY,
      totalLifeYears: qalyResult.totalLifeYears,
      deathMonth: path.deathMonth,
      alive: path.alive,
      costBreakdown: costs.costBreakdown,
    });
  }

  return {
    results,
    summary,
    patientProfile: {
      entryAge: input.entryAge,
      sex: input.sex,
      subtypeId: input.subtypeId,
      incomeBracket: input.incomeBracket ?? "standard",
      remainingLifeExpectancy: remainingYears,
      effectiveHorizonYears: effectiveHorizon,
      configuredHorizonYears: configuredHorizon,
      seed: baseSeed,
    },
  };
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
