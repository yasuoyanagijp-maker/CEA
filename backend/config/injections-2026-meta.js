/**
 * 2026 meta — nAMD 注射回数
 *
 * 1年目（year1）の出典（主に Wojciechowski 2025 NMA, PMID 39994103 の範囲）:
 *   - 8 mg 5.9（Q12）/ 5.1（Q16）→ 5.5 は中点
 *   - ファリシマブ 6.2〜6.7 → 6.45 は中点
 *   - ラニビズマブ 7.62〜12.14 → 9.85 はほぼ中点
 *   - AFL 2 mg「up to 7.67」→ 上限値
 *   - ブロルシズマブ 6.3 は当該 NMA になく、日本の TAE 研究（Matsumoto 6.4、Inoda 6.2）由来
 * 抄録の1年目回数は導入期を含む総数。2年目以降 = year1 − 3 は文献値ではなくモデル上の仮定。
 * AFL 8 mg の year2+ のみ Q16 維持（52/16 = 3.25）で上書き。
 *
 * 配分: 最初の12か月の合計 = year1（導入期3回を二重計上しない）。
 *   - 導入期（最初3か月 / cycle 0）: 3回
 *   - 月3–11 / cycle 1–3: (year1 − 3) を均等
 *   - 12か月目以降: year2 を年率
 * 遷移のフェーズ境界（phaseForCycle）は変えない。
 */

export const INJECTIONS_2026_META_SOURCE =
  "2026 meta: 1年目は主に Wojciechowski 2025 の範囲中点（AFL 2mg は上限）。ブロルシズマブは日本 TAE。2年目以降とラニビズマブ 9.85 は原典に当該数値なし（専門家による推計）";

/**
 * 照合で原典の数値が見つからないフェーズ。値は変えない。
 * year1 の 5.5 / 6.45 / 7.67 / 6.3 は文献値または報告2値の中点。
 * ラニビズマブ 9.85 は Table 2 に無く、Q4 12.14 / Q8 7.62 の中点 9.88 とも一致しない。
 */
export const META_2026_PHASE_IS_ESTIMATE = {
  faricimab: { induction: true, year1: false, year2: true, year3plus: true },
  aflibercept_8mg: { induction: true, year1: false, year2: true, year3plus: true },
  aflibercept: { induction: true, year1: false, year2: true, year3plus: true },
  aflibercept_bs: { induction: true, year1: false, year2: true, year3plus: true },
  ranibizumab: { induction: true, year1: true, year2: true, year3plus: true },
  ranibizumab_bs: { induction: true, year1: true, year2: true, year3plus: true },
  brolucizumab: { induction: true, year1: false, year2: true, year3plus: true },
};

/**
 * drugId → year 1 総注射回数（導入期を含む）+ その値が報告されたレジメンの参考間隔（週）
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
  aflibercept_8mg: { referenceIntervalWeeks: 16, regimenLabel: "Q16" },
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

export const INJECTIONS_2026_META_YEAR2PLUS_OVERRIDES = {
  aflibercept_8mg:
    52 / INJECTIONS_2026_META_REGIMEN.aflibercept_8mg.referenceIntervalWeeks,
};

/** @param {number} year1 */
export function buildInjectionPhasesFromYear1(
  year1,
  {
    induction = INJECTIONS_2026_META_INDUCTION,
    year2Offset = INJECTIONS_2026_META_YEAR2_OFFSET,
    year2plus = null,
  } = {}
) {
  const later = year2plus ?? Math.max(0, year1 - year2Offset);
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
  return buildInjectionPhasesFromYear1(y1, {
    year2plus: INJECTIONS_2026_META_YEAR2PLUS_OVERRIDES[drugId] ?? null,
  });
}

/**
 * 2026 meta の四半期あたり注射回数。
 * 最初の12か月（cycle 0–3）の合計 = year1（導入期を含む）。
 */
export function metaInjectionsForCycle(drugId, cycleIndex, cycleLengthYears = 0.25) {
  const schedule = getInjections2026MetaForDrug(drugId);
  if (!schedule) return 0;
  if (cycleIndex <= 0) return schedule.induction;
  const elapsedYears = cycleIndex * cycleLengthYears;
  if (elapsedYears < 1) {
    const remaining = Math.max(0, schedule.year1 - schedule.induction);
    const maintCycles = Math.max(1, Math.round(1 / cycleLengthYears) - 1);
    return remaining / maintCycles;
  }
  return schedule.year2 * cycleLengthYears;
}

/**
 * 2026 meta の月次注射回数。
 * 月0–2＝導入（合計3回）、月3–11＝(year1−3)/9、月12以降＝year2/12。
 */
export function metaInjectionsForMonth(drugId, monthIndex) {
  const schedule = getInjections2026MetaForDrug(drugId);
  if (!schedule) return 0;
  if (monthIndex < 3) return schedule.induction / 3;
  if (monthIndex < 12) return Math.max(0, schedule.year1 - schedule.induction) / 9;
  return schedule.year2 / 12;
}

/** UI 用 — 薬剤名とフェーズ別回数 */
export function listInjections2026MetaSummary(drugCatalog) {
  return Object.entries(INJECTIONS_2026_META_YEAR1).map(([drugId, year1]) => {
    const phases = getInjections2026MetaForDrug(drugId);
    const flags = META_2026_PHASE_IS_ESTIMATE[drugId] ?? {};
    return {
      drugId,
      name: drugCatalog[drugId]?.name ?? drugId,
      year1,
      year2plus: phases.year2,
      year1Estimate: flags.year1 === true,
      year2plusEstimate: flags.year2 === true,
    };
  });
}
