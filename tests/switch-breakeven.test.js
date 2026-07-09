import { describe, it, expect } from "vitest";
import {
  computeBreakEvenTable,
  buildAnnualCostCurve,
} from "../backend/switch-analysis.js";
import { trialReachFractionAt } from "../backend/config/switch-interval-evidence.js";

// paper2: BS ¥67,959 + 手技 ¥6,000 = ¥73,959/回
//         8mg ¥145,718 + ¥6,000 = ¥151,718/回
//         AFL 2mg キット ¥99,522 + ¥6,000 = ¥105,522/回

describe("computeBreakEvenTable", () => {
  it("BS Q10 → 8mg の損益分岐間隔は約 Q20.5", () => {
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept_bs",
      currentIntervalWeeks: 10,
      costPaperId: "paper2_rbz",
    });
    const row = t.rows.find((r) => r.drugId === "aflibercept_8mg");
    expect(row.priceRatio).toBeCloseTo(151718 / 73959, 4);
    expect(row.breakEvenWeeks).toBeCloseTo(10 * (151718 / 73959), 2); // ≈20.51
    expect(row.requiredExtensionWeeks).toBeCloseTo(row.breakEvenWeeks - 10, 6);
  });

  it("損益分岐間隔で年間薬剤費が現行と一致する", () => {
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept_bs",
      currentIntervalWeeks: 10,
      costPaperId: "paper2_rbz",
    });
    for (const row of t.rows) {
      if (row.missingPrice) continue;
      const annualAtBreakEven = (row.perInjection * 52) / row.breakEvenWeeks;
      expect(annualAtBreakEven).toBeCloseTo(t.annualDrugAdmin, 6);
    }
  });

  it("先行品 → BS は同一間隔でも削減（cheaper 判定）", () => {
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept",
      currentIntervalWeeks: 8,
      costPaperId: "paper2_rbz",
    });
    const row = t.rows.find((r) => r.drugId === "aflibercept_bs");
    expect(row.verdict.kind).toBe("cheaper");
    expect(row.sameIntervalAnnualDelta).toBeLessThan(0);
    // 短縮許容: Q8 → 約 Q5.6 まで縮んでも損しない（キット薬価）
    expect(row.breakEvenWeeks).toBeCloseTo(8 * (73959 / 105522), 2);
  });

  it("aflibercept BS の trialReach は先行品借用（reference-derived）で BS 実証ではない", () => {
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept",
      currentIntervalWeeks: 8,
      costPaperId: "paper2_rbz",
    });
    const row = t.rows.find((r) => r.drugId === "aflibercept_bs");
    // 先行 2mg の ARIES/ALTAIR 到達率を借用しているが tier は t&e-derived ではない
    expect(row.evidence.trialEvidenceTier).toBe("reference-derived");
    expect(row.evidence.trialEvidenceTier).not.toBe("t&e-derived");
    expect(row.evidence.reachIsBorrowed).toBe(true);
    expect(row.evidence.trialReach).toContainEqual({ weeks: 12, fraction: 0.57 });
  });

  it("BS Q8 → faricimab は実臨床では不足だが試験到達率(Q16W 63%)で reachable", () => {
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept_bs",
      currentIntervalWeeks: 8,
      costPaperId: "paper2_rbz",
    });
    const row = t.rows.find((r) => r.drugId === "faricimab");
    expect(row.evidence.realisticExtensionWeeks).toEqual([1.6, 2.1]);
    // 実臨床 +2.1週では届かないが、分岐 Q16.0 は TENAYA/LUCERNE の Q16W 63% 圏 → reachable
    expect(row.breakEvenWeeks).toBeCloseTo(16.0, 1);
    expect(row.verdict.kind).toBe("reachable");
    expect(row.verdict.evidenceTier).toBe("direct");
    // 実臨床平均だけでは必要延長に足りない（試験到達率で救済）
    expect(row.requiredExtensionWeeks).toBeGreaterThan(row.evidence.realisticExtensionWeeks[1]);
  });

  it("同一間隔 Δ薬剤費/年 と QALY/年 の目安が整合する", () => {
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept_bs",
      currentIntervalWeeks: 10,
      costPaperId: "paper2_rbz",
      wtpPerQaly: 5_000_000,
    });
    const row = t.rows.find((r) => r.drugId === "aflibercept_8mg");
    // Q10: 5.2 回/年 × 価格差 ¥77,759 ≈ ¥404,347/年
    expect(row.sameIntervalAnnualDelta).toBeCloseTo((151718 - 73959) * 5.2, 0);
    expect(row.qalyPerYear).toBeCloseTo(row.sameIntervalAnnualDelta / 5_000_000, 6);
    expect(row.qalyPerYearKind).toBe("min_required_gain");
  });

  it("BS Q16 → 8mg は損益分岐 Q32.8 で試験上限も届かず difficult", () => {
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept_bs",
      currentIntervalWeeks: 16,
      costPaperId: "paper2_rbz",
    });
    const row = t.rows.find((r) => r.drugId === "aflibercept_8mg");
    // 16 × 2.05 ≈ Q32.8 — PULSAR 24週(31%)より外側 → difficult
    expect(row.breakEvenWeeks).toBeGreaterThan(24);
    expect(row.verdict.kind).toBe("difficult");
  });

  it("8mg スイッチで損益分岐が試験到達率50%以上なら reachable 判定", () => {
    // AFL 2mg キット Q8 現行 → 8mg。分岐 = 8 × (151718/105522) ≈ Q11.5（PULSAR 12週87%圏）
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept",
      currentIntervalWeeks: 8,
      costPaperId: "paper2_rbz",
    });
    const row = t.rows.find((r) => r.drugId === "aflibercept_8mg");
    expect(row.breakEvenWeeks).toBeCloseTo(8 * (151718 / 105522), 2);
    expect(["reachable", "borderline"]).toContain(row.verdict.kind);
    expect(row.evidence.trialReach).toBeTruthy();
  });

  it("8mg 評価では試験上限(trialReach)と実臨床(realistic)の両層を保持", () => {
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept_bs",
      currentIntervalWeeks: 10,
      costPaperId: "paper2_rbz",
    });
    const row = t.rows.find((r) => r.drugId === "aflibercept_8mg");
    expect(row.evidence.realisticExtensionWeeks).toEqual([1, 2]);
    expect(row.evidence.trialReach).toContainEqual({ weeks: 16, fraction: 0.78 });
  });

  it("faricimab は trialReach（direct）を持ち段階判定される", () => {
    // AFL 2mg キット Q10 → faricimab: 分岐 = 10 × (147784/105522) ≈ Q14.0
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept",
      currentIntervalWeeks: 10,
      costPaperId: "paper2_rbz",
    });
    const row = t.rows.find((r) => r.drugId === "faricimab");
    expect(row.evidence.trialEvidenceTier).toBe("direct");
    expect(row.evidence.trialReach).toContainEqual({ weeks: 16, fraction: 0.631 });
    expect(["reachable", "borderline", "difficult"]).toContain(row.verdict.kind);
    // trial に基づく判定なら evidenceTier が伝播する
    if (row.verdict.kind !== "cheaper") {
      expect(row.verdict.evidenceTier).toBe("direct");
    }
  });

  it("brolucizumab は modeled tier の trialReach を持つ", () => {
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept_bs",
      currentIntervalWeeks: 8,
      costPaperId: "paper2_rbz",
    });
    const row = t.rows.find((r) => r.drugId === "brolucizumab");
    expect(row.evidence.trialEvidenceTier).toBe("modeled");
    expect(row.evidence.trialReach).toContainEqual({ weeks: 12, fraction: 0.77 });
    // BS Q8 → brolucizumab 分岐 ≈ Q11.8（≥Q12W 77%圏）→ reachable 相当
    expect(row.breakEvenWeeks).toBeCloseTo(8 * ((103163 + 6000) / 73959), 2);
  });

  it("aflibercept 2mg は ARIES/ALTAIR 由来の t&e-derived trialReach を持つ", () => {
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept_bs",
      currentIntervalWeeks: 8,
      costPaperId: "paper2_rbz",
    });
    const row = t.rows.find((r) => r.drugId === "aflibercept");
    expect(row.evidence.trialEvidenceTier).toBe("t&e-derived");
    expect(row.evidence.trialReach).toContainEqual({ weeks: 12, fraction: 0.57 });
    // BS Q8 → 2mg 分岐 Q13.0（≥12週 57% 圏）→ reachable、tier 伝播
    expect(row.verdict.kind).toBe("reachable");
    expect(row.verdict.evidenceTier).toBe("t&e-derived");
  });

  it("ranibizumab は trialReach 未収載で unknown のまま（延長しにくい）", () => {
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept_bs",
      currentIntervalWeeks: 8,
      costPaperId: "paper2_rbz",
    });
    const row = t.rows.find((r) => r.drugId === "ranibizumab");
    expect(row.evidence.trialReach).toBeNull();
    expect(row.verdict.kind).toBe("unknown");
  });

  it("無効な間隔では null", () => {
    expect(
      computeBreakEvenTable({
        currentDrugId: "aflibercept_bs",
        currentIntervalWeeks: 0,
        costPaperId: "paper2_rbz",
      })
    ).toBeNull();
  });
});

