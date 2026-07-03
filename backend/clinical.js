import {
  deriveBscTransitionProbs,
  phaseForCycle,
  isOnTreatment,
} from "./utils.js";
import { buildSubtypeBaseline } from "./config/baseline-characteristics.js";
import {
  TRANS_BASE_TABLE_S5,
  TABLE_S5_SOURCE,
} from "./config/table-s5-transitions.js";
import {
  INJ_BASE_TABLE_S6,
  TABLE_S6_SOURCE,
} from "./config/table-s6-injections.js";
import {
  TRANS_SCENARIO_TABLE_S7_S8,
  INJ_SCENARIO_TABLE_S8,
  TABLE_S7_S8_SOURCE,
} from "./config/table-s7-s8-scenario.js";
import {
  getInjections2026MetaForDrug,
  INJECTIONS_2026_META_SOURCE,
} from "./config/injections-2026-meta.js";
import { annualInjectionsFromIntervalWeeks } from "./config/treatment-intervals.js";
import {
  buildInjectionsByDrugSubtype,
  getTransitionKey,
  isAfl2mgDerivedInjection,
  AFL2MG_DERIVED_INJECTION_FACTOR,
  AFL2MG_DERIVED_INJECTION_NOTE,
} from "./config/drug-clinical-profile.js";
import { getDrug } from "./drugs.js";
import { DEFAULT_HORIZON } from "./constants.js";

/** BSC 自然経過 — Table S5 に BSC 列がないため rbz_bs 治療遷移から導出（論文1 簡略モデルと同趣旨） */
export const BSC_PROGRESSION_MULTIPLIER = 1.35;

const BSC_REFERENCE_KEY = "rbz_bs";

/** ベースライン — Yoneda [1] + Table S2 初期分布；遷移・注射は Table S5–S8 */
export const SUBTYPES = {
  typical: {
    label: "典型 nAMD",
    ...buildSubtypeBaseline("typical"),
    referenceS12: {
      rbz_bs: { qaly: 7.543, cost: 23_581_934 },
      aflibercept: { qaly: 7.534, cost: 24_115_743 },
    },
  },
  pcv: {
    label: "PCV",
    ...buildSubtypeBaseline("pcv"),
    referenceS12: {
      rbz_bs: { qaly: 8.203, cost: 22_828_047 },
      aflibercept: { qaly: 8.141, cost: 24_629_713 },
    },
  },
  rap: {
    label: "RAP",
    ...buildSubtypeBaseline("rap"),
    referenceS12: {
      rbz_bs: { qaly: 5.05, cost: 23_605_224 },
      aflibercept: { qaly: 5.036, cost: 25_493_773 },
    },
  },
};

export const TRANS_BASE = TRANS_BASE_TABLE_S5;
export const TRANS_SCENARIO = TRANS_SCENARIO_TABLE_S7_S8;

/**
 * サマリー・スイッチタブ用 注射回数 — clinicalKey（rbz_bs / aflibercept）で集約（Table S6）。
 * 個別患者タブは薬剤別（AFL 8mg/ファリ/ブロルを AFL 2mg から導出）の INJ_*_PERDRUG を使う。
 */
export const INJ_BASE = INJ_BASE_TABLE_S6;
export const INJ_SCENARIO = INJ_SCENARIO_TABLE_S8;

/** 個別患者タブ用 注射回数 — 病型 × 薬剤ID（AFL 8mg/ファリ/ブロルは AFL 2mg 由来） */
export const INJ_BASE_PERDRUG = buildInjectionsByDrugSubtype("base");
export const INJ_SCENARIO_PERDRUG = buildInjectionsByDrugSubtype("scenario");

export { TABLE_S5_SOURCE, TABLE_S6_SOURCE, TABLE_S7_S8_SOURCE, INJECTIONS_2026_META_SOURCE };

