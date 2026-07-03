import { describe, it, expect } from "vitest";
import {
  computeBreakEvenTable,
  buildAnnualCostCurve,
} from "../backend/switch-analysis.js";
import { trialReachFractionAt } from "../backend/config/switch-interval-evidence.js";

// paper2: BS ¥67,959 + 手技 ¥6,000 = ¥73,959/回
//         8mg ¥145,718 + ¥6,000 = ¥151,718/回
//         AFL 2mg ¥113,912 + ¥6,000 = ¥119,912/回

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
    // 短縮許容: Q8 → 約 Q4.9 まで縮んでも損しない
    expect(row.breakEvenWeeks).toBeCloseTo(8 * (73959 / 119912), 2);
  });

  it("BS Q8 → faricimab は文献延長（+1.6〜2.1週）では到達困難", () => {
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept_bs",
      currentIntervalWeeks: 8,
      costPaperId: "paper2_rbz",
    });
    const row = t.rows.find((r) => r.drugId === "faricimab");
    expect(row.evidence.realisticExtensionWeeks).toEqual([1.6, 2.1]);
    // 必要延長 ≈ +8.0週 >> 実臨床 +2.1週、試験到達率データなし → difficult
    expect(row.verdict.kind).toBe("difficult");
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
    // AFL 2mg Q8 現行 → 8mg。分岐 = 8 × (151718/119912) ≈ Q10.1（PULSAR 12週87%圏）
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept",
      currentIntervalWeeks: 8,
      costPaperId: "paper2_rbz",
    });
    const row = t.rows.find((r) => r.drugId === "aflibercept_8mg");
    expect(row.breakEvenWeeks).toBeCloseTo(8 * (151718 / 119912), 2);
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