describe("trialReachFractionAt", () => {
  const reach = [
    { weeks: 12, fraction: 0.87 },
    { weeks: 16, fraction: 0.78 },
    { weeks: 20, fraction: 0.53 },
    { weeks: 24, fraction: 0.31 },
  ];
  it("端点はクランプ", () => {
    expect(trialReachFractionAt(reach, 10)).toBe(0.87);
    expect(trialReachFractionAt(reach, 28)).toBe(0.31);
  });
  it("中間は線形補間", () => {
    // 18週 = 16(0.78)と20(0.53)の中点 → 0.655
    expect(trialReachFractionAt(reach, 18)).toBeCloseTo(0.655, 3);
  });
  it("空配列は null", () => {
    expect(trialReachFractionAt(null, 16)).toBeNull();
    expect(trialReachFractionAt([], 16)).toBeNull();
  });
});

describe("buildAnnualCostCurve", () => {
  it("年間費用 = 1回コスト × 52 ÷ 週", () => {
    const curve = buildAnnualCostCurve({
      drugIds: ["aflibercept_bs"],
      costPaperId: "paper2_rbz",
      minWeeks: 8,
      maxWeeks: 8,
    });
    expect(curve).toHaveLength(1);
    expect(curve[0].aflibercept_bs).toBe(Math.round((73959 * 52) / 8));
  });
});
