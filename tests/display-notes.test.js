import { describe, it, expect } from "vitest";
import {
  getDrugClinicalNote,
  DRUG_IDS,
  runAnalysis,
  runPatientDrugComparison,
  describeInjMonthOopCapNote,
} from "../backend/engine.js";
import { POOLED_TRANSITION_NOTE } from "../backend/config/citations.js";
import { TRANSITION_MODE_POOLED } from "../backend/config/transition-pool.js";

const POOLED_INPUT = {
  selectedDrugIds: DRUG_IDS,
  referenceDrugId: "aflibercept_bs",
  subtypeId: "typical",
  costPaperId: "default_integrated",
  clinicalCase: "2026_meta",
  transitionMode: TRANSITION_MODE_POOLED,
  treatmentDurationYears: 5,
  horizon: {
    timeHorizonYears: 20,
    cycleLengthYears: 0.25,
    discountRate: 0.02,
    wtpPerQaly: 5_000_000,
  },
};

describe("統合モードの遷移注記（表示のみ・数値は不変）", () => {
  it("統合モードでは全薬剤が「遷移：病型別 RBZ+AFL 統合（全薬剤共通）」で始まる", () => {
    for (const id of DRUG_IDS) {
      const note = getDrugClinicalNote(id, { transitionMode: TRANSITION_MODE_POOLED });
      expect(note.startsWith(POOLED_TRANSITION_NOTE)).toBe(true);
      expect(note).not.toMatch(/遷移 S5:|遷移 Table S5:/);
    }
  });

  it("薬剤別モードでは従来の S5 列注記を出し、（暫定）は出さない", () => {
    const fari = getDrugClinicalNote("faricimab", { transitionMode: "drug_specific" });
    const brol = getDrugClinicalNote("brolucizumab", { transitionMode: "drug_specific" });
    const rbz = getDrugClinicalNote("ranibizumab", { transitionMode: "drug_specific" });
    expect(fari).toContain("遷移 Table S5: aflibercept 列");
    expect(brol).toContain("遷移 Table S5: aflibercept 列");
    expect(rbz).toContain("遷移 S5: rbz_bs 列");
    for (const id of DRUG_IDS) {
      expect(getDrugClinicalNote(id, { transitionMode: "drug_specific" })).not.toContain("暫定");
      expect(getDrugClinicalNote(id, { transitionMode: TRANSITION_MODE_POOLED })).not.toContain("暫定");
    }
  });

  it("CEA サマリーの warnings も統合モードでは全薬剤共通の遷移注記", () => {
    const analysis = runAnalysis(POOLED_INPUT);
    for (const id of DRUG_IDS) {
      const w0 = analysis.results[id].warnings?.[0] ?? "";
      expect(w0.startsWith(POOLED_TRANSITION_NOTE)).toBe(true);
    }
  });

  it("統合モードの典型 nAMD 総費用・QALY は従来どおり", () => {
    const analysis = runAnalysis(POOLED_INPUT);
    const bs = analysis.results.aflibercept_bs;
    expect(bs.totalQALY).toBeCloseTo(6.83, 3);
    expect(Math.round(bs.totalCost)).toBe(35_126_165);
    const rbz = analysis.results.ranibizumab;
    expect(rbz.totalQALY).toBeCloseTo(6.83, 3);
    expect(Math.round(rbz.totalCost)).toBe(36_687_581);
  });
});

describe("患者説明カードの高額療養費ラベル", () => {
  it("上限未達なら定率負担と月上限を出し、達したときだけ上限を適用", () => {
    expect(
      describeInjMonthOopCapNote({ capped: false, age: 75, incomeBracket: "standard" })
    ).toBe("定率負担（月上限 22,000円未満）");
    expect(
      describeInjMonthOopCapNote({ capped: true, age: 75, incomeBracket: "standard" })
    ).toBe("上限を適用");
  });

  it("既定患者（75歳・一般I・seed 42）の注射月は上限未達で金額は変わらない", () => {
    const cmp = runPatientDrugComparison({
      entryAge: 75,
      sex: "male",
      subtypeId: "typical",
      incomeBracket: "standard",
      seed: 42,
      costPaperId: "default_integrated",
      clinicalCase: "2026_meta",
      transitionMode: TRANSITION_MODE_POOLED,
      treatmentDurationYears: 5,
      timeHorizonYears: 20,
    });
    const bs = cmp.results.aflibercept_bs;
    const injMonths = (bs.monthlyTrajectory ?? []).filter((m) => m.year === 0 && m.injections > 0);
    expect(injMonths.length).toBeGreaterThan(0);
    expect(injMonths.every((m) => m.capped === false)).toBe(true);
    expect(Math.max(...injMonths.map((m) => m.patientOop))).toBe(8171);
    expect(bs.annualTrajectory[0].patientOop).toBe(54151);
  });
});
