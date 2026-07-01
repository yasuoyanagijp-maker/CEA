/**
 * 薬剤別 clinical プロファイル
 * - clinicalKey = drugId（薬剤ごとに独立）
 * - transitionKey = Table S5 列（rbz_bs | aflibercept）
 * - 注射回数 = 病型（typical / PCV / RAP）× 薬剤別 Table S6 実臨床データ
 */

import { DRUG_IDS } from "../drugs.js";
import { TABLE_S6_RAW } from "./table-s6-injections.js";

/** Table S5 遷移列 — 論文2は rbz_bs / aflibercept の2列 */
export const DRUG_TRANSITION_KEY = {
  ranibizumab: "rbz_bs",
  ranibizumab_bs: "rbz_bs",
  aflibercept: "aflibercept",
  aflibercept_bs: "aflibercept",
  aflibercept_8mg: "aflibercept",
  faricimab: "aflibercept",
  brolucizumab: "aflibercept",
};

/** S6 未掲載 — induction は薬剤別、year1以降は同一病型 AFL 2 mg × 係数 */
export const AFL2MG_DERIVED_DRUG_IDS = ["aflibercept_8mg", "faricimab", "brolucizumab"];
export const AFL2MG_DERIVED_INJECTION_FACTOR = 0.8;
/** @type {Record<string, { induction: number }>} */
export const AFL2MG_DERIVED_INJECTION_OVERRIDES = {
  aflibercept_8mg: { induction: 3 },
  faricimab: { induction: 4 },
  brolucizumab: { induction: 2 },
};
export const AFL2MG_DERIVED_INJECTION_NOTE =
  "参考値: induction は薬剤別（AFL 8 mg=3, ファリ=4, ブロル=2）。year1以降は同一病型 AFL 2 mg × 0.8。S6 未掲載のため暫定。";

/** Supplementary Table S8 — scenario 注射回数（clinical.js 由来） */
const S8_SCENARIO_RAW = {
  typical: {
    rbz_bs: { induction: 3.0, year1: 1.2, year2: 2.0, year3plus: 1.6 },
    aflibercept: { induction: 3.0, year1: 1.5, year2: 1.9, year3plus: 1.3 },
  },
  pcv: {
    rbz_bs: { induction: 3.0, year1: 1.1, year2: 2.0, year3plus: 1.4 },
    aflibercept: { induction: 3.0, year1: 1.5, year2: 1.8, year3plus: 1.7 },
  },
  rap: {
    rbz_bs: { induction: 3.0, year1: 4.2, year2: 4.7, year3plus: 4.7 },
    aflibercept: { induction: 3.0, year1: 4.7, year2: 4.9, year3plus: 4.9 },
  },
};

const RBZ_FAMILY = ["ranibizumab", "ranibizumab_bs"];
const AFL_FAMILY = ["aflibercept", "aflibercept_bs"];

const SUBTYPE_IDS = ["typical", "pcv", "rap"];

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/** @param {string} drugId */
export function getTransitionKey(drugId) {
  return DRUG_TRANSITION_KEY[drugId] ?? drugId;
}

/** @param {string} drugId */
export function isAfl2mgDerivedInjection(drugId) {
  return AFL2MG_DERIVED_DRUG_IDS.includes(drugId);
}

/** AFL 2 mg フェーズ別注射 × 係数（induction は薬剤別上書き可） */
export function deriveInjectionFromAfl2mg(
  afl2mgPhases,
  drugId,
  factor = AFL2MG_DERIVED_INJECTION_FACTOR
) {
  const derived = {
    induction: round3(afl2mgPhases.induction * factor),
    year1: round3(afl2mgPhases.year1 * factor),
    year2: round3(afl2mgPhases.year2 * factor),
    year3plus: round3(afl2mgPhases.year3plus * factor),
  };
  const override = AFL2MG_DERIVED_INJECTION_OVERRIDES[drugId];
  if (override?.induction != null) {
    derived.induction = override.induction;
  }
  return derived;
}

function expandSubtypeInjections(subtypeId, sourceTable) {
  const s6Row = sourceTable[subtypeId];
  const out = {};

  for (const drugId of RBZ_FAMILY) {
    out[drugId] = { ...s6Row.rbz_bs };
  }
  for (const drugId of AFL_FAMILY) {
    out[drugId] = { ...s6Row.aflibercept };
  }
  for (const drugId of AFL2MG_DERIVED_DRUG_IDS) {
    out[drugId] = deriveInjectionFromAfl2mg(s6Row.aflibercept, drugId);
  }

  return out;
}

/**
 * 病型 × 薬剤ID の注射テーブル（全 DRUG_IDS）
 * @param {'base'|'scenario'} mode
 */
export function buildInjectionsByDrugSubtype(mode = "base") {
  const source = mode === "scenario" ? S8_SCENARIO_RAW : TABLE_S6_RAW;
  const table = {};
  for (const subtypeId of SUBTYPE_IDS) {
    table[subtypeId] = expandSubtypeInjections(subtypeId, source);
  }
  return table;
}

/** 全薬剤が病型別注射データを持つか検証 */
export function validateInjectionCoverage(injections) {
  const missing = [];
  for (const subtypeId of SUBTYPE_IDS) {
    for (const drugId of DRUG_IDS) {
      if (!injections?.[subtypeId]?.[drugId]) {
        missing.push(`${subtypeId}×${drugId}`);
      }
    }
  }
  return missing;
}

export { S8_SCENARIO_RAW as TABLE_S8_SCENARIO_RAW };
