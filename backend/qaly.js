/**
 * QALY — 視力状態遷移（Markov）からの算出
 *
 * Yanagi et al. 2024 準拠:
 * - 3ヶ月サイクル
 * - 両眼モデル: 較好眼 BCVA に基づく5状態効用（非罹患眼は utilityNone）
 * - 半周期補正: (U_cycle開始 + U_cycle終了) / 2 × サイクル長 × 割引
 */

import { N_STATES } from "./constants.js";

/**
 * コホート分布から期待較好眼効用を算出（両眼・第二眼発症を考慮）
 * @param {number[]} cohort — 各状態の生存質量（aliveMass 込み）
 * @param {number[]} fellowDist — 他眼の状態分布
 * @param {number} pSecond — 両眼罹患確率
 * @param {{ utilities: number[], utilityNone: number }} qaly
 */
export function expectedBetterEyeUtility(cohort, fellowDist, pSecond, qaly) {
  const { utilities: u, utilityNone: uNone } = qaly;
  let expected = 0;
  for (let i = 0; i < N_STATES; i++) {
    if (cohort[i] <= 0) continue;
    expected += (1 - pSecond) * cohort[i] * Math.max(u[i], uNone);
    for (let j = 0; j < N_STATES; j++) {
      expected += pSecond * cohort[i] * fellowDist[j] * Math.max(u[i], u[j]);
    }
  }
  return expected;
}

/**
 * 1 Markov サイクル分の QALY（半周期補正・割引済）
 * @param {number} utilityStart — 遷移前の期待効用
 * @param {number} utilityEnd — 遷移・死亡・第二眼発症後の期待効用
 * @param {number} cycleLen — サイクル長（年）
 * @param {number} discountFactor — 当該サイクル開始時点の割引係数
 */
export function qalyForCycle(utilityStart, utilityEnd, cycleLen, discountFactor) {
  return ((utilityStart + utilityEnd) / 2) * cycleLen * discountFactor;
}
