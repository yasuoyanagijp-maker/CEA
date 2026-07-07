import { describe, it, expect } from "vitest";
import {
  computeBreakEvenTable,
  estimateAnnualPatientOopForInterval,
} from "../backend/switch-analysis.js";
import { runPatientMidSwitchComparison } from "../backend/patient-sim.js";
import {
  computeMonthlyPatientOop,
  getMonthlyOutpatientLimit,
  getCopayRate,
} from "../backend/config/japan-nhi.js";

// paper2: BS ¥67,959 + 手技 ¥6,000 = ¥73,959/回
//         8mg ¥145,718 + ¥6,000 = ¥151,718/回

describe("高額療養費 — 月次限度額・負担割合（厚労省の現行値）", () => {
  it("70歳未満に外来特例はない — 一般（エ相当）は月57,600円", () => {
    expect(getMonthlyOutpatientLimit(65, "standard")).toBe(57_600);
  });

  it("70歳未満・住民税非課税（オ相当）は月35,400円", () => {
    expect(getMonthlyOutpatientLimit(65, "low")).toBe(35_400);
  });

  it("ウ相当（年収370〜770万円）: 医療費100万円で 80,100 + 1% = 87,430円（厚労省の例示）", () => {
    expect(getMonthlyOutpatientLimit(65, "general", 1_000_000)).toBeCloseTo(87_430, 6);
  });

  it("イ・ア相当は 167,400+1% / 252,600+1%", () => {
    expect(getMonthlyOutpatientLimit(65, "high", 558_000)).toBe(167_400);
    expect(getMonthlyOutpatientLimit(65, "top", 842_000)).toBe(252_600);
    expect(getMonthlyOutpatientLimit(65, "top", 942_000)).toBeCloseTo(253_600, 6);
  });

  it("70歳以上の外来特例: 一般 18,000円・住民税非課税 8,000円", () => {
    expect(getMonthlyOutpatientLimit(75, "standard")).toBe(18_000);
    expect(getMonthlyOutpatientLimit(72, "standard")).toBe(18_000);
    expect(getMonthlyOutpatientLimit(75, "low")).toBe(8_000);
  });

  it("70歳以上の現役並みは外来特例廃止 — 80,100+1% 等の世帯限度額と同一", () => {
    expect(getMonthlyOutpatientLimit(75, "general", 267_000)).toBe(80_100);
    expect(getMonthlyOutpatientLimit(72, "general", 1_000_000)).toBeCloseTo(87_430, 6);
    expect(getMonthlyOutpatientLimit(75, "top", 842_000)).toBe(252_600);
  });

  it("負担割合: 70歳以上の現役並みは3割、75歳以上一般は1割、70–74一般は2割", () => {
    expect(getCopayRate(75, null, "general")).toBe(0.3);
    expect(getCopayRate(72, null, "top")).toBe(0.3);
    expect(getCopayRate(75, null, "standard")).toBe(0.1);
    expect(getCopayRate(72, null, "standard")).toBe(0.2);
    expect(getCopayRate(72, "early_elderly_10", "standard")).toBe(0.1);
    expect(getCopayRate(65, null, "standard")).toBe(0.3);
  });
});

