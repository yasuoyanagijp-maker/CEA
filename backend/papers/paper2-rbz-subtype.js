/** 論文2: RBZ BS サブタイプ CEA 補足 — Table S9–S11 (2024年4月) */
export const PAPER2 = {
  id: "paper2_rbz",
  label: "Ophthalmology and Therapy, 13, 2629 - 2644.",
  description: "Yanagi et al. RBZ BS / nAMD subtype supplement",

  /** 薬価: くすりすと（Xlib）掲載・注射用キット（2025-05 ユーザー確認） */
  drugPrices: {
    ranibizumab: 92_753, // ルセンティス注射用キット 0.5mg/0.05mL（瓶剤は 108,517）
    aflibercept: 113_912, // アイリーア 2mg/0.05mL
    aflibercept_8mg: 145_718,
    faricimab: 141_784,
    brolucizumab: 103_163, // ベオビュ注射用キット
    ranibizumab_bs: 72_136,
    aflibercept_bs: 67_959, // アフリベルセプトBSキット「NIT」/ バイエルBSキット同額
  },

  injectionFee: 6_000,
  administrationBundled: false,

  useSharedAdverseEvents: true,

  monitoring: {
    tae: {
      year1: { physician: 2.0, oct: 2.0, slit: 2.0, fa: 0.25 },
      year2plus: { physician: 1.5, oct: 1.5, slit: 1.5, fa: 0.25 },
    },
    bsc: {
      year1: { physician: 1.0, oct: 1.0, slit: 1.0, fa: 0.5 },
      year2plus: { physician: 1.0, oct: 1.0, slit: 1.0, fa: 0.5 },
    },
    unitCosts: { physician: 760, oct: 1_900, slit: 1_100, fa: 4_000 },
  },

  societal: {
    dailyWage: 15_759,
    dailyCareSingle: [0, 0, 567_327, 1_134_655, 1_891_091],
    dailyCareBoth: [0, 945_545, 1_134_655, 2_836_636, 5_673_273],
    physicianVisitSingle: [false, false, true, true, true],
    physicianVisitBoth: [false, true, true, true, true],
    transport: {
      travelKmPerVisit: 1,
      costPerKmJpy: 500,
      parkingJpy: 100,
    },
  },
};