/**
 * 臨床データセット — 遷移・注射回数の3系統（base / scenario / 2026_meta）を
 * 同一インターフェースで提供する。呼び出し側（markov.js）は clinicalCase の
 * 分岐を持たず、datasets のメソッドのみを使う。
 *
 * @typedef {object} ClinicalDataset
 * @property {string} id
 * @property {string} label — UI 表示名
 * @property {string} hint — UI 補足（出典）
 * @property {(subtypeId: string, clinicalKey: string) => boolean} hasTransitions
 * @property {(subtypeId: string, clinicalKey: string, phase: string) => object|null} getTransitions
 * @property {(subtypeId: string, phase: string) => object|null} getBscTransitions
 * @property {(q: {subtypeId: string, drugId: string, clinicalKey: string, phase: string}) => number} getAnnualInjections
 * @property {(drugId: string, subtypeId: string, clinicalKey: string) => boolean} hasInjections
 */

/** @returns {ClinicalDataset} */
function makeTableDataset({ id, label, hint, transitions, injections }) {
  return {
    id,
    label,
    hint,
    hasTransitions: (subtypeId, clinicalKey) =>
      transitions[subtypeId]?.[clinicalKey] != null,
    getTransitions: (subtypeId, clinicalKey, phase) =>
      transitions[subtypeId]?.[clinicalKey]?.[phase] ?? null,
    getBscTransitions: (subtypeId, phase) => {
      const treated = transitions[subtypeId]?.[BSC_REFERENCE_KEY]?.[phase];
      if (!treated) return null;
      return deriveBscTransitionProbs(treated, BSC_PROGRESSION_MULTIPLIER);
    },
    getAnnualInjections: ({ subtypeId, clinicalKey, phase }) =>
      injections[subtypeId]?.[clinicalKey]?.[phase] ?? 0,
    hasInjections: (drugId, subtypeId, clinicalKey) =>
      injections[subtypeId]?.[clinicalKey] != null,
  };
}

const BASE_DATASET = makeTableDataset({
  id: "base",
  label: "ベースケース（Table S5 遷移・S6 注射）",
  hint: "遷移: Table S5 / 注射: Table S6",
  transitions: TRANS_BASE,
  injections: INJ_BASE,
});

const SCENARIO_DATASET = makeTableDataset({
  id: "scenario",
  label: "シナリオ（Table S7–S8）",
  hint: "遷移: Table S7–S8 / 注射: Table S8",
  transitions: TRANS_SCENARIO,
  injections: INJ_SCENARIO,
});

/** 2026 meta — 遷移は Table S5、注射回数のみ薬剤別メタ解析値 */
const META_2026_DATASET = {
  ...makeTableDataset({
    id: "2026_meta",
    label: "2026 meta（注射回数のみ更新）",
    hint: "遷移: Table S5 / 注射: 2026 meta（year1 固定、year≥2 = year1−3）",
    transitions: TRANS_BASE,
    injections: {},
  }),
  getAnnualInjections: ({ drugId, phase }) =>
    getInjections2026MetaForDrug(drugId)?.[phase] ?? 0,
  hasInjections: (drugId) => getInjections2026MetaForDrug(drugId) != null,
  missingInjectionsWarning: (drugName) =>
    `${drugName}: 2026 meta 注射回数が未設定`,
};

export const CLINICAL_DATASETS = {
  base: BASE_DATASET,
  scenario: SCENARIO_DATASET,
  "2026_meta": META_2026_DATASET,
};

export const CLINICAL_CASE_OPTIONS = Object.values(CLINICAL_DATASETS).map(
  ({ id, label, hint }) => ({ id, label, hint })
);

/** @returns {ClinicalDataset} */
export function getClinicalDataset(clinicalCase) {
  return CLINICAL_DATASETS[clinicalCase] ?? BASE_DATASET;
}

/**
 * 選択間隔を反映した年間注射回数 — Markov とスイッチタブで共通
 * 間隔指定あり: 52 ÷ 間隔（週）— 薬剤共通
 * 間隔指定なし: 臨床データセット（Table S6 / 2026 meta）の文献値
 */
