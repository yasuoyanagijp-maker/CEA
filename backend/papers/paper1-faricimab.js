/** 論文1: Faricimab CEA（Yanagi 2025 等）— 薬価・投与コストは補足 S9 等 */
import { DRUG_PRICES_JPY, MONITORING_STANDARD } from "../config/cost-common.js";

export const PAPER1 = {
  id: "paper1_faricimab",
  label: "Journal of Medical Economics, 28, 448 - 459.",
  description: "Yanagi et al. Faricimab nAMD CEA — drug/admin from supplement",

  drugPrices: DRUG_PRICES_JPY,

  /** 論文1固有: 投与コストは薬価に包括（手技・材料込み 12,730円/回） */
  injectionFee: null,
  administrationBundled: true,
  administrationPerInjection: 12_730,

  useSharedAdverseEvents: true,

  monitoring: MONITORING_STANDARD,

  /** 論文1の S11 相当は未実装 — 計算時は論文2 S11 をフォールバック（engine で警告） */
  societal: null,
};