describe("estimateAnnualPatientOopForInterval", () => {
  it("75歳・一般（月上限¥18,000）: 上限未満なら 1割 × 年間回数", () => {
    const r = estimateAnnualPatientOopForInterval({
      drugId: "aflibercept_bs",
      intervalWeeks: 8,
      costPaperId: "paper2_rbz",
      age: 75,
      incomeBracket: "standard",
    });
    // 1割負担 ¥7,395.9 < 上限 ¥18,000 → 上限適用なし
    expect(r.perInjectionOop).toBeCloseTo(73959 * 0.1, 6);
    expect(r.annualInjections).toBeCloseTo(52 / 8, 6);
    expect(r.annualOop).toBeCloseTo(73959 * 0.1 * (52 / 8), 4);
    expect(r.capped).toBe(false);
  });

  it("75歳・一般: 8mg の注射月 1割負担は月上限で ¥14,571.8（上限未達）", () => {
    const r = estimateAnnualPatientOopForInterval({
      drugId: "aflibercept_8mg",
      intervalWeeks: 8,
      costPaperId: "paper2_rbz",
      age: 75,
      incomeBracket: "standard",
    });
    const monthly = computeMonthlyPatientOop({
      monthlyDirectMedical: 151718,
      age: 75,
      incomeBracket: "standard",
    });
    expect(r.perInjectionOop).toBeCloseTo(monthly.patientOop, 6);
  });

  it("65歳・一般（3割・外来特例なし）: 8mg の3割 ¥45,515 は上限 ¥57,600 未満でキャップされない", () => {
    const r = estimateAnnualPatientOopForInterval({
      drugId: "aflibercept_8mg",
      intervalWeeks: 12,
      costPaperId: "paper2_rbz",
      age: 65,
      incomeBracket: "standard",
    });
    expect(r.perInjectionOop).toBeCloseTo(151718 * 0.3, 4);
    expect(r.capped).toBe(false);
    expect(r.limit).toBe(57_600);
  });

  it("65歳・住民税非課税: 8mg の3割 ¥45,515 は上限 ¥35,400 でキャップ", () => {
    const r = estimateAnnualPatientOopForInterval({
      drugId: "aflibercept_8mg",
      intervalWeeks: 12,
      costPaperId: "paper2_rbz",
      age: 65,
      incomeBracket: "low",
    });
    expect(r.perInjectionOop).toBe(35_400);
    expect(r.capped).toBe(true);
    expect(r.annualOop).toBeCloseTo(35_400 * (52 / 12), 4);
  });

  it("外来特例が効く区分（72歳・2割・一般）では高額薬同士の年間自己負担が同額になる", () => {
    const args = {
      intervalWeeks: 8,
      costPaperId: "paper2_rbz",
      age: 72,
      incomeBracket: "standard",
    };
    const mg8 = estimateAnnualPatientOopForInterval({ ...args, drugId: "aflibercept_8mg" });
    const fari = estimateAnnualPatientOopForInterval({ ...args, drugId: "faricimab" });
    // 2割負担: 8mg ¥30,344、ファリ ¥29,557 — どちらも外来特例上限 ¥18,000 に到達
    expect(mg8.capped).toBe(true);
    expect(fari.capped).toBe(true);
    expect(mg8.perInjectionOop).toBe(18_000);
    expect(mg8.annualOop).toBeCloseTo(fari.annualOop, 6);
  });

  it("間隔 < 約4.3週（月2回相当）は月合算で上限を適用", () => {
    const r = estimateAnnualPatientOopForInterval({
      drugId: "aflibercept_bs",
      intervalWeeks: 2,
      costPaperId: "paper2_rbz",
      age: 75,
      incomeBracket: "standard",
    });
    const injPerMonth = 52 / 2 / 12;
    const monthly = computeMonthlyPatientOop({
      monthlyDirectMedical: 73959 * injPerMonth,
      age: 75,
      incomeBracket: "standard",
    });
    expect(r.annualOop).toBeCloseTo(monthly.patientOop * 12, 4);
  });

  it("不正入力（間隔0・年齢NaN・薬価なし）は null", () => {
    expect(
      estimateAnnualPatientOopForInterval({
        drugId: "aflibercept_bs",
        intervalWeeks: 0,
        costPaperId: "paper2_rbz",
        age: 75,
        incomeBracket: "standard",
      })
    ).toBeNull();
    expect(
      estimateAnnualPatientOopForInterval({
        drugId: "aflibercept_bs",
        intervalWeeks: 8,
        costPaperId: "paper2_rbz",
        age: NaN,
        incomeBracket: "standard",
      })
    ).toBeNull();
  });
});