export function getEffectiveAnnualInjectionRate({
  clinicalCase,
  subtypeId,
  drugId,
  intervalWeeks = null,
  phase = "year1",
}) {
  if (intervalWeeks != null && intervalWeeks > 0) {
    return annualInjectionsFromIntervalWeeks(intervalWeeks);
  }
  const drug = getDrug(drugId);
  if (!drug) return null;
  const dataset = getClinicalDataset(clinicalCase);
  return dataset.getAnnualInjections({
    subtypeId,
    drugId,
    // INJ_BASE/INJ_SCENARIO は S6 列（rbz_bs / aflibercept）で集約 → transitionKey で参照
    clinicalKey: drug.transitionKey ?? drug.clinicalKey,
    phase,
  });
}

/**
 * 個別患者タブ用 — 遷移（clinicalKey 別）と注射（薬剤ID 別）を返す。
 * サマリー/スイッチが使う getClinicalDataset とは別に、薬剤別注射モデル
 * （AFL 8mg/ファリ/ブロル = AFL 2mg 由来）を保持する。
 * @param {'base'|'scenario'|'2026_meta'} clinicalCase
 */
export function getClinicalTables(clinicalCase) {
  if (clinicalCase === "scenario") {
    return { transitions: TRANS_SCENARIO, injections: INJ_SCENARIO_PERDRUG };
  }
  if (clinicalCase === "2026_meta") {
    return { transitions: TRANS_BASE, injections: null };
  }
  return { transitions: TRANS_BASE, injections: INJ_BASE_PERDRUG };
}

/**
 * フェーズあたり年間注射回数（薬剤ID 別）
 * @param {'base'|'scenario'|'2026_meta'} clinicalCase
 */
export function getInjectionRate(
  clinicalCase,
  injections,
  subtypeId,
  drugId,
  phase
) {
  if (clinicalCase === "2026_meta") {
    const schedule = getInjections2026MetaForDrug(drugId);
    if (!schedule) return 0;
    return schedule[phase] ?? 0;
  }
  return injections?.[subtypeId]?.[drugId]?.[phase] ?? 0;
}

/**
 * Table S6 のフェーズ別注射パラメータ（参照表示用）
 * @returns {{ source: string, phases: Record<string, number>|null, clinicalKey: string }}
 */
export function getInjectionPhaseReference(
  clinicalCase,
  subtypeId,
  drugId,
  drugCatalog
) {
  const drug = drugCatalog?.[drugId] ?? { clinicalKey: drugId };
  const clinicalKey = drug.clinicalKey ?? drugId;
  const transitionKey = drug.transitionKey ?? getTransitionKey(drugId);
  const { injections } = getClinicalTables(clinicalCase);

  if (clinicalCase === "2026_meta") {
    const schedule = getInjections2026MetaForDrug(drugId);
    return {
      source: INJECTIONS_2026_META_SOURCE,
      clinicalKey,
      transitionKey,
      phases: schedule,
      note: "induction=3か月あたり3回換算、year1=年間回数、year2以降=year1−3",
    };
  }

  const phases = injections?.[subtypeId]?.[drugId] ?? null;
  const isReference = isAfl2mgDerivedInjection(drugId);
  return {
    source: clinicalCase === "scenario" ? "Supplementary Table S8 (scenario)" : TABLE_S6_SOURCE,
    clinicalKey,
    transitionKey,
    phases,
    isInjectionReference: isReference,
    injectionReferenceFactor: isReference ? AFL2MG_DERIVED_INJECTION_FACTOR : null,
    injectionReferenceNote: isReference ? AFL2MG_DERIVED_INJECTION_NOTE : null,
    note: isReference
      ? `参考値 — induction は薬剤別（AFL 8 mg=3, ファリ=4, ブロル=2）。year1以降は同一病型 AFL 2 mg × ${AFL2MG_DERIVED_INJECTION_FACTOR}`
      : "induction=最初3か月の回数、year1/year2/year3plus=年間回数（病型×薬剤別）",
  };
}

