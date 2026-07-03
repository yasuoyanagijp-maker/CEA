import { deriveBscTransitionProbs } from "./utils.js";
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
export const INJ_BASE = INJ_BASE_TABLE_S6;
export const INJ_SCENARIO = INJ_SCENARIO_TABLE_S8;

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
 * 治療中止後の BSC 遷移（サブタイプ×フェーズ）— テスト・外部利用向け
 * @param {object} transitions — TRANS_BASE または TRANS_SCENARIO
 */
export function getBscTransitionProbs(transitions, subtypeId, phase) {
  const treated = transitions[subtypeId]?.[BSC_REFERENCE_KEY]?.[phase];
  if (!treated) return null;
  return deriveBscTransitionProbs(treated, BSC_PROGRESSION_MULTIPLIER);
}
