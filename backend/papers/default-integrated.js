/**
 * Default integrated cost profile.
 * 薬剤費はユーザー確認済みの現行値を使う。
 * default は O&T の分解構造を一貫採用し、注射手技(G016)・診察・検査・画像を
 * 別々に積算する。
 */
import {
  ADMINISTRATION_COSTS_JPY,
  ADVERSE_EVENTS_INTEGRATED_NAMD,
  DRUG_PRICES_JPY,
  MONITORING_STANDARD,
  DEFAULT_TRANSPORT,
} from "../config/cost-common.js";

export const PAPER_DEFAULT_INTEGRATED = {
  id: "default_integrated",
  label: "Default（2論文統合コスト）",
  description:
    "薬剤費は現行リポジトリ値。注射手技は O&T 2024 の G016 6,000円/回を採用し、診察・検査・画像は来院ごとの分解構造で別積算。AE は重複項目を平均し、RAO は O&T 点数表ベース 8,820円を採用。",

  drugPrices: DRUG_PRICES_JPY,

  injectionFee: ADMINISTRATION_COSTS_JPY.paper2Rbz,
  administrationBundled: false,

  adverseEvents: ADVERSE_EVENTS_INTEGRATED_NAMD,

  monitoring: MONITORING_STANDARD,

  societal: {
    dailyWage: 15_759,
    dailyCareSingle: [0, 0, 567_327, 1_134_655, 1_891_091],
    dailyCareBoth: [0, 945_545, 1_134_655, 2_836_636, 5_673_273],
    physicianVisitSingle: [false, false, true, true, true],
    physicianVisitBoth: [false, true, true, true, true],
    transport: DEFAULT_TRANSPORT,
  },
};
