/**
 * スイッチ（既治療 nAMD）後の治療間隔・注射回数エビデンス
 * 出典: #injections_meta.txt（2025–2026 メタ解析・real-world）
 * intervalExtensionWeeks: スイッチ後の間隔延長 [最小, 最大]（週）。null = 直接データなし
 */
export const SWITCH_INTERVAL_EVIDENCE = {
  faricimab: {
    intervalExtensionWeeks: [1.6, 2.1],
    injectionChangePerYear: -2.65,
    note: "既治療スイッチのメタ解析: 間隔 +1.6〜2.1週、注射 9.70→7.05 回/年。BCVA 不変・解剖学的改善",
    sources: "Alili 2026; Jin 2025; Khodor 2025; Zhang 2025",
  },
  brolucizumab: {
    intervalExtensionWeeks: null,
    note: "スイッチ後1年 5.2〜6.4 回/年（Q8〜Q10 相当）、3年で 3.6 回/年へ漸減。抵抗例 9.6→6.4 回/年",
    sources: "Inoda 2024; Abdin 2022; Scupola 2025",
  },
  aflibercept_8mg: {
    intervalExtensionWeeks: null,
    note: "未治療で Q12〜Q16 維持 5.1〜5.9 回/年。スイッチ集団の間隔延長メタ解析は未登録",
    sources: "Wojciechowski 2025; Friedman 2025",
  },
  aflibercept: {
    intervalExtensionWeeks: null,
    note: "Q8 T&E 基準薬（year1 最大 7.67 回/年）",
    sources: "Wojciechowski 2025",
  },
  aflibercept_bs: {
    intervalExtensionWeeks: [0, 0],
    note: "先行品と同一分子 — スイッチで間隔は不変と仮定（薬価差のみ）",
    sources: "同一分子仮定",
  },
  ranibizumab: {
    intervalExtensionWeeks: null,
    note: "Q4〜PRN/T&E 7.6〜12.1 回/年 — 一般に他剤より間隔が短い",
    sources: "Wojciechowski 2025; Butler 2025",
  },
  ranibizumab_bs: {
    intervalExtensionWeeks: [0, 0],
    note: "先行 RBZ と同一分子 — スイッチで間隔は不変と仮定（薬価差のみ）",
    sources: "同一分子仮定",
  },
};

export function getSwitchEvidence(drugId) {
  return SWITCH_INTERVAL_EVIDENCE[drugId] ?? null;
}
