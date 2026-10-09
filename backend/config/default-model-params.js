/**
 * ユーザー確認済みデフォルト（ETDRS→小数視力中央値に対応する効用、NMA 有害事象等）
 *
 * 効用値の出典はユーザー指定（2025-05）であり、公表論文の効用表との一致は未確認。
 * O&T 2023 Suppl Table S6（較好眼 0.777/0.741/0.686/0.614/0.500）とは一致しない。
 * O&T 2024 Table S12 は CEA 結果表であり、効用値の出典ではない。
 */

/**
 * 5状態: 無・軽・中・重・失明 — ETDRS→小数視力カテゴリー中央値に対応
 * ユーザー指定（2025-05、公表論文との一致は未確認）: 0.76 / 0.70 / 0.64 / 0.60 / 0.51
 */
export const DEFAULT_UTILITIES = [0.76, 0.7, 0.64, 0.6, 0.51];

/** 較好眼・非罹患眼（無障害） */
export const DEFAULT_UTILITY_NONE = 0.83;

import { MORTALITY_DEFAULTS } from "./mortality.js";
import { ADVERSE_EVENTS_INTEGRATED_NAMD } from "./cost-common.js";

/**
 * 死亡率3項目 — 文献・S12再現用デフォルト（2025-05 確定）
 * @see mortality.js 出典メモ
 */
export const DEFAULT_ANNUAL_MORTALITY = MORTALITY_DEFAULTS.annualMortality;
export const DEFAULT_BLIND_MORTALITY_HR = MORTALITY_DEFAULTS.blindMortalityHr;
export const DEFAULT_SECOND_EYE_MONTHLY = MORTALITY_DEFAULTS.secondEyeMonthlyIncidence;

/** 注射1回あたり有害事象（確率は小数、NMA / Expert opinion） */
export const DEFAULT_ADVERSE_EVENTS = ADVERSE_EVENTS_INTEGRATED_NAMD;

export const DEFAULT_MODEL_PARAMS = {
  utilities: DEFAULT_UTILITIES,
  utilityNone: DEFAULT_UTILITY_NONE,
  annualMortality: DEFAULT_ANNUAL_MORTALITY,
  blindMortalityHr: DEFAULT_BLIND_MORTALITY_HR,
  secondEyeMonthlyIncidence: DEFAULT_SECOND_EYE_MONTHLY,
  useAgeSpecificMortality: MORTALITY_DEFAULTS.useAgeSpecificMortality,
  maleRatio: MORTALITY_DEFAULTS.maleRatio,
  adverseEvents: DEFAULT_ADVERSE_EVENTS,
  includeScenarioAe: false,
};
