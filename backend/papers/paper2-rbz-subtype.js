/** 論文2: RBZ BS サブタイプ CEA 補足 — Table S9–S11 (2024年4月) */
import {
  ADMINISTRATION_COSTS_JPY,
  ADVERSE_EVENTS_OT_2024_NAMD,
  DRUG_PRICES_JPY,
  MONITORING_STANDARD,
  DEFAULT_TRANSPORT,
} from "../config/cost-common.js";

export const PAPER2 = {
  id: "paper2_rbz",
  label: "O&T 2024;13:2629-2644.",
  description: "Yanagi et al. RBZ BS / nAMD subtype — O&T 2024;13:2629-2644 supplementary costs",

  drugPrices: DRUG_PRICES_JPY,

  /** 論文2固有: 注射手技料 6,000円/回 を薬価と別建て */
  injectionFee: ADMINISTRATION_COSTS_JPY.paper2Rbz,
  administrationBundled: false,

  adverseEvents: ADVERSE_EVENTS_OT_2024_NAMD,

  monitoring: MONITORING_STANDARD,

  /** Table S11 — 社会的費用（介護・訪問・交通） */
  societal: {
    dailyWage: 15_759,
    dailyCareSingle: [0, 0, 567_327, 1_134_655, 1_891_091],
    dailyCareBoth: [0, 945_545, 1_134_655, 2_836_636, 5_673_273],
    physicianVisitSingle: [false, false, true, true, true],
    physicianVisitBoth: [false, true, true, true, true],
    transport: DEFAULT_TRANSPORT,
  },
};
