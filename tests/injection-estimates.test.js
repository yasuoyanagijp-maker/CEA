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
import {
  CLINICAL_CASE_LIT_2025,
  LIT_2025_YEAR1_OVERRIDE,
  LIT_2025_YEAR1_SOURCE,
  getInjectionsLit2025ForDrug,
} from "../backend/config/injections-lit-2025.js";
import { AFL2MG_DERIVED_INJECTION_FACTOR } from "../backend/config/drug-clinical-profile.js";
import {
  CLINICAL_CASE_OPTIONS,
  usesYear1InclusiveSchedule,
  injectionsForCycle,
} from "../backend/clinical.js";
import {
  CITE,
  CLINICAL_CASE_LABELS,
  COST_PAPER_LABELS,
  TRANSITION_MODE_LABELS,
} from "../backend/config/citations.js";
import { TRANSITION_MODE_OPTIONS } from "../backend/config/transition-pool.js";
import { COST_PAPER_LIST } from "../backend/papers/index.js";

describe("専門家による推計ラベル（値は不変）", () => {
  it("ラベル文字列は指定どおり", () => {
    expect(EXPERT_ESTIMATE_LABEL).toBe("（専門家による推計）");
    expect(formatInjectionCount(6.88, true)).toBe(`6.88${EXPERT_ESTIMATE_LABEL}`);
    expect(formatInjectionCount(7.67, false)).toBe("7.67");
  });

  it("2026 meta の year1 は Wojciechowski Table 2 換算（RBZ は Q4/Q8 中点 9.88）", () => {
    expect(INJECTIONS_2026_META_YEAR1.faricimab).toBe(6.45);
    expect(INJECTIONS_2026_META_YEAR1.aflibercept_8mg).toBe(5.5);
    expect(INJECTIONS_2026_META_YEAR1.aflibercept).toBe(7.67);
    expect(INJECTIONS_2026_META_YEAR1.aflibercept_bs).toBe(7.67);
    expect(INJECTIONS_2026_META_YEAR1.ranibizumab).toBe(9.88);
    expect(INJECTIONS_2026_META_YEAR1.ranibizumab_bs).toBe(9.88);
    expect((12.14 + 7.62) / 2).toBeCloseTo(9.88, 10);
    expect(INJECTIONS_2026_META_YEAR1.brolucizumab).toBe(6.3);
    expect(getInjections2026MetaForDrug("aflibercept_bs").year2).toBeCloseTo(4.67, 10);
    expect(getInjections2026MetaForDrug("aflibercept_8mg").year2).toBeCloseTo(3.25, 10);
    expect(getInjections2026MetaForDrug("ranibizumab").year2).toBeCloseTo(6.88, 10);
    expect(getInjections2026MetaForDrug("ranibizumab_bs").year2).toBeCloseTo(6.88, 10);
  });

  it("2026 meta: 文献換算の year1 は非推計、全薬剤 year2+ は推計", () => {
    for (const id of [
      "faricimab",
      "aflibercept_8mg",
      "aflibercept",
      "aflibercept_bs",
      "brolucizumab",
      "ranibizumab",
      "ranibizumab_bs",
    ]) {
      expect(isExpertEstimateInjection({ clinicalCase: "2026_meta", drugId: id, phase: "year1" })).toBe(
        false
      );
      expect(isExpertEstimateInjection({ clinicalCase: "2026_meta", drugId: id, phase: "year2" })).toBe(
        true
      );
    }
    expect(
      isExpertEstimateCalendarYear({
        clinicalCase: "2026_meta",
        drugId: "ranibizumab_bs",
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

  it("一覧は 2026 meta の year2+ 推計と S6 派生を含み、RBZ year1 は含めない", () => {
    const rows = listExpertEstimateInjections();
    expect(rows.some((r) => r.clinicalCase === "2026_meta" && r.drugId === "ranibizumab" && r.phase === "year1")).toBe(
      false
    );
    expect(rows.some((r) => r.clinicalCase === "2026_meta" && r.drugId === "ranibizumab" && r.phase === "year2")).toBe(
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

describe("感度分析 lit_2025_2026 注射回数", () => {
  it("プルダウンに感度分析オプションがあり、既定は 2026_meta のまま", () => {
    const ids = CLINICAL_CASE_OPTIONS.map((o) => o.id);
    expect(ids).toEqual(["base", "scenario", "2026_meta", CLINICAL_CASE_LIT_2025]);
    expect(usesYear1InclusiveSchedule("2026_meta")).toBe(true);
    expect(usesYear1InclusiveSchedule(CLINICAL_CASE_LIT_2025)).toBe(true);
    expect(usesYear1InclusiveSchedule("base")).toBe(false);
  });

  it("プルダウン表示名は中身と著者・誌・年で、2026 meta という語を使わない", () => {
    const byId = Object.fromEntries(CLINICAL_CASE_OPTIONS.map((o) => [o.id, o.label]));
    expect(byId.base).toBe(CLINICAL_CASE_LABELS.base);
    expect(byId.scenario).toBe(CLINICAL_CASE_LABELS.scenario);
    expect(byId["2026_meta"]).toBe(CLINICAL_CASE_LABELS["2026_meta"]);
    expect(byId[CLINICAL_CASE_LIT_2025]).toBe(CLINICAL_CASE_LABELS.lit_2025_2026);
    expect(byId["2026_meta"]).toContain(CITE.wojciechowski2025);
    expect(byId.base).toContain(CITE.yanagi2024);
    for (const o of CLINICAL_CASE_OPTIONS) {
      expect(o.label).not.toMatch(/2026 meta|2026メタ/i);
    }
    const trans = Object.fromEntries(TRANSITION_MODE_OPTIONS.map((o) => [o.id, o.label]));
    expect(trans.drug_specific).toBe(TRANSITION_MODE_LABELS.drug_specific);
    expect(trans.rbz_afl_pooled).toBe(TRANSITION_MODE_LABELS.rbz_afl_pooled);
    const costs = Object.fromEntries(COST_PAPER_LIST.map((p) => [p.id, p.label]));
    expect(costs.default_integrated).toBe(COST_PAPER_LABELS.default_integrated);
    expect(costs.paper1_faricimab).toBe(COST_PAPER_LABELS.paper1_faricimab);
    expect(costs.paper2_rbz).toBe(COST_PAPER_LABELS.paper2_rbz);
  });

  it("確認文献の year1 だけ差し替え、無いセルと year2 は 2026 meta 既存値", () => {
    expect(LIT_2025_YEAR1_OVERRIDE.aflibercept_8mg).toBe(5.55);
    expect(LIT_2025_YEAR1_OVERRIDE.aflibercept).toBe(7.0);
    expect(LIT_2025_YEAR1_OVERRIDE.aflibercept_bs).toBe(7.0);
    expect(LIT_2025_YEAR1_OVERRIDE.faricimab).toBe(6.5);
    expect(LIT_2025_YEAR1_OVERRIDE.brolucizumab).toBe(6.3);
    expect(LIT_2025_YEAR1_OVERRIDE.ranibizumab).toBeUndefined();
    expect(LIT_2025_YEAR1_OVERRIDE.ranibizumab_bs).toBeUndefined();

    expect(getInjectionsLit2025ForDrug("aflibercept_8mg").year1).toBe(5.55);
    expect(getInjectionsLit2025ForDrug("aflibercept").year1).toBe(7.0);
    expect(getInjectionsLit2025ForDrug("faricimab").year1).toBe(6.5);
    expect(getInjectionsLit2025ForDrug("brolucizumab").year1).toBe(6.3);
    expect(getInjectionsLit2025ForDrug("ranibizumab").year1).toBe(9.88);
    expect(getInjectionsLit2025ForDrug("ranibizumab_bs").year1).toBe(9.88);

    for (const id of Object.keys(INJECTIONS_2026_META_YEAR1)) {
      expect(getInjectionsLit2025ForDrug(id).year2).toBeCloseTo(
        getInjections2026MetaForDrug(id).year2,
        10
      );
    }
    expect(getInjectionsLit2025ForDrug("ranibizumab").year2).toBeCloseTo(6.88, 10);
    expect(getInjectionsLit2025ForDrug("aflibercept").year2).toBeCloseTo(4.67, 10);
    expect(getInjectionsLit2025ForDrug("aflibercept_8mg").year2).toBeCloseTo(3.25, 10);
  });

  it("出典注記があり、新文献のない RBZ year1 と全薬剤 year2 は推計", () => {
    expect(LIT_2025_YEAR1_SOURCE.aflibercept_8mg).toMatch(/Iida, Jpn J Ophthalmol, 2025/);
    expect(LIT_2025_YEAR1_SOURCE.aflibercept).toMatch(/2q8 7\.0/);
    expect(LIT_2025_YEAR1_SOURCE.faricimab).toMatch(/Okawa, J Vitreoretin Dis, 2025/);
    expect(LIT_2025_YEAR1_SOURCE.brolucizumab).toMatch(/Matsumoto, Sci Rep, 2022/);
    expect(LIT_2025_YEAR1_SOURCE.ranibizumab).toMatch(/新文献なし/);

    expect(
      isExpertEstimateInjection({
        clinicalCase: CLINICAL_CASE_LIT_2025,
        drugId: "faricimab",
        phase: "year1",
      })
    ).toBe(false);
    expect(
      isExpertEstimateInjection({
        clinicalCase: CLINICAL_CASE_LIT_2025,
        drugId: "ranibizumab_bs",
        phase: "year1",
      })
    ).toBe(true);
    expect(
      isExpertEstimateInjection({
        clinicalCase: CLINICAL_CASE_LIT_2025,
        drugId: "aflibercept",
        phase: "year2",
      })
    ).toBe(true);

    const rows = listExpertEstimateInjections();
    expect(
      rows.some(
        (r) => r.clinicalCase === CLINICAL_CASE_LIT_2025 && r.drugId === "ranibizumab" && r.phase === "year1"
      )
    ).toBe(true);
    expect(
      rows.some(
        (r) => r.clinicalCase === CLINICAL_CASE_LIT_2025 && r.drugId === "faricimab" && r.phase === "year1"
      )
    ).toBe(false);
  });

  it("最初の12か月の合計は差し替え後 year1（導入期を二重計上しない）", () => {
    const ctx = {
      clinicalCase: CLINICAL_CASE_LIT_2025,
      subtypeId: "typical",
      drugId: "aflibercept_8mg",
      treatmentDurationYears: 5,
      cycleLengthYears: 0.25,
    };
    let firstYearCycles = 0;
    for (let c = 0; c < 4; c++) firstYearCycles += injectionsForCycle(c, ctx);
    expect(firstYearCycles).toBeCloseTo(5.55, 9);
  });
});
