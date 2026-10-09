import { describe, it, expect } from "vitest";
import {
  getDrugClinicalNote,
  getDrugInjectionNote,
  DRUG_IDS,
  runAnalysis,
  runPatientDrugComparison,
  describeInjMonthOopCapNote,
} from "../backend/engine.js";
import { POOLED_TRANSITION_NOTE } from "../backend/config/citations.js";
import { TRANSITION_MODE_POOLED } from "../backend/config/transition-pool.js";
import { CLINICAL_CASE_LIT_2025 } from "../backend/config/injections-lit-2025.js";

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
      const note = getDrugClinicalNote(id, {
        transitionMode: TRANSITION_MODE_POOLED,
        clinicalCase: "2026_meta",
      });
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
  it("上限未達なら定率負担と実額上限を出し、達したときだけ上限を適用", () => {
    expect(
      describeInjMonthOopCapNote({ capped: false, monthlyLimit: 22_000 })
    ).toBe("定率負担（月上限 22,000円未満）");
    expect(
      describeInjMonthOopCapNote({ capped: true, monthlyLimit: 22_000 })
    ).toBe("上限を適用");
    expect(
      describeInjMonthOopCapNote({ capped: false, monthlyLimit: 85_800 })
    ).toBe("定率負担（月上限 85,800円未満）");
    expect(describeInjMonthOopCapNote({ capped: false, monthlyLimit: 85_800 })).not.toContain("＋");
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
    expect(injMonths.every((m) => m.limit === 22_000)).toBe(true);
    expect(Math.max(...injMonths.map((m) => m.patientOop))).toBe(8171);
    expect(bs.annualTrajectory[0].patientOop).toBe(54151);
  });
});

describe("注射回数セットに対応する1文の注記（表示のみ・数値は不変）", () => {
  it("ネットワークメタ解析では S6 列もベース/シナリオ併記も出さない", () => {
    for (const id of DRUG_IDS) {
      const note = getDrugInjectionNote(id, "2026_meta");
      expect(note).toMatch(/^注射：1年目 /);
      expect(note).not.toContain("注射 S6");
      expect(note).not.toContain("Table S6");
      expect(note).not.toContain("ベース/シナリオ");
      expect(note).not.toContain("ネットワークメタ解析セットでは");
    }
  });

  it("ラニビズマブのメタ注記は Wojciechowski 9.88 と 2年目 6.88 推計の1文", () => {
    expect(getDrugInjectionNote("ranibizumab", "2026_meta")).toBe(
      "注射：1年目 9.88（Wojciechowski 2025、Q4とQ8の中点）、2年目以降 6.88（専門家による推計）"
    );
  });

  it("8mg・ファリシマブ・ブロルシズマブのメタ注記は薬剤別メタ値の1文だけ", () => {
    expect(getDrugInjectionNote("aflibercept_8mg", "2026_meta")).toBe(
      "注射：1年目 5.5（Wojciechowski 2025、Q12とQ16の中点）、2年目以降 3.25（Q16維持相当、専門家による推計）"
    );
    expect(getDrugInjectionNote("faricimab", "2026_meta")).toBe(
      "注射：1年目 6.45（Wojciechowski 2025、範囲中点）、2年目以降 3.45（専門家による推計）"
    );
    expect(getDrugInjectionNote("brolucizumab", "2026_meta")).toBe(
      "注射：1年目 6.3（Matsumoto 2022 / Inoda 2024 の中点）、2年目以降 3.3（専門家による推計）"
    );
  });

  it("ベースケースは S6 列、シナリオは S8 列で、メタ文は出さない", () => {
    expect(getDrugInjectionNote("ranibizumab", "base")).toBe(
      "注射 S6: 病型別 rbz_bs 列（BS と同一回数）"
    );
    expect(getDrugInjectionNote("aflibercept", "base")).toBe(
      "注射 S6: 病型別 aflibercept 列"
    );
    expect(getDrugInjectionNote("faricimab", "base")).toContain("Table S6");
    expect(getDrugInjectionNote("faricimab", "base")).not.toContain("ネットワークメタ解析");
    expect(getDrugInjectionNote("ranibizumab", "scenario")).toBe(
      "注射 S8: 病型別 rbz_bs 列（BS と同一回数）"
    );
    expect(getDrugInjectionNote("faricimab", "scenario")).toContain("Table S8");
    expect(getDrugInjectionNote("faricimab", "scenario")).not.toContain("Table S6");
  });

  it("感度分析は確認文献の1文で、S6 列は出さない", () => {
    const rbz = getDrugInjectionNote("ranibizumab", CLINICAL_CASE_LIT_2025);
    const afl = getDrugInjectionNote("aflibercept", CLINICAL_CASE_LIT_2025);
    const fari = getDrugInjectionNote("faricimab", CLINICAL_CASE_LIT_2025);
    expect(rbz).toMatch(/^注射：1年目 9.88（/);
    expect(rbz).toContain("当該セットに新文献なし");
    expect(afl).toContain("1年目 7");
    expect(afl).toContain("Iida, Jpn J Ophthalmol, 2025");
    expect(fari).toContain("Okawa, J Vitreoretin Dis, 2025");
    for (const id of DRUG_IDS) {
      expect(getDrugInjectionNote(id, CLINICAL_CASE_LIT_2025)).not.toContain("注射 S6");
    }
  });

  it("CEA サマリーのメタ＋統合は注射注記が1文で、QALY・費用は変わらない", () => {
    const analysis = runAnalysis(POOLED_INPUT);
    const rbzNote = analysis.results.ranibizumab.warnings?.[0] ?? "";
    expect(rbzNote).toBe(
      `${POOLED_TRANSITION_NOTE}。注射：1年目 9.88（Wojciechowski 2025、Q4とQ8の中点）、2年目以降 6.88（専門家による推計）`
    );
    const fariNote = analysis.results.faricimab.warnings?.[0] ?? "";
    expect(fariNote).toContain("注射：1年目 6.45");
    expect(fariNote).not.toContain("ベース/シナリオ");
    expect(fariNote).not.toContain("注射 S6");
    const bs = analysis.results.aflibercept_bs;
    expect(bs.totalQALY).toBeCloseTo(6.83, 3);
    expect(Math.round(bs.totalCost)).toBe(35_126_165);
  });

  it("患者比較の warnings も選択セットの注射注記1文で、S6 重複警告は出さない", () => {
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
    const note = cmp.results.ranibizumab.warnings?.[0] ?? "";
    expect(note).toContain("注射：1年目 9.88");
    expect(note).not.toContain("注射 S6");
    expect(cmp.results.faricimab.warnings?.join(" ")).not.toContain("ベース/シナリオ");
    expect(cmp.results.faricimab.warnings?.join(" ")).not.toContain("病型 S6");
  });
});
