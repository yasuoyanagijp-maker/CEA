/**
 * スイッチ（既治療 nAMD）後の治療間隔エビデンス
 * 出典: #injections_meta.txt + 2025–2026 スイッチ／延長試験
 *
 * 二層モデル:
 *   realisticExtensionWeeks [min,max] — 実臨床スイッチ集団の平均間隔延長（現実到達）
 *   trialReach [{weeks, fraction}]    — RCT/延長期の絶対到達率（理論上限・段階判定用）
 *                                       fraction = その週数「以上」に到達した割合
 * これらを損益分岐間隔に照らし「到達可能／境界／困難」を自動分類する。
 * intervalExtensionWeeks は後方互換（realisticExtensionWeeks の別名として残す）。
 */
export const SWITCH_INTERVAL_EVIDENCE = {
  faricimab: {
    realisticExtensionWeeks: [1.6, 2.1],
    trialReach: null,
    injectionChangePerYear: -2.65,
    note: "既治療スイッチのメタ解析: 間隔 +1.6〜2.1週、注射 9.70→7.05 回/年。BCVA 不変・解剖学的改善",
    sources: "Alili 2026; Jin 2025; Khodor 2025; Zhang 2025",
  },
  brolucizumab: {
    realisticExtensionWeeks: [1, 2],
    trialReach: null,
    note: "スイッチ後1年 5.2〜6.4 回/年（Q8〜Q10 相当）、3年で 3.6 回/年へ漸減。抵抗例 9.6→6.4 回/年",
    sources: "Inoda 2024; Abdin 2022; Scupola 2025",
  },
  aflibercept_8mg: {
    // 実臨床スイッチ: 平均 +1〜2週（Musadiq 7.7→8.7、Emfietzoglou 中央値 10→12、Kitay 7.1→9.4、Lee 6.0→7.8）
    realisticExtensionWeeks: [1, 2],
    // Kitay 2026: スイッチ集団で 12週以上到達 20.2%
    switchReach: { weeks: 12, fraction: 0.202 },
    // PULSAR 96週 8q16 群の最終割付間隔・絶対到達率（理論上限）
    trialReach: [
      { weeks: 12, fraction: 0.87 },
      { weeks: 16, fraction: 0.78 },
      { weeks: 20, fraction: 0.53 },
      { weeks: 24, fraction: 0.31 },
    ],
    note: "実臨床スイッチ平均 +1〜2週・12週到達 約20%（Kitay 2026 ほか）。PULSAR 96週は 16週78%/20週53%/24週31%（理論上限）",
    sources: "Korobelnik 2025; Kitay 2026; Lee 2026; Musadiq 2025; Emfietzoglou 2026",
  },
  aflibercept: {
    realisticExtensionWeeks: null,
    trialReach: null,
    note: "Q8 T&E 基準薬（year1 最大 7.67 回/年）",
    sources: "Wojciechowski 2025",
  },
  aflibercept_bs: {
    realisticExtensionWeeks: [0, 0],
    trialReach: null,
    note: "先行品と同一分子 — スイッチで間隔は不変と仮定（薬価差のみ）",
    sources: "同一分子仮定",
  },
  ranibizumab: {
    realisticExtensionWeeks: null,
    trialReach: null,
    note: "Q4〜PRN/T&E 7.6〜12.1 回/年 — 一般に他剤より間隔が短い",
    sources: "Wojciechowski 2025; Butler 2025",
  },
  ranibizumab_bs: {
    realisticExtensionWeeks: [0, 0],
    trialReach: null,
    note: "先行 RBZ と同一分子 — スイッチで間隔は不変と仮定（薬価差のみ）",
    sources: "同一分子仮定",
  },
};

export function getSwitchEvidence(drugId) {
  const e = SWITCH_INTERVAL_EVIDENCE[drugId];
  if (!e) return null;
  // 後方互換: intervalExtensionWeeks を realisticExtensionWeeks から供給
  return { ...e, intervalExtensionWeeks: e.realisticExtensionWeeks ?? null };
}

/**
 * trialReach（週数以上の到達率）から、目標間隔 targetWeeks に到達する割合を線形補間で推定。
 * reach は weeks 昇順・fraction 降順（長い間隔ほど到達しにくい）を前提とする。
 * @returns {number|null} 0–1、範囲外は端点でクランプ
 */
export function trialReachFractionAt(trialReach, targetWeeks) {
  if (!Array.isArray(trialReach) || trialReach.length === 0) return null;
  const pts = [...trialReach].sort((a, b) => a.weeks - b.weeks);
  if (targetWeeks <= pts[0].weeks) return pts[0].fraction;
  const last = pts[pts.length - 1];
  if (targetWeeks >= last.weeks) return last.fraction;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (targetWeeks >= a.weeks && targetWeeks <= b.weeks) {
      const t = (targetWeeks - a.weeks) / (b.weeks - a.weeks);
      return a.fraction + t * (b.fraction - a.fraction);
    }
  }
  return null;
}
