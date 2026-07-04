import {
  DEFAULT_HORIZON,
  DEFAULT_TREATMENT_DURATION_YEARS,
  TREATMENT_DURATION_OPTIONS,
} from "./constants.js";
import {
  DRUG_CATALOG,
  DRUG_IDS,
  PATIENT_DRUG_IDS,
  PATIENT_DISPLAY_ORDER,
  patientDrugIds,
  getDrugTransitionKey,
  sortByDrugDisplayOrder,
} from "./drugs.js";
import { SUBTYPES } from "./clinical.js";
import { COST_PAPER_LIST, DEFAULT_COST_PAPER_ID } from "./papers/index.js";
import { runMarkov } from "./markov.js";
import {
  DEFAULT_MODEL_PARAMS as CONFIG_DEFAULT_MODEL_PARAMS,
  DEFAULT_UTILITIES,
  DEFAULT_UTILITY_NONE,
} from "./config/default-model-params.js";
import {
  buildS12ModelParams,
  PAPER_S12_ENTRY_AGE,
} from "./config/paper-reference.js";

/**
 * フロントエンド → バックエンド入力スキーマ
 * @typedef {object} CeaInput
 * @property {string[]} selectedDrugIds — 比較する薬剤 ID（最大6）
 * @property {string} referenceDrugId — ICER 参照薬
 * @property {string} subtypeId — typical | pcv | rap
 * @property {string} costPaperId — default_integrated | paper1_faricimab | paper2_rbz
 * @property {'base'|'scenario'|'2026_meta'} clinicalCase
 * @property {{timeHorizonYears:number,cycleLengthYears:number,discountRate:number}} horizon
 * @property {number|null} [treatmentDurationYears] — 2 / 5 / null（生涯）
 * @property {object} modelParams — QALY・死亡・第二眼・AE 等
 */

export const DEFAULT_MODEL_PARAMS = { ...CONFIG_DEFAULT_MODEL_PARAMS };

const PARAM_LABELS = {
  utilities: "5状態の効用重み",
  utilityNone: "効用 — 非罹患時",
  annualMortality: "年間全死因死亡率（固定値）",
  blindMortalityHr: "失明時死亡 HR",
  secondEyeMonthlyIncidence: "他眼発症率（/月）",
  adverseEvents: "注射あたり有害事象",
};

export function listMissingParams(
  modelParams = DEFAULT_MODEL_PARAMS,
  costPaperId,
  selectedDrugIds = DRUG_IDS
) {
  const missing = [];
  if (!modelParams.utilities || modelParams.utilityNone == null) {
    missing.push({ key: "utilities", label: PARAM_LABELS.utilities });
  }
  if (modelParams.annualMortality == null && modelParams.useAgeSpecificMortality === false) {
    missing.push({ key: "annualMortality", label: PARAM_LABELS.annualMortality });
  }
  if (modelParams.blindMortalityHr == null) {
    missing.push({ key: "blindMortalityHr", label: PARAM_LABELS.blindMortalityHr });
  }
  if (modelParams.secondEyeMonthlyIncidence == null) {
    missing.push({
      key: "secondEyeMonthlyIncidence",
      label: PARAM_LABELS.secondEyeMonthlyIncidence,
    });
  }
  if (!modelParams.adverseEvents?.length) {
    missing.push({ key: "adverseEvents", label: PARAM_LABELS.adverseEvents });
  }

  const paper = COST_PAPER_LIST.find((p) => p.id === (costPaperId ?? DEFAULT_COST_PAPER_ID));
  for (const drugId of selectedDrugIds) {
    if (paper && paper.drugPrices[drugId] == null) {
      missing.push({
        key: `price_${drugId}`,
        label: `${DRUG_CATALOG[drugId].name} の薬価（選択コスト出典に未掲載）`,
      });
    }
  }

  return missing;
}

/**
 * @param {CeaInput} input
 */
