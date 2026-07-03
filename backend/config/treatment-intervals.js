/**
 * 治療間隔（週）と年間注射回数。
 * スイッチ・CMA タブ: 年間注射 = 52 ÷ 間隔（週）— 薬剤共通の単純割り算。
 * 間隔未指定の Markov（サマリー等）: Table S6 / 2026 meta の文献値を使用。
 */
export const REFERENCE_INTERVAL_WEEKS = 8;

export const TREATMENT_INTERVAL_OPTIONS = [
  { weeks: 4, label: "Q4（4週毎）" },
  { weeks: 6, label: "Q6（6週毎）" },
  { weeks: 8, label: "Q8（8週毎）" },
  { weeks: 10, label: "Q10（10週毎）" },
  { weeks: 12, label: "Q12（12週毎）" },
  { weeks: 16, label: "Q16（16週毎）" },
  { weeks: 20, label: "Q20（20週毎）" },
];

export function getIntervalOption(weeks) {
  return TREATMENT_INTERVAL_OPTIONS.find((o) => o.weeks === weeks) ?? null;
}

/** 参考: 定常 T&E の年間注射回数（52週 ÷ 間隔） */
export function annualInjectionsFromIntervalWeeks(weeks) {
  if (!weeks || weeks <= 0) return 0;
  return 52 / weeks;
}

/** Table S6 等のベース注射回数を、選択間隔へ比例換算する倍率 */
export function injectionScaleForIntervalWeeks(intervalWeeks) {
  if (!intervalWeeks || intervalWeeks <= 0) return 1;
  return REFERENCE_INTERVAL_WEEKS / intervalWeeks;
}

export function formatIntervalLabel(weeks) {
  const opt = getIntervalOption(weeks);
  if (opt) return opt.label;
  return `Q${weeks}（${weeks}週毎）`;
}
