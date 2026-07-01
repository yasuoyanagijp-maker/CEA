/**
 * 死亡率パラメータ
 *
 * - 年齢別 nqx: 令和5年簡易生命表（死亡率.pdf）
 * - 失明 HR: Lancet Glob Health 2021（中等度視力障害 HR≈1.43）— 既定 1.4
 * - 第二眼月次: VIEW 試験目安（年率 ~10%）
 */

import {
  LIFE_TABLE_SOURCE,
  DEFAULT_MALE_RATIO,
  nqxAtAgeInterpolated,
  survivalProbability,
  cycleDeathProbability,
  remainingLifeExpectancy,
  lxAtAge,
} from "./mortality-life-table-r5.js";

export {
  LIFE_TABLE_SOURCE,
  DEFAULT_MALE_RATIO,
  nqxAtAgeInterpolated,
  survivalProbability,
  cycleDeathProbability,
  remainingLifeExpectancy,
  lxAtAge,
};

export const MORTALITY_DEFAULTS = {
  /** 固定値（感度分析用）。null = 生命表を使用 */
  annualMortality: null,
  blindMortalityHr: 1.4,
  secondEyeMonthlyIncidence: 0.008,
  maleRatio: DEFAULT_MALE_RATIO,
  useAgeSpecificMortality: true,
};

/**
 * 年齢別年間死亡確率 qx
 * @param {number} age
 * @param {object} [opts]
 * @param {boolean} [opts.useLifeTable=true]
 * @param {number|null} [opts.fixedRate] — 指定時は生命表より優先
 * @param {number} [opts.maleRatio]
 */
export function annualMortalityForAge(
  age,
  { useLifeTable = true, fixedRate = null, maleRatio = DEFAULT_MALE_RATIO } = {}
) {
  if (fixedRate != null) return fixedRate;
  if (useLifeTable) return nqxAtAgeInterpolated(age, maleRatio);
  return MORTALITY_DEFAULTS.annualMortality ?? nqxAtAgeInterpolated(age, maleRatio);
}

/** モデル参入時（サブタイプ平均年齢）の qx — UI 表示用 */
export function entryMortalityForSubtype(meanAge, maleRatio = DEFAULT_MALE_RATIO) {
  return nqxAtAgeInterpolated(meanAge, maleRatio);
}

/**
 * 参入年齢の余命に基づく解析期間（年）
 * コホート解析は configuredHorizon をそのまま使用（論文20年）。個別患者は余命で上限。
 */
export function analysisHorizonYears(
  entryAge,
  configuredHorizonYears,
  { maleRatio = DEFAULT_MALE_RATIO, sex = null, useLifeExpectancyCap = false } = {}
) {
  if (!useLifeExpectancyCap) return configuredHorizonYears;
  const remaining = remainingLifeExpectancy(entryAge, { maleRatio, sex });
  return Math.min(configuredHorizonYears, Math.max(0.25, remaining));
}
