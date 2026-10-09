import { describe, it, expect } from "vitest";
import {
  EXPERT_ESTIMATE_LABEL,
  formatInjectionCount,
  isExpertEstimateInjection,
  isExpertEstimateCalendarYear,
  listExpertEstimateInjections,
} from "../backend/config/injection-estimates.js";
import {
  INJECTIONS_2026_META_YEAR1,
  getInjections2026MetaForDrug,
} from "../backend/config/injections-2026-meta.js";
import { AFL2MG_DERIVED_INJECTION_FACTOR } from "../backend/config/drug-clinical-profile.js";

describe("専門家による推計ラベル（値は不変）", () => {
  it("ラベル文字列は指定どおり", () => {
    expect(EXPERT_ESTIMATE_LABEL).toBe("（専門家による推計）");
    expect(formatInjectionCount(9.85, true)).toBe(`9.85${EXPERT_ESTIMATE_LABEL}`);
    expect(formatInjectionCount(7.67, false)).toBe("7.67");
  });

  it("2026 meta の year1 数値は照合時のまま", () => {
    expect(INJECTIONS_2026_META_YEAR1.faricimab).toBe(6.45);
    expect(INJECTIONS_2026_META_YEAR1.aflibercept_8mg).toBe(5.5);
    expect(INJECTIONS_2026_META_YEAR1.aflibercept).toBe(7.67);
    expect(INJECTIONS_2026_META_YEAR1.aflibercept_bs).toBe(7.67);
    expect(INJECTIONS_2026_META_YEAR1.ranibizumab).toBe(9.85);
    expect(INJECTIONS_2026_META_YEAR1.ranibizumab_bs).toBe(9.85);
    expect(INJECTIONS_2026_META_YEAR1.brolucizumab).toBe(6.3);
    expect(getInjections2026MetaForDrug("aflibercept_bs").year2).toBeCloseTo(4.67, 10);
    expect(getInjections2026MetaForDrug("aflibercept_8mg").year2).toBeCloseTo(3.25, 10);
  });

  it("2026 meta: 文献換算の year1 は非推計、RBZ year1 と全薬剤 year2+ は推計", () => {
    for (const id of ["faricimab", "aflibercept_8mg", "aflibercept", "aflibercept_bs", "brolucizumab"]) {
      expect(isExpertEstimateInjection({ clinicalCase: "2026_meta", drugId: id, phase: "year1" })).toBe(
        false
      );
      expect(isExpertEstimateInjection({ clinicalCase: "2026_meta", drugId: id, phase: "year2" })).toBe(
        true
      );
    }
    expect(
      isExpertEstimateInjection({
        clinicalCase: "2026_meta",
        drugId: "ranibizumab_bs",
        phase: "year1",
      })
    ).toBe(true);
    expect(
      isExpertEstimateCalendarYear({
        clinicalCase: "2026_meta",
        drugId: "aflibercept_bs",
        calendarYear: 0,
      })
    ).toBe(false);
    expect(
      isExpertEstimateCalendarYear({
        clinicalCase: "2026_meta",
        drugId: "aflibercept_bs",
        calendarYear: 1,
      })
    ).toBe(true);
  });

  it("ベース/シナリオ: AFL 派生3剤は全病型・全フェーズが推計、RBZ/AFL 2mg は非推計", () => {
    expect(AFL2MG_DERIVED_INJECTION_FACTOR).toBe(0.8);
    for (const clinicalCase of ["base", "scenario"]) {
      for (const id of ["aflibercept_8mg", "faricimab", "brolucizumab"]) {
        expect(isExpertEstimateInjection({ clinicalCase, drugId: id, phase: "year1" })).toBe(true);
      }
      expect(
        isExpertEstimateInjection({
          clinicalCase,
          drugId: "ranibizumab_bs",
          phase: "year1",
        })
      ).toBe(false);
      expect(
        isExpertEstimateInjection({
          clinicalCase,
          drugId: "aflibercept_bs",
          phase: "year2",
        })
      ).toBe(false);
    }
  });

  it("一覧は 2026 meta の推計セルと S6 派生を含む", () => {
    const rows = listExpertEstimateInjections();
    expect(rows.some((r) => r.clinicalCase === "2026_meta" && r.drugId === "ranibizumab" && r.phase === "year1")).toBe(
      true
    );
    expect(rows.some((r) => r.clinicalCase === "2026_meta" && r.drugId === "aflibercept" && r.phase === "year1")).toBe(
      false
    );
    expect(
      rows.some(
        (r) =>
          r.clinicalCase === "base" &&
          r.drugId === "faricimab" &&
          r.subtypeId === "pcv" &&
          r.phase === "year2"
      )
    ).toBe(true);
  });
});