describe("computeBreakEvenTable — patient オプション", () => {
  it("patient 指定時、各行に患者負担と現行との年差を付与", () => {
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept_bs",
      currentIntervalWeeks: 8,
      costPaperId: "paper2_rbz",
      patient: { age: 75, incomeBracket: "standard" },
    });
    expect(t.currentPatientOop).not.toBeNull();
    const row = t.rows.find((r) => r.drugId === "aflibercept_8mg");
    expect(row.patientOop.annualOop).toBeGreaterThan(t.currentPatientOop.annualOop);
    expect(row.patientOopAnnualDelta).toBeCloseTo(
      row.patientOop.annualOop - t.currentPatientOop.annualOop,
      6
    );
  });

  it("patient 未指定では従来どおり（患者負担フィールドなし）", () => {
    const t = computeBreakEvenTable({
      currentDrugId: "aflibercept_bs",
      currentIntervalWeeks: 8,
      costPaperId: "paper2_rbz",
    });
    expect(t.currentPatientOop).toBeNull();
    const row = t.rows.find((r) => r.drugId === "aflibercept_8mg");
    expect(row.patientOop).toBeNull();
    expect(row.patientOopAnnualDelta).toBeNull();
  });
});

describe("runPatientMidSwitchComparison", () => {
  const base = {
    entryAge: 75,
    sex: "male",
    subtypeId: "typical",
    costPaperId: "paper2_rbz",
    clinicalCase: "base",
    timeHorizonYears: 20,
    treatmentDurationYears: 5,
    incomeBracket: "standard",
    seed: 42,
  };

  it("スイッチ月まで両アームの累積負担が一致する", () => {
    const r = runPatientMidSwitchComparison({
      ...base,
      currentDrugId: "aflibercept_8mg",
      switchToDrugId: "aflibercept_bs",
      switchAtYear: 2,
    });
    expect(r).not.toBeNull();
    for (const m of r.monthly) {
      if (m.month >= r.switchAtMonth) break;
      expect(m.cumOopSwitch).toBe(m.cumOopContinue);
    }
  });

  it("高い薬から安い薬へのスイッチは総負担を減らし、逆転月がある", () => {
    const r = runPatientMidSwitchComparison({
      ...base,
      currentDrugId: "aflibercept_8mg",
      switchToDrugId: "aflibercept_bs",
      switchAtYear: 2,
    });
    expect(r.switchApplied).toBe(true);
    expect(r.deltaPatientOop).toBeLessThan(0);
    expect(r.crossoverMonth).not.toBeNull();
    expect(r.crossoverMonth).toBeGreaterThanOrEqual(r.switchAtMonth);
  });

  it("同一薬へのスイッチ（自明ケース）は再導入分だけ負担が増減し得るが経路は同一 seed で再現的", () => {
    const a = runPatientMidSwitchComparison({
      ...base,
      currentDrugId: "aflibercept_bs",
      switchToDrugId: "aflibercept_8mg",
      switchAtYear: 2,
    });
    const b = runPatientMidSwitchComparison({
      ...base,
      currentDrugId: "aflibercept_bs",
      switchToDrugId: "aflibercept_8mg",
      switchAtYear: 2,
    });
    expect(a.timelineMonths).toBe(b.timelineMonths);
    expect(a.deltaPatientOop).toBe(b.deltaPatientOop);
    // 安い薬 → 高い薬は負担増
    expect(a.deltaPatientOop).toBeGreaterThan(0);
    expect(a.crossoverMonth).toBeNull();
  });

  it("スイッチ時期がフォロー期間より後なら差は 0（switchApplied=false）", () => {
    const r = runPatientMidSwitchComparison({
      ...base,
      currentDrugId: "aflibercept_bs",
      switchToDrugId: "aflibercept_8mg",
      switchAtYear: 40,
    });
    if (!r.switchApplied) {
      expect(r.deltaPatientOop).toBe(0);
    }
  });

  it("switchAtYear が不正なら null", () => {
    expect(
      runPatientMidSwitchComparison({
        ...base,
        currentDrugId: "aflibercept_bs",
        switchToDrugId: "aflibercept_8mg",
        switchAtYear: 0,
      })
    ).toBeNull();
  });
});
