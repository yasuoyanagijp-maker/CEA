/**
 * 2026 meta-analysis — nAMD 年間注射回数（year 1）
 * year 2 以降は year1 − 3（0 未満は 0）
 * 導入期（最初の3か月）は Table S6 と同様 3.0 回/年換算
 */

export const INJECTIONS_2026_META_SOURCE =
  "2026 meta-analysis regimen (year 1); year ≥2 = year1 − 3";

/** @type {Record<string, number>} drugId → year 1 mean injections */
export const INJECTIONS_2026_META_YEAR1 = {
  faricimab: 6.45,
  aflibercept_8mg: 5.5,
  aflibercept: 7.67,
  aflibercept_bs: 7.67,
  ranibizumab: 9.85,
  ranibizumab_bs: 9.85,
  brolucizumab: 6.3,
};

export const INJECTIONS_2026_META_INDUCTION = 3.0;
export const INJECTIONS_2026_META_YEAR2_OFFSET = 3;

/** @param {number} year1 */
export function buildInjectionPhasesFromYear1(
  year1,
  { induction = INJECTIONS_2026_META_INDUCTION, year2Offset = INJECTIONS_2026_META_YEAR2_OFFSET } = {}
) {
  const later = Math.max(0, year1 - year2Offset);
  return {
    induction,
    year1,
    year2: later,
    year3plus: later,
  };
}

/** @param {string} drugId */
export function getInjections2026MetaForDrug(drugId) {
  const y1 = INJECTIONS_2026_META_YEAR1[drugId];
  if (y1 == null) return null;
  return buildInjectionPhasesFromYear1(y1);
}

/** UI 用 — 薬剤名とフェーズ別回数 */
export function listInjections2026MetaSummary(drugCatalog) {
  return Object.entries(INJECTIONS_2026_META_YEAR1).map(([drugId, year1]) => {
    const phases = buildInjectionPhasesFromYear1(year1);
    return {
      drugId,
      name: drugCatalog[drugId]?.name ?? drugId,
      year1,
      year2plus: phases.year2,
    };
  });
}
