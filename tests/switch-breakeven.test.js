import { describe, it, expect } from "vitest";
import {
  computeBreakEvenTable,
  buildAnnualCostCurve,
} from "../backend/switch-analysis.js";

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
    expect(row.evidence.intervalExtensionWeeks).toEqual([1.6, 2.1]);
    // 必要延長 ≈ +8.0週 >> 文献 +2.1週
    expect(row.verdict.kind).toBe("unreachable");
    expect(row.requiredExtensionWeeks).toBeGreaterThan(row.evidence.intervalExtensionWeeks[1]);
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