export function runAnalysis(input) {
  const horizon = { ...DEFAULT_HORIZON, ...input.horizon };
  const treatmentDurationYears =
    input.treatmentDurationYears !== undefined
      ? input.treatmentDurationYears
      : DEFAULT_TREATMENT_DURATION_YEARS;
  const modelParams = { ...DEFAULT_MODEL_PARAMS, ...input.modelParams };
  const selectedDrugIds =
    input.selectedDrugIds?.length > 0 ? input.selectedDrugIds : ["ranibizumab_bs", "aflibercept"];

  const missingParams = listMissingParams(
    modelParams,
    input.costPaperId,
    selectedDrugIds
  );

  const results = {};
  for (const drugId of selectedDrugIds) {
    results[drugId] = runMarkov({
      drugId,
      subtypeId: input.subtypeId ?? "typical",
      costPaperId: input.costPaperId ?? DEFAULT_COST_PAPER_ID,
      clinicalCase: input.clinicalCase ?? "base",
      horizon,
      treatmentDurationYears,
      modelParams,
    });
  }

  const refId = input.referenceDrugId ?? selectedDrugIds[0];
  const ref = results[refId];

  const icerRows = selectedDrugIds.map((drugId) => {
    const r = results[drugId];
    if (!r || drugId === refId) {
      return { drugId, icer: "—（参照）", deltaQaly: null, deltaCost: null };
    }
    if (r.totalQALY == null || ref?.totalQALY == null) {
      return { drugId, icer: "QALY未算出", deltaQaly: null, deltaCost: r.totalCost - ref.totalCost };
    }
    const deltaQ = r.totalQALY - ref.totalQALY;
    const deltaC = r.totalCost - ref.totalCost;
    let icer = "—";
    if (deltaQ <= 0) icer = "Dominated";
    else if (deltaC <= 0) icer = "Dominant";
    else icer = deltaC / deltaQ;
    return { drugId, icer, deltaQaly: deltaQ, deltaCost: deltaC };
  });

  return {
    results,
    icerRows,
    referenceDrugId: refId,
    missingParams,
    config: {
      subtypeId: input.subtypeId,
      costPaperId: input.costPaperId,
      clinicalCase: input.clinicalCase,
      horizon,
      treatmentDurationYears,
    },
  };
}

/**
 * runAnalysis のメモ化ラッパー — UI がタブ切替・照合表示などで同一入力の
 * 解析を繰り返し要求するため、直近の結果をキャッシュする。
 * 入力はプレーンなデータ(JSON 化可能)であることが前提。
 */
const ANALYSIS_CACHE_LIMIT = 100;
const analysisCache = new Map();

export function runAnalysisCached(input) {
  const key = JSON.stringify(input);
  const hit = analysisCache.get(key);
  if (hit) {
    analysisCache.delete(key);
    analysisCache.set(key, hit); // LRU: 直近利用を末尾へ
    return hit;
  }
  const result = runAnalysis(input);
  analysisCache.set(key, result);
  if (analysisCache.size > ANALYSIS_CACHE_LIMIT) {
    analysisCache.delete(analysisCache.keys().next().value);
  }
  return result;
}

const DEFAULT_MORTALITY_SENSITIVITY_RATES = [0.02, 0.03, 0.035, 0.04];

/**
 * 年間死亡率の感度分析（S12 照合用）
 * @param {CeaInput} input
 * @param {number[]} [annualMortalityRates]
 */
