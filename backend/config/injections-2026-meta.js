/**
 * 2026 meta-analysis — nAMD 年間注射回数（year 1）
 * year 2 以降は year1 − 3（0 未満は 0）
 * 導入期（最初の3か月）は Table S6 と同様 3.0 回/年換算
 */

export const INJECTIONS_2026_META_SOURCE =
  "2026 meta-analysis regimen (year 1); year ≥2 = year1 − 3";

/**
 * drugId → year 1 平均注射回数 + その値が報告されたレジメンの参考間隔（週）
 * UI で Q8 等を選んだときは meta 値 × (referenceIntervalWeeks / 選択間隔) でスケール
 */
export const INJECTIONS_2026_META_YEAR1 = {
  faricimab: 6.45,
  aflibercept_8mg: 5.5,
  aflibercept: 7.67,
  aflibercept_bs: 7.67,
  ranibizumab: 9.85,
  ranibizumab_bs: 9.85,
  brolucizumab: 6.3,
};

/** @type {Record<string, { referenceIntervalWeeks: number, regimenLabel: string }>} */
export const INJECTIONS_2026_META_REGIMEN = {
  aflibercept: { referenceIntervalWeeks: 8, regimenLabel: "Q8 T&E" },
  aflibercept_bs: { referenceIntervalWeeks: 8, regimenLabel: "Q8 T&E" },
  aflibercept_8mg: { referenceIntervalWeeks: 12, regimenLabel: "Q12–Q16" },
  faricimab: { referenceIntervalWeeks: 8, regimenLabel: "T&E / extended" },
  ranibizumab: { referenceIntervalWeeks: 6, regimenLabel: "Q4–Q6 PRN/T&E" },
  ranibizumab_bs: { referenceIntervalWeeks: 6, regimenLabel: "Q4–Q6 PRN/T&E" },
  brolucizumab: { referenceIntervalWeeks: 8, regimenLabel: "Q8 TAE 相当" },
};

/** @param {string} drugId */
export function getMetaReferenceIntervalWeeks(drugId) {
  return (
    INJECTIONS_2026_META_REGIMEN[drugId]?.referenceIntervalWeeks ?? 8
  );
}

/** @param {string} drugId */
export function getMetaRegimenLabel(drugId) {
  return INJECTIONS_2026_META_REGIMEN[drugId]?.regimenLabel ?? "Q8 相当";
}

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
