/**
 * 感度分析 — 2025–2026 に確認できた注射回数。
 * 遷移は Table S5 のまま。既定（2026 meta）は変えない。
 *
 * 文献にある year1 だけ差し替え。無いセルは 2026 meta の既存値＋（専門家による推計）。
 * year2+ はいずれの文献も1年ホライズンのため既存 year2 を据え置き。
 */

import {
  buildInjectionPhasesFromYear1,
  getInjections2026MetaForDrug,
  INJECTIONS_2026_META_YEAR1,
  INJECTIONS_2026_META_YEAR2PLUS_OVERRIDES,
} from "./injections-2026-meta.js";

export const CLINICAL_CASE_LIT_2025 = "lit_2025_2026";

export const INJECTIONS_LIT_2025_SOURCE =
  "感度分析: 確認文献の1年目回数。無いセルは 2026 meta 既存値（専門家による推計）。2年目以降は文献なしのため既存 year2 を据え置き";

/** 文献で year1 を置き換えた薬剤。それ以外は 2026 meta を流用 */
export const LIT_2025_YEAR1_OVERRIDE = {
  aflibercept_8mg: 5.55,
  aflibercept: 7.0,
  aflibercept_bs: 7.0,
  faricimab: 6.5,
  brolucizumab: 6.3,
};

export const LIT_2025_YEAR1_SOURCE = {
  aflibercept_8mg:
    "PULSAR 日本サブ解析（Iida 2025, Jpn J Ophthalmol）週48完了例 8q12 6.1 / 8q16 5.0 の中点",
  aflibercept: "PULSAR 日本サブ解析（Iida 2025）週48完了例 2q8 7.0",
  aflibercept_bs: "PULSAR 日本サブ解析（Iida 2025）週48完了例 2q8 7.0（2 mg と同一回数）",
  faricimab:
    "Okawa 2025 PMID 40698349 日本未治療 T&E 6.5±1.0（FARETINA-AMD 未治療 6.4、El Alili 2026 スイッチ 7.05 は未採用）",
  brolucizumab: "Matsumoto 2022 6.4 / Inoda 2024 naïve 6.2 の中点（2026 meta と同じ）",
  ranibizumab:
    "当該セットに新文献なし。Wojciechowski Table 2 Q4 12.14 / Q8 7.62 の中点 9.88 を流用",
  ranibizumab_bs:
    "当該セットに新文献なし。Wojciechowski Table 2 中点 9.88 を流用（先発と同一）",
};

export const LIT_2025_PHASE_IS_ESTIMATE = {
  faricimab: { induction: true, year1: false, year2: true, year3plus: true },
  aflibercept_8mg: { induction: true, year1: false, year2: true, year3plus: true },
  aflibercept: { induction: true, year1: false, year2: true, year3plus: true },
  aflibercept_bs: { induction: true, year1: false, year2: true, year3plus: true },
  ranibizumab: { induction: true, year1: true, year2: true, year3plus: true },
  ranibizumab_bs: { induction: true, year1: true, year2: true, year3plus: true },
  brolucizumab: { induction: true, year1: false, year2: true, year3plus: true },
};

/** @param {string} drugId */
export function getInjectionsLit2025ForDrug(drugId) {
  const year1 = LIT_2025_YEAR1_OVERRIDE[drugId] ?? INJECTIONS_2026_META_YEAR1[drugId];
  if (year1 == null) return null;
  const existing = getInjections2026MetaForDrug(drugId);
  return buildInjectionPhasesFromYear1(year1, {
    year2plus:
      existing?.year2 ?? INJECTIONS_2026_META_YEAR2PLUS_OVERRIDES[drugId] ?? null,
  });
}

/** UI 用 */
export function listInjectionsLit2025Summary(drugCatalog) {
  const ids = Object.keys(INJECTIONS_2026_META_YEAR1);
  return ids.map((drugId) => {
    const phases = getInjectionsLit2025ForDrug(drugId);
    const flags = LIT_2025_PHASE_IS_ESTIMATE[drugId] ?? {};
    return {
      drugId,
      name: drugCatalog[drugId]?.name ?? drugId,
      year1: phases?.year1,
      year2plus: phases?.year2,
      year1Estimate: flags.year1 === true,
      year2plusEstimate: flags.year2 === true,
      year1Source: LIT_2025_YEAR1_SOURCE[drugId] ?? "",
      fromNewLiterature: Object.hasOwn(LIT_2025_YEAR1_OVERRIDE, drugId),
    };
  });
}