export function runMortalitySensitivity(
  input,
  annualMortalityRates = DEFAULT_MORTALITY_SENSITIVITY_RATES
) {
  const subtypeId = input.subtypeId ?? "typical";
  const subtype = SUBTYPES[subtypeId];
  const refS12 = subtype.referenceS12;
  const drugIds = input.selectedDrugIds?.length
    ? input.selectedDrugIds.filter((id) => id === "ranibizumab_bs" || id === "aflibercept")
    : ["ranibizumab_bs", "aflibercept"];

  const rows = [];
  for (const rate of annualMortalityRates) {
    const modelParams = {
      ...DEFAULT_MODEL_PARAMS,
      ...input.modelParams,
      annualMortality: rate,
      useAgeSpecificMortality: false,
    };
    const analysis = runAnalysisCached({
      ...input,
      subtypeId,
      clinicalCase: "scenario",
      modelParams,
      selectedDrugIds: drugIds,
    });
    for (const drugId of drugIds) {
      const r = analysis.results[drugId];
      const refKey = drugId === "ranibizumab_bs" ? "rbz_bs" : "aflibercept";
      const paper = refS12?.[refKey];
      rows.push({
        annualMortality: rate,
        drugId,
        qaly: r?.totalQALY ?? null,
        cost: r?.totalCost ?? null,
        paperQaly: paper?.qaly ?? null,
        paperCost: paper?.cost ?? null,
      });
    }
  }
  return { subtypeId, rows };
}

export { runMarkov } from "./markov.js";
export {
  expectedBetterEyeUtility,
  qalyForCycle,
  patientBetterEyeUtility,
  computeQalyFromClinicalPath,
} from "./qaly.js";
export {
  runPatientSimulation,
  runPatientDrugComparison,
  buildPatientAnnualDrugComparison,
  createRng,
  resolvePatientVisionBaseline,
} from "./patient-sim.js";
export {
  INCOME_BRACKETS,
  INCOME_BRACKET_LIST,
  getCopayRate,
  getMonthlyOutpatientLimit,
  computeMonthlyPatientOop,
} from "./config/japan-nhi.js";
export {
  CLINICAL_DATASETS,
  CLINICAL_CASE_OPTIONS,
  getClinicalDataset,
  getEffectiveAnnualInjectionRate,
  getInjectionRate,
  getInjectionPhaseReference,
  buildInjectionYearReference,
  injectionsForMonth,
  injectionsForCycle,
  INJECTIONS_2026_META_SOURCE,
} from "./clinical.js";
export { listInjections2026MetaSummary } from "./config/injections-2026-meta.js";
export {
  buildS12ModelParams,
  PAPER_S12_ENTRY_AGE,
  PAPER_INCREMENTAL_RBZ_VS_AFL,
} from "./config/paper-reference.js";
export {
  MORTALITY_DEFAULTS,
  annualMortalityForAge,
  entryMortalityForSubtype,
  remainingLifeExpectancy,
  analysisHorizonYears,
  survivalProbability,
  cycleDeathProbability,
  LIFE_TABLE_SOURCE,
} from "./config/mortality.js";
export {
  getMarkovBaselineBcva,
  isMarkovDefaultBcva,
} from "./config/baseline-characteristics.js";
export {
  DRUG_CATALOG,
  DRUG_IDS,
  PATIENT_DRUG_IDS,
  patientDrugIds,
  getDrugTransitionKey,
  sortByDrugDisplayOrder,
  PATIENT_DISPLAY_ORDER,
  SUBTYPES,
  COST_PAPER_LIST,
  DEFAULT_COST_PAPER_ID,
  DEFAULT_HORIZON,
  DEFAULT_TREATMENT_DURATION_YEARS,
  TREATMENT_DURATION_OPTIONS,
  PARAM_LABELS,
  DEFAULT_UTILITIES,
  DEFAULT_UTILITY_NONE,
};
export {
  runSwitchCostMinimization,
  computeBreakEvenTable,
  buildAnnualCostCurve,
  TREATMENT_INTERVAL_OPTIONS,
  REFERENCE_INTERVAL_WEEKS,
  formatIntervalLabel,
  cmaQalyTolerance,
  annualDrugAdminCostFromModel,
} from "./switch-analysis.js";
export {
  SWITCH_INTERVAL_EVIDENCE,
  EVIDENCE_TIER_LABELS,
} from "./config/switch-interval-evidence.js";
