/**
 * スイッチ（既治療 nAMD）後の治療間隔エビデンス
 * 出典: #injections_meta.txt + 2024–2026 スイッチ／延長／固定割付試験
 *
 * 二層モデル:
 *   realisticExtensionWeeks [min,max] — 実臨床スイッチ集団の平均間隔延長（現実到達）
 *   trialReach [{weeks, fraction}]    — RCT/延長期の絶対到達率（理論上限・段階判定用）
 *                                       fraction = その週数「以上」に到達した割合
 *   trialEvidenceTier                 — trialReach の証拠階層（試験デザイン差の管理）
 *                                       "direct"           = 固定割付/延長期で直接実測
 *                                       "modeled"          = post hoc で固定割付を模擬
 *                                       "t&e-derived"      = T&E 運用下の到達間隔から導出
 *                                       "reference-derived"= 先行品の trialReach を借用
 *                                                            （BS 自体の延長耐久性は未実証）
 * これらを損益分岐間隔に照らし「到達可能／境界／困難」を自動分類する。
 * intervalExtensionWeeks は後方互換（realisticExtensionWeeks の別名として残す）。
 *
 * 注意（BS の延長耐久性）: アフリベルセプト/ラニビズマブ BS の非劣性エビデンスは
 * ほぼ全て「3回ローディング後 q8 週固定」で得られており、延長耐久性そのものは
 * 直接検証されていない（Zhang 2026; Sawires 2025; Aljuhani 2025）。よって BS の
 * trialReach は先行品由来の借用（reference-derived）として扱い、BS 固有の到達判定
 * として確定表示しない。
 */
export const EVIDENCE_TIER_LABELS = {
  direct: "直接実測",
  modeled: "post hoc 推定",
  "t&e-derived": "T&E 運用由来",
  "reference-derived": "先行品由来（BS延長未実証）",
};

export const SWITCH_INTERVAL_EVIDENCE = {
  faricimab: {
    realisticExtensionWeeks: [1.6, 2.1],
    // TENAYA/LUCERNE week112 pooled global（PTI 年2の最終割付・絶対到達率）
    trialReach: [
      { weeks: 12, fraction: 0.778 },
      { weeks: 16, fraction: 0.631 },
    ],
    trialEvidenceTier: "direct",
    injectionChangePerYear: -2.65,
    note: "既治療スイッチ +1.6〜2.1週。TENAYA/LUCERNE week112 は ≥Q12W 77.8%/Q16W 63.1%（PTI 直接実測、Japan 亜群でも再現）",
    sources: "Khanani 2024; Koizumi 2024; London 2025; Mori 2023; Alili 2026; Jin 2025",
  },
  brolucizumab: {
    realisticExtensionWeeks: [1, 2],
    // Singer 2022 post hoc（HAWK/HARRIER の固定割付模擬）: ≥Q12W 76–78%, Q16W 52–56%
    trialReach: [
      { weeks: 12, fraction: 0.77 },
      { weeks: 16, fraction: 0.54 },
    ],
    trialEvidenceTier: "modeled",
    note: "スイッチ後1年 5.2〜6.4 回/年、抵抗例 9.6→6.4。q12w は HAWK/HARRIER 実測、q16w は Singer post hoc（≥Q12W 77%/Q16W 54%）。q8w 落ち後の再延長不可設計で過小評価の可能性・IOI 安全性は別軸",
    sources: "Dugel 2019/2020; Singer 2022; Regillo 2025 (TALON); Inoda 2024",
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
    trialEvidenceTier: "direct",
    note: "実臨床スイッチ平均 +1〜2週・12週到達 約20%（Kitay 2026 ほか）。PULSAR 96週は 16週78%/20週53%/24週31%（固定/延長割付で直接実測）",
    sources: "Korobelnik 2025; Kitay 2026; Lee 2026; Musadiq 2025; Emfietzoglou 2026",
  },
  aflibercept: {
    realisticExtensionWeeks: null,
    // ARIES/ALTAIR 2mg T&E（treatment-naive 上限参照）: ≥12週 ~57%, ≥16週 ~44%
    trialReach: [
      { weeks: 12, fraction: 0.57 },
      { weeks: 16, fraction: 0.44 },
    ],
    trialEvidenceTier: "t&e-derived",
    note: "Q8 T&E 基準薬。ALTAIR 96週 ≥12週 56.9/60.2%・≥16週 42–46%（PCV 51.1%）、ARIES 104週 ≥12週 47.2/51.9%（naive T&E の上限参照）。スイッチ集団の直接到達ではない点に注意",
    sources: "Ohji 2020 (ALTAIR); Mitchell 2021 (ARIES); Okada 2022",
  },
  aflibercept_bs: {
    realisticExtensionWeeks: [0, 0],
    // BS の非劣性は q8 固定で実証（SB15/P041/ABP938）。延長耐久性は未検証のため、
    // trialReach は先行 2mg（ARIES/ALTAIR）からの「借用」であり BS 固有の実証ではない。
    trialReach: [
      { weeks: 12, fraction: 0.57 },
      { weeks: 16, fraction: 0.44 },
    ],
    trialEvidenceTier: "reference-derived",
    reachIsBorrowed: true,
    note: "BS の非劣性は q8 固定投与で実証（SB15/P041/ABP938）だが延長耐久性は未検証。到達率は先行 2mg（ARIES/ALTAIR ≥12週 ~57%/≥16週 ~44%）の借用で、BS 固有の到達判定ではない。先行品からのスイッチは間隔不変・薬価差のみ",
    sources: "Woo 2023 (SB15); Karkhaneh 2024 (P041); Friedman 2025 (ABP938); Ohji 2020/Mitchell 2021 (借用元); Zhang 2026; Sawires 2025; Aljuhani 2025",
  },
  ranibizumab: {
    realisticExtensionWeeks: null,
    trialReach: null,
    trialEvidenceTier: null,
    note: "Q4〜PRN/T&E 7.6〜12.1 回/年 — 一般に他剤より間隔が短く、ARIES/ALTAIR に相当する ≥Q12/16W T&E 到達率は本エビデンスセットに未収載。長間隔化しにくいため延長による損益分岐到達は限定的",
    sources: "Wojciechowski 2025; Butler 2025",
  },
  ranibizumab_bs: {
    realisticExtensionWeeks: [0, 0],
    trialReach: null,
    trialEvidenceTier: null,
    note: "先行 RBZ と同一分子 — スイッチで間隔は不変と仮定（薬価差のみ）。RBZ の ≥Q12/16W T&E 到達率は未収載",
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
