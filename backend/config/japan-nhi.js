/**
 * 日本の健康保険 — 患者自己負担・高額療養費（外来・月次）
 *
 * 令和6年（2024）8月改定の限度額を簡略化。
 * 複数回受診の合算は月次で処理する。
 *
 * @see 厚生労働省「高額療養費制度について」
 */

/** 所得区分（外来） */
export const INCOME_BRACKETS = {
  low: { id: "low", label: "ア（低所得）", tier: "A" },
  standard: { id: "standard", label: "イ（一般）", tier: "I" },
  general: { id: "general", label: "ウ（一般上位）", tier: "U" },
  high: { id: "high", label: "エ（高所得）", tier: "E" },
  top: { id: "top", label: "オ（上位所得）", tier: "O" },
};

export const INCOME_BRACKET_LIST = Object.values(INCOME_BRACKETS);

/**
 * 年齢・性別に応じた自己負担割合
 * @param {number} age — 満年齢
 * @param {'early_elderly_10'|null} [elderlyCopay] — 70–74歳で1割の場合
 */
export function getCopayRate(age, elderlyCopay = null) {
  if (age >= 75) return 0.1;
  if (age >= 70) {
    return elderlyCopay === "early_elderly_10" ? 0.1 : 0.2;
  }
  return 0.3;
}

/**
 * 外来の月次自己負担限度額（円）
 * @param {number} age
 * @param {keyof typeof INCOME_BRACKETS} incomeBracket
 * @param {number} [monthlyTotalMedical=0] — エ・オ区分の加算計算用
 */
export function getMonthlyOutpatientLimit(age, incomeBracket, monthlyTotalMedical = 0) {
  const tier = INCOME_BRACKETS[incomeBracket]?.tier ?? "I";

  if (age >= 75) {
    switch (tier) {
      case "A":
        return 8_000;
      case "I":
        return 18_000;
      case "U":
        return 57_600;
      case "E":
        return 83_400 + Math.max(0, monthlyTotalMedical - 352_500) * 0.01;
      case "O":
        return 252_600 + Math.max(0, monthlyTotalMedical - 842_000) * 0.01;
      default:
        return 18_000;
    }
  }

  if (age >= 70) {
    switch (tier) {
      case "A":
        return 8_000;
      case "I":
        return 18_000;
      case "U":
        return 57_600;
      case "E":
        return 80_100 + Math.max(0, monthlyTotalMedical - 267_000) * 0.01;
      case "O":
        return 267_000 + Math.max(0, monthlyTotalMedical - 801_000) * 0.01;
      default:
        return 18_000;
    }
  }

  switch (tier) {
    case "A":
      return 8_000;
    case "I":
      return 18_000;
    case "U":
      return 57_600;
    case "E":
      return 80_100 + Math.max(0, monthlyTotalMedical - 267_000) * 0.01;
    case "O":
      return 267_000 + Math.max(0, monthlyTotalMedical - 801_000) * 0.01;
    default:
      return 18_000;
  }
}

/**
 * 月内の医療費合計に対する患者自己負担（高額療養費上限適用）
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
  if (monthlyDirectMedical <= 0) return { patientOop: 0, copayRate: getCopayRate(age, elderlyCopay), limit: 0 };

  const copayRate = getCopayRate(age, elderlyCopay);
  const nominalOop = monthlyDirectMedical * copayRate;
  const tier = INCOME_BRACKETS[incomeBracket]?.tier ?? "I";

  let limit;
  if (tier === "E" || tier === "O") {
    limit = getMonthlyOutpatientLimit(age, incomeBracket, monthlyDirectMedical);
  } else {
    limit = getMonthlyOutpatientLimit(age, incomeBracket);
  }

  return {
    patientOop: Math.min(nominalOop, limit),
    copayRate,
    limit,
    nominalOop,
    capped: nominalOop > limit,
  };
}
