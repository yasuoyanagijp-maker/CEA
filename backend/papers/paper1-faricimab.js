/** 論文1: Faricimab CEA（Yanagi 2025 等）— 薬価・投与コストは補足 S9 等 */
import {
  ADMINISTRATION_COSTS_JPY,
  ADVERSE_EVENTS_JME_2025_NAMD,
  DRUG_PRICES_JPY,
  MONITORING_JME_2025,
  SOCIETAL_JME_2025,
} from "../config/cost-common.js";

export const PAPER1 = {
  id: "paper1_faricimab",
  label: "JME 2025;28:448-459.",
  description: "Yanagi et al. Faricimab nAMD/DME CEA — JME 2025;28:448-459 supplementary costs",

  drugPrices: DRUG_PRICES_JPY,

  /** 論文1固有: 投与コストは薬価に包括（手技・材料込み 12,730円/回） */
  injectionFee: null,
  administrationBundled: true,
  administrationPerInjection: ADMINISTRATION_COSTS_JPY.paper1Faricimab,

  adverseEvents: ADVERSE_EVENTS_JME_2025_NAMD,

  monitoring: MONITORING_JME_2025,

  /** Tables S8-S9 — productivity, informal care and travel costs */
  societal: SOCIETAL_JME_2025,
};
