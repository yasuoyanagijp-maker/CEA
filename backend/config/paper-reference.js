/**
 * 論文本文の増分値（参照薬 = アフリベルセプト、比較薬 = ラニビズマブ BS）
 * Yanagi et al. RBZ BS サブタイプ CEA — 社会的視点（subtype analyses）
 */
export const PAPER_INCREMENTAL_RBZ_VS_AFL = {
  typical: { deltaQaly: -0.015, deltaCost: -46_885 },
  pcv: { deltaQaly: 0.026, deltaCost: -993_631 },
  rap: { deltaQaly: 0.009, deltaCost: -1_282_259 },
};

/** 患者視点（本文記載・本ツール未実装の比較群あり） */
export const PAPER_PATIENT_PERSPECTIVE_NOTE = {
  vsAflibercept: { deltaQaly: 0.015, deltaCost: -138_948 },
  vsAflSwitch: { deltaQaly: 0.009, deltaCost: -391_428 },
  vsBsc: { deltaQaly: 0.307, deltaCost: -6_377_345 },
};
