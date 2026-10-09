/** 論文1: Faricimab CEA（Yanagi 2025 等）— 薬価・投与コストは補足 S9 等 */
import {
  ADMINISTRATION_COSTS_JPY,
  ADVERSE_EVENTS_JME_2025_NAMD,
  DRUG_PRICES_JPY,
  MONITORING_JME_2025,
  SOCIETAL_JME_2025,
} from "../config/cost-common.js";
import { CITE, COST_PAPER_LABELS } from "../config/citations.js";

export const PAPER1 = {
  id: "paper1_faricimab",
  label: COST_PAPER_LABELS.paper1_faricimab,
  description: `ファリシマブ nAMD CEA の補足コスト（${CITE.yanagi2025jme}）`,

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
