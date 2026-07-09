/**
 * 日本の健康保険 — 患者自己負担・高額療養費（外来・月次）
 *
 * 平成30年8月改定以降の現行限度額（2026年7月時点）。
 * 2025年8月施行予定だった限度額引き上げは見送り、2026年8月施行予定の
 * 引き上げ・年間上限の新設は未施行のため反映しない。
 * 複数回受診の合算は月次で処理する。
 *
 * 簡略化している点:
 * - 70歳以上・一般区分の外来年間上限（14.4万円）は月次モデルでは未適用
 * - 75歳以上・一般区分の2割負担（令和4年10月〜、一定所得以上）は未対応（1割固定）
 * - 多数回該当（4回目以降の限度額軽減）は未適用
 *
 * @see 厚生労働省「高額療養費制度について」
 */

/**
 * 所得区分 — 年収は目安（70歳未満はア〜オ、70歳以上は一般・現役並みI〜IIIに対応）
 * 70歳以上の一般/現役並みの境界（課税所得145万円 ≈ 年収約370万円）は
 * 70歳未満のエ/ウ境界（〜年収約370万円）とほぼ一致するため同一区分で扱う。
 */
export const INCOME_BRACKETS = {
  low: { id: "low", label: "住民税非課税", tier: "A" },
  standard: { id: "standard", label: "一般（〜年収約370万円）", tier: "I" },
  general: { id: "general", label: "年収約370〜770万円（現役並みI）", tier: "U" },
  high: { id: "high", label: "年収約770〜1,160万円（現役並みII）", tier: "E" },
  top: { id: "top", label: "年収約1,160万円〜（現役並みIII）", tier: "O" },
};

export const INCOME_BRACKET_LIST = Object.values(INCOME_BRACKETS);

/** 70歳以上の現役並み所得者（3割負担・外来特例なし） */
function isActiveIncomeElderly(tier) {
  return tier === "U" || tier === "E" || tier === "O";
}

/**
 * 年齢・所得区分に応じた自己負担割合
 * @param {number} age — 満年齢
 * @param {'early_elderly_10'|null} [elderlyCopay] — 70–74歳・一般で1割の場合
 * @param {keyof typeof INCOME_BRACKETS} [incomeBracket]
 */
export function getCopayRate(age, elderlyCopay = null, incomeBracket = "standard") {
  const tier = INCOME_BRACKETS[incomeBracket]?.tier ?? "I";
  if (age >= 70 && isActiveIncomeElderly(tier)) return 0.3;
  if (age >= 75) return 0.1;
  if (age >= 70) {
    return elderlyCopay === "early_elderly_10" ? 0.1 : 0.2;
  }
  return 0.3;
}

/**
 * 月次自己負担限度額（円）
 * - 70歳以上: 外来特例（個人ごと）。現役並みは特例廃止（平成30年〜）のため世帯限度額と同一
 * - 70歳未満: 外来特例なし — 高額療養費の月単位限度額（ア〜オ）を適用
 * @param {number} age
 * @param {keyof typeof INCOME_BRACKETS} incomeBracket
 * @param {number} [monthlyTotalMedical=0] — 定率1%加算の計算用（総医療費・10割）
 */
export function getMonthlyOutpatientLimit(age, incomeBracket, monthlyTotalMedical = 0) {
  const tier = INCOME_BRACKETS[incomeBracket]?.tier ?? "I";

  // 現役並みI〜III / ウ・イ・ア相当 — 年齢によらず同一の定率加算式
  switch (tier) {
    case "U":
      return 80_100 + Math.max(0, monthlyTotalMedical - 267_000) * 0.01;
    case "E":
      return 167_400 + Math.max(0, monthlyTotalMedical - 558_000) * 0.01;
    case "O":
      return 252_600 + Math.max(0, monthlyTotalMedical - 842_000) * 0.01;
  }

  if (age >= 70) {
    // 外来特例（個人ごと）
    return tier === "A" ? 8_000 : 18_000;
  }

  // 70歳未満 — 外来特例はなく月単位の限度額（オ: 35,400 / エ: 57,600）
  return tier === "A" ? 35_400 : 57_600;
}

/** 患者向け表示用の出典・時点表記 */
export const NHI_SOURCE_NOTE =
  "厚生労働省「高額療養費制度について」— 2026年7月時点の現行値（2026年8月改定は未反映）";

/**
 * 月次限度額の表示用ラベル — 定率加算のある区分は式のまま示す
 * （値は getMonthlyOutpatientLimit と同一のものを文字列化）
 * @param {number} age
 * @param {keyof typeof INCOME_BRACKETS} incomeBracket
 */
export function describeMonthlyLimit(age, incomeBracket) {
  const tier = INCOME_BRACKETS[incomeBracket]?.tier ?? "I";
  if (isActiveIncomeElderly(tier)) {
    const base = getMonthlyOutpatientLimit(age, incomeBracket, 0);
    const threshold = { U: 267_000, E: 558_000, O: 842_000 }[tier];
    return `${base.toLocaleString("ja-JP")}円＋(医療費−${threshold.toLocaleString("ja-JP")}円)×1%`;
  }
  return `${getMonthlyOutpatientLimit(age, incomeBracket, 0).toLocaleString("ja-JP")}円`;
}

/**
 * 月内の医療費合計に対する患者自己負担（高額療養費上限適用）
 *
 * 上限は「定額請求」ではなく天井（cap）である。
 * 定率負担（1割・2割・3割）が月次限度額未満なら、限度額ぴったりではなく
 * 定率負担額のまま返す（例: 75歳・一般・上限18,000円でも、1割が15,172円なら15,172円）。
 * これは制度上・本シミュレーション仕様上ともに正しい。
 *
 * @param {object} opts
 * @param {number} opts.monthlyDirectMedical — 当月の直接医療費（保険点数換算前の総額）
 * @param {number} opts.age
 * @param {keyof typeof INCOME_BRACKETS} opts.incomeBracket
 * @param {'early_elderly_10'|null} [opts.elderlyCopay]
 */
export function computeMonthlyPatientOop({
  monthlyDirectMedical,
  age,
  incomeBracket,
  elderlyCopay = null,
}) {
  if (monthlyDirectMedical <= 0) {
    return {
      patientOop: 0,
      copayRate: getCopayRate(age, elderlyCopay, incomeBracket),
      limit: 0,
    };
  }

  const copayRate = getCopayRate(age, elderlyCopay, incomeBracket);
  const nominalOop = monthlyDirectMedical * copayRate;
  const limit = getMonthlyOutpatientLimit(age, incomeBracket, monthlyDirectMedical);

  return {
    patientOop: Math.min(nominalOop, limit),
    copayRate,
    limit,
    nominalOop,
    capped: nominalOop > limit,
  };
}
