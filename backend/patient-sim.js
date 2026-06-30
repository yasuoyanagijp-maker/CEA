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
  getInjectionRate,
} from "./clinical.js";
import { getDrug, DRUG_CATALOG, DRUG_IDS } from "./drugs.js";
import { getCostPaper } from "./papers/index.js";
import { computeMonthlyPatientOop } from "./config/japan-nhi.js";
import { R5_MALE_NQX, R5_FEMALE_NQX } from "./config/mortality-life-table-r5.js";

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

function betterEyeUtility(treatedState, fellowState, secondEye, qaly) {
  const { utilities: u, utilityNone: uNone } = qaly;
  const fellowU = secondEye ? u[fellowState] : uNone;
  return Math.max(u[treatedState], fellowU);
}

function nqxForSex(age, sex) {
  const a = Math.max(0, Math.min(105, Math.floor(age)));
  const table = sex === "female" ? R5_FEMALE_NQX : R5_MALE_NQX;
  return table[a];
}

function monthlyMortality(age, sex, blind, blindHr, useLifeTable, fixedRate) {
  const annual =
    useLifeTable && fixedRate == null
      ? nqxForSex(age, sex)
      : (fixedRate ?? nqxForSex(age, sex));
  let m = 1 - Math.pow(1 - annual, 1 / 12);
  if (blind && blindHr > 1) m = Math.min(1, m * blindHr);
  return m;
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

  const qaly =
    modelParams.utilities && modelParams.utilityNone != null
      ? { utilities: modelParams.utilities, utilityNone: modelParams.utilityNone }
      : null;

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
  let totalQALY = 0;
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

    if (qaly) {
      totalQALY += betterEyeUtility(treatedState, fellowState, secondEye, qaly) / 12;
    }

    months.push({
      month,
      yearIndex,
      age,
      phase,
      onTreatment,
      treatedState,
      fellowState,
      secondEye,
      cumQALY: qaly ? totalQALY : null,
    });

    if (!secondEye && secondEyeMonthly > 0 && rng() < secondEyeMonthly) {
      secondEye = true;
      fellowState = sampleCategorical(subtype.treatedInitial, rng);
    }

    treatedState = sampleTransition(treatedState, probs, rng);
    fellowState = sampleTransition(fellowState, probs, rng);

    const blind = treatedState === N_STATES - 1;
    const m = monthlyMortality(age, sex, blind, blindHr, useLifeTable, fixedMort);
    if (rng() < m) {
      return { months, totalQALY, deathMonth: month, alive: false };
    }
  }

  return { months, totalQALY, deathMonth: null, alive: true };
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
  rng,
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
  let yearStartQaly = 0;

  for (const step of path.months) {
    const { month, yearIndex, age, phase, onTreatment } = step;
    let monthDirect = 0;
    let monthDrug = 0;
    let monthMon = 0;
    let monthAe = 0;
    let monthInj = 0;

    if (onTreatment && injUnit != null) {
      const annualInj = getInjectionRate(
        clinicalCase,
        injections,
        subtypeId,
        drugId,
        clinicalKey,
        phase
      );
      const pInj = Math.min(1, annualInj / 12);
      if (rng() < pInj) {
        monthInj = 1;
        monthDrug += injUnit;
        monthDirect += injUnit;
        monthAe += aePerInj;
        monthDirect += aePerInj;
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
      cumQALY: step.cumQALY != null ? Math.round(step.cumQALY * 1000) / 1000 : null,
    });

    if ((month + 1) % 12 === 0) {
      const endQaly = step.cumQALY;
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
        qaly:
          endQaly != null
            ? Math.round((endQaly - yearStartQaly) * 1000) / 1000
            : null,
        cumDirectMedical: Math.round(totalDirectMedical),
        cumPatientOop: Math.round(totalPatientOop),
        cumQALY: endQaly != null ? Math.round(endQaly * 1000) / 1000 : null,
      });
      yearDirect = 0;
      yearOop = 0;
      yearDrug = 0;
      yearMon = 0;
      yearAe = 0;
      yearInj = 0;
      yearStartQaly = endQaly ?? yearStartQaly;
    }
  }

  return {
    totalDirectMedical,
    totalPatientOop,
    totalQALY: path.totalQALY,
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
    timeHorizonYears = 25,
    treatmentDurationYears = null,
    incomeBracket = "standard",
    elderlyCopay = null,
    seed = 42,
    modelParams = {},
    includeTrajectory = true,
  } = input;

  const drug = getDrug(drugId);
  const rng = createRng(seed);
  const path = simulateClinicalPath({
    entryAge,
    sex,
    subtypeId,
    clinicalKey: drug.clinicalKey,
    clinicalCase,
    timeHorizonYears,
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

  const costRng = createRng(seed + 7919);
  const costs = applyDrugCostsToPath({
    path,
    drugId,
    subtypeId,
    costPaperId,
    clinicalCase,
    incomeBracket,
    elderlyCopay,
    modelParams,
    rng: costRng,
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
    alive: path.alive,
    deathMonth: path.deathMonth,
    totalQALY: costs.totalQALY,
    totalDirectMedical: costs.totalDirectMedical,
    totalPatientOop: costs.totalPatientOop,
    totalInjections: costs.totalInjections,
    costBreakdown: costs.costBreakdown,
    annualTrajectory: costs.annualTrajectory,
    monthlyTrajectory: includeTrajectory ? costs.monthlyTrajectory : undefined,
    incomplete: costs.totalQALY == null || costs.injUnitMissing,
    warnings,
    costPaperId,
    clinicalCase,
    treatmentDurationYears,
  };
}

/**
 * 同一患者プロファイルで全薬剤（または選択薬剤）を比較
 */
export function runPatientDrugComparison(input) {
  const drugIds = input.selectedDrugIds?.length ? input.selectedDrugIds : DRUG_IDS;
  const baseSeed = input.seed ?? 42;

  const pathCache = new Map();
  const getPath = (clinicalKey) => {
    if (!pathCache.has(clinicalKey)) {
      const rng = createRng(baseSeed + hashString(clinicalKey));
      const path = simulateClinicalPath({
        entryAge: input.entryAge,
        sex: input.sex,
        subtypeId: input.subtypeId,
        clinicalKey,
        clinicalCase: input.clinicalCase ?? "base",
        timeHorizonYears: input.timeHorizonYears ?? 25,
        treatmentDurationYears: input.treatmentDurationYears ?? null,
        modelParams: input.modelParams ?? {},
        rng,
      });
      pathCache.set(clinicalKey, path);
    }
    return pathCache.get(clinicalKey);
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

    const costRng = createRng(baseSeed + hashString(drugId));
    const costs = applyDrugCostsToPath({
      path,
      drugId,
      subtypeId: input.subtypeId,
      costPaperId: input.costPaperId ?? "paper2_rbz",
      clinicalCase: input.clinicalCase ?? "base",
      incomeBracket: input.incomeBracket ?? "standard",
      elderlyCopay: input.elderlyCopay ?? null,
      modelParams: input.modelParams ?? {},
      rng: costRng,
    });

    const warnings = [];
    if (drug.clinicalNote) warnings.push(drug.clinicalNote);
    if (costs.injUnitMissing) warnings.push(`薬価未設定: ${drug.name}`);

    results[drugId] = {
      drugId,
      entryAge: input.entryAge,
      sex: input.sex,
      subtypeId: input.subtypeId,
      clinicalKey: drug.clinicalKey,
      totalQALY: costs.totalQALY,
      totalDirectMedical: costs.totalDirectMedical,
      totalPatientOop: costs.totalPatientOop,
      totalInjections: costs.totalInjections,
      costBreakdown: costs.costBreakdown,
      annualTrajectory: costs.annualTrajectory,
      monthlyTrajectory:
        input.includeTrajectory !== false ? costs.monthlyTrajectory : undefined,
      alive: path.alive,
      incomplete: costs.totalQALY == null || costs.injUnitMissing,
      warnings,
    };

    summary.push({
      drugId,
      name: DRUG_CATALOG[drugId].name,
      clinicalKey: drug.clinicalKey,
      totalDirectMedical: costs.totalDirectMedical,
      totalPatientOop: costs.totalPatientOop,
      totalInjections: costs.totalInjections,
      totalQALY: costs.totalQALY,
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
      seed: baseSeed,
    },
  };
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
