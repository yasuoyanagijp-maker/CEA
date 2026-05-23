/** 論文1: Faricimab CEA（Yanagi 2025 等）— 薬価・投与コストは補足 S9 等 */
export const PAPER1 = {
  id: "paper1_faricimab",
  label: "Journal of Medical Economics, 28, 448 - 459.",
  description: "Yanagi et al. Faricimab nAMD CEA — drug/admin from supplement",

  drugPrices: {
    ranibizumab: 92_753,
    aflibercept: 113_912,
    aflibercept_8mg: 145_718,
    faricimab: 141_784,
    brolucizumab: 103_163,
    ranibizumab_bs: 72_136,
    aflibercept_bs: 67_959,
  },

  injectionFee: null,
  administrationBundled: true,
  administrationPerInjection: 12_730,

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

  /** 論文1の S11 相当は未実装 — 計算時は論文2 S11 をフォールバック（engine で警告） */
  societal: null,
};