/**
 * カレンダー年ごとの期待注射回数（Table S6 意味論に基づく決定論的集計）
 * - induction: 参入後0–2か月に phase 値を3等分（合計=induction値）
 * - その他: 年間率 × 該当月数 / 12
 */
export function buildInjectionYearReference({
  subtypeId,
  drugId,
  clinicalCase = "base",
  timeHorizonYears = DEFAULT_HORIZON.timeHorizonYears,
  treatmentDurationYears = null,
  drugCatalog,
}) {
  const { injections } = getClinicalTables(clinicalCase);
  const ref = getInjectionPhaseReference(clinicalCase, subtypeId, drugId, drugCatalog);
  const maxMonths = Math.round(timeHorizonYears * 12);
  const rows = [];
  let lifetime = 0;

  for (let year = 0; year < timeHorizonYears; year++) {
    let expected = 0;
    for (let month = year * 12; month < Math.min((year + 1) * 12, maxMonths); month++) {
      if (!isOnTreatment(Math.floor(month / 3), 0.25, treatmentDurationYears)) continue;
      const phase = phaseForCycle(Math.floor(month / 3), 0.25);
      const rate = getInjectionRate(clinicalCase, injections, subtypeId, drugId, phase);
      if (phase === "induction" && month < 3) {
        expected += rate / 3;
      } else if (phase !== "induction") {
        expected += rate / 12;
      }
    }
    expected = Math.round(expected * 1000) / 1000;
    lifetime += expected;
    rows.push({ year, expected });
  }

  return {
    ...ref,
    rows,
    lifetime: Math.round(lifetime * 1000) / 1000,
  };
}

/** 月次の注射回数（Table S6 意味論・決定論的） */
export function injectionsForMonth(monthIndex, context) {
  const { clinicalCase, injections, subtypeId, drugId, treatmentDurationYears } = context;

  if (!isOnTreatment(Math.floor(monthIndex / 3), 0.25, treatmentDurationYears)) {
    return 0;
  }

  const phase = phaseForCycle(Math.floor(monthIndex / 3), 0.25);
  const rate = getInjectionRate(clinicalCase, injections, subtypeId, drugId, phase);

  if (phase === "induction" && monthIndex < 3) {
    return rate / 3;
  }
  if (phase === "induction") {
    return 0;
  }
  return rate / 12;
}

/**
 * Markov サイクル（四半期）あたりの注射回数
 * - induction: 最初の1サイクル（3か月）に phase 値を一括（年率×cycleLen ではない）
 * - その他: 年間回数 × cycleLengthYears
 */
export function injectionsForCycle(cycleIndex, context) {
  const {
    clinicalCase,
    injections,
    subtypeId,
    drugId,
    treatmentDurationYears,
    cycleLengthYears = 0.25,
  } = context;

  if (!isOnTreatment(cycleIndex, cycleLengthYears, treatmentDurationYears)) {
    return 0;
  }

  const phase = phaseForCycle(cycleIndex, cycleLengthYears);
  const rate = getInjectionRate(clinicalCase, injections, subtypeId, drugId, phase);

  if (phase === "induction") {
    return rate;
  }
  return rate * cycleLengthYears;
}

/**
 * 治療中止後の BSC 遷移（サブタイプ×フェーズ）— テスト・外部利用向け
 * @param {object} transitions — TRANS_BASE または TRANS_SCENARIO
 */
export function getBscTransitionProbs(transitions, subtypeId, phase) {
  const treated = transitions[subtypeId]?.[BSC_REFERENCE_KEY]?.[phase];
  if (!treated) return null;
  return deriveBscTransitionProbs(treated, BSC_PROGRESSION_MULTIPLIER);
}
