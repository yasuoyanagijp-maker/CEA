/**
 * 日本の健康保険 — 患者自己負担・高額療養費（外来・月次）
 *
 * 令和8年8月1日改定後の限度額（2026年8月〜2027年7月）。
 * 出典: https://www.kenpo.gr.jp/sogo-seibu/topics/r8houkai/houkai0801.htm
 *
 * 簡略化している点:
 * - 70歳以上・一般区分の外来年間上限（21.6万円）は月次モデルでは未適用
 * - 75歳以上の一般は一般I（1割）として扱う。一般II（2割、令和4年10月〜）は未対応
 * - 70歳以上・住民税非課税は非課税世帯II（外来 11,000円）として扱う。
 *   非課税世帯I（一定所得以下・外来 8,000円）は区分していない
 * - 多数回該当（4回目以降の限度額軽減）は未適用
 * - 年間上限の新設は未適用
 *
 * 「+1%」は（月の総医療費 − 定額上限÷0.3）×1%（上記 kenpo 解説）。
 */

/**
 * 所得区分 — 年収は目安（70歳未満はア〜オ、70歳以上は一般・現役並みI〜IIIに対応）
 * 70歳以上の一般/現役並みの境界（課税所得145万円 ≈ 年収約370万円）は
 * 70歳未満のエ/ウ境界（〜年収約370万円）とほぼ一致するため同一区分で扱う。
 */
export const INCOME_BRACKETS = {
  low: { id: "low", label: "住民税非課税（非課税II）", tier: "A" },
  standard: {
    id: "standard",
    label: "一般I（〜年収約370万円・75歳以上は1割負担。一般IIの2割は未対応）",
    tier: "I",
  },
  general: { id: "general", label: "年収約370〜770万円（現役並みI）", tier: "U" },
  high: { id: "high", label: "年収約770〜1,160万円（現役並みII）", tier: "E" },
  top: { id: "top", label: "年収約1,160万円〜（現役並みIII）", tier: "O" },
};

export const INCOME_BRACKET_LIST = Object.values(INCOME_BRACKETS);

/** 70歳以上の現役並み所得者（3割負担・外来特例なし） */
function isActiveIncomeElderly(tier) {
  return tier === "U" || tier === "E" || tier === "O";
}

/** 定率加算の基準医療費 = 定額上限 ÷ 0.3 */
const ACTIVE_INCOME_LIMITS = {
  U: { base: 85_800, threshold: 286_000 },
  E: { base: 179_100, threshold: 597_000 },
  O: { base: 270_300, threshold: 901_000 },
};

/**
 * 年齢・所得区分に応じた自己負担割合
 * 75歳以上・一般（standard）は一般I（1割）。一般II（2割）は未対応。
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
 * 月次自己負担限度額（円）— 2026年8月改定後
 * - 70歳以上: 外来特例（個人ごと）。現役並みは特例なしのため世帯限度額と同一
 * - 70歳未満: 外来特例なし — 高額療養費の月単位限度額（ア〜オ）を適用
 * @param {number} age
 * @param {keyof typeof INCOME_BRACKETS} incomeBracket
 * @param {number} [monthlyTotalMedical=0] — 定率1%加算の計算用（総医療費・10割）
 */
export function getMonthlyOutpatientLimit(age, incomeBracket, monthlyTotalMedical = 0) {
  const tier = INCOME_BRACKETS[incomeBracket]?.tier ?? "I";

  if (ACTIVE_INCOME_LIMITS[tier]) {
    const { base, threshold } = ACTIVE_INCOME_LIMITS[tier];
    return base + Math.max(0, monthlyTotalMedical - threshold) * 0.01;
  }

  if (age >= 70) {
    // 外来特例（個人ごと）: 一般 22,000 / 非課税II 11,000
    return tier === "A" ? 11_000 : 22_000;
  }

  // 70歳未満 — オ: 36,900 / エ: 61,500
  return tier === "A" ? 36_900 : 61_500;
}

/** 患者向け表示用の出典・時点表記 */
export const NHI_SOURCE_NOTE =
  "健康保険組合連合会（総合西部）「2026年8月から高額療養費制度が変わりました」（kenpo.gr.jp r8houkai/houkai0801）— 2026年8月1日改定後の値";

/**
 * 月次限度額の表示用ラベル — 定率加算のある区分は式のまま示す
 * （値は getMonthlyOutpatientLimit と同一のものを文字列化）
 * @param {number} age
 * @param {keyof typeof INCOME_BRACKETS} incomeBracket
 */
export function describeMonthlyLimit(age, incomeBracket) {
  const tier = INCOME_BRACKETS[incomeBracket]?.tier ?? "I";
  if (isActiveIncomeElderly(tier)) {
    const { base, threshold } = ACTIVE_INCOME_LIMITS[tier];
    return `${base.toLocaleString("ja-JP")}円＋(医療費−${threshold.toLocaleString("ja-JP")}円)×1%`;
  }
  return `${getMonthlyOutpatientLimit(age, incomeBracket, 0).toLocaleString("ja-JP")}円`;
}

/**
 * 患者説明カード用。上限に達した月があるときだけ「上限を適用」。
 * 達しないときは定率負担である旨と月上限を出す。金額は変えない。
 */
export function describeInjMonthOopCapNote({ capped, age, incomeBracket }) {
  if (capped) return "上限を適用";
  return `定率負担（月上限 ${describeMonthlyLimit(age, incomeBracket)}未満）`;
}

/**
 * 月内の医療費合計に対する患者自己負担（高額療養費上限適用）
 *
 * 上限は「定額請求」ではなく天井（cap）である。
 * 定率負担（1割・2割・3割）が月次限度額未満なら、限度額ぴったりではなく
 * 定率負担額のまま返す（例: 75歳・一般I・上限22,000円でも、1割が15,172円なら15,172円）。
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
