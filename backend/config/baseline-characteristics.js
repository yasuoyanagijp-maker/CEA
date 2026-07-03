/**
 * Baseline characteristics
 * - 年齢・両眼罹患・平均 BCVA: Yoneda et al. [1]
 * - 5状態の初期分布: Supplementary Table S2 (Yoneda et al. [1])
 */

/** 5状態の小数 BCVA カテゴリー中央値（無・軽・中・重・失明） */
export const STATE_BCVA_CENTROIDS = [0.625, 0.437, 0.2, 0.075, 0.025];

/** Yoneda [1] — モデル参入時の人口統計 */
const YONEDA_BASELINE = {
  typical: {
    meanAge: 75,
    bothEyesBaseline: 0.198,
    baselineBcvaAffected: 0.43,
    baselineBcvaFellow: 0.18,
  },
  pcv: {
    meanAge: 74,
    bothEyesBaseline: 0.168,
    baselineBcvaAffected: 0.38,
    baselineBcvaFellow: 0.22,
  },
  rap: {
    meanAge: 83,
    bothEyesBaseline: 0.71,
    baselineBcvaAffected: 0.62,
    baselineBcvaFellow: 0.53,
  },
};

/**
 * Supplementary Table S2 — Initial distribution of sub-health states (%)
 * 状態順: 無視力障害 / 軽度 / 中度 / 重度 / 失明
 */
const TABLE_S2_INITIAL = {
  typical: {
    treated: [0, 0.477, 0.157, 0.366, 0],
    fellow: [0.444, 0.159, 0.075, 0.322, 0],
  },
  pcv: {
    treated: [0, 0.511, 0.125, 0.365, 0],
    fellow: [0.453, 0.095, 0.047, 0.406, 0],
  },
  rap: {
    treated: [0, 0.288, 0.267, 0.454, 0],
    fellow: [0.27, 0.179, 0.097, 0.454, 0],
  },
};

function normalizeDist(dist) {
  const sum = dist.reduce((a, b) => a + b, 0);
  if (!sum) return dist;
  return dist.map((p) => Math.round((p / sum) * 10000) / 10000);
}

function meanBcvaOfDistribution(dist) {
  return dist.reduce((s, p, i) => s + p * STATE_BCVA_CENTROIDS[i], 0);
}

export function getMarkovBaselineBcva(subtypeId) {
  const row = YONEDA_BASELINE[subtypeId] ?? YONEDA_BASELINE.typical;
  return {
    baselineBcvaAffected: row.baselineBcvaAffected,
    baselineBcvaFellow: row.baselineBcvaFellow,
  };
}

/** Markov ベースケース（Yoneda）の BCVA と一致するか */
export function isMarkovDefaultBcva(subtypeId, baselineBcvaAffected, baselineBcvaFellow) {
  const d = getMarkovBaselineBcva(subtypeId);
  return (
    Math.abs(baselineBcvaAffected - d.baselineBcvaAffected) < 1e-9 &&
    Math.abs(baselineBcvaFellow - d.baselineBcvaFellow) < 1e-9
  );
}

/**
 * @param {keyof typeof YONEDA_BASELINE} subtypeId
 */
export function buildSubtypeBaseline(subtypeId) {
  const row = YONEDA_BASELINE[subtypeId];
  const s2 = TABLE_S2_INITIAL[subtypeId];
  const treatedInitial = normalizeDist([...s2.treated]);
  const fellowInitial = normalizeDist([...s2.fellow]);
  return {
    ...row,
    baselineSource: "Yoneda et al. [1]",
    initialDistributionSource: "Supplementary Table S2 (Yoneda et al. [1])",
    treatedInitial,
    fellowInitial,
    impliedBcvaAffected: meanBcvaOfDistribution(treatedInitial),
    impliedBcvaFellow: meanBcvaOfDistribution(fellowInitial),
  };
}

/** @deprecated Table S2 を使用。平均 BCVA からの導出が必要な場合のみ */
export function distributionFromMeanBcva(meanBcva, sigma = 0.055) {
  const weights = STATE_BCVA_CENTROIDS.map((c) =>
    Math.exp(-0.5 * Math.pow((c - meanBcva) / sigma, 2))
  );
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.round((w / sum) * 10000) / 10000);
}

export const SUBTYPE_BASELINE_ROWS = YONEDA_BASELINE;
export const TABLE_S2_INITIAL_DISTRIBUTION = TABLE_S2_INITIAL;
