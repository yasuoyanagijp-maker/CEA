/**
 * モデルの不変条件 — 個々の数値ではなく数学的な整合性を検証する。
 */
import { describe, it, expect } from "vitest";
import {
  tp,
  normalizeTransitionProbs,
  phaseForCycle,
  isOnTreatment,
} from "../backend/utils.js";
import {
  TRANS_BASE,
  TRANS_SCENARIO,
  getBscTransitionProbs,
  injectionsForCycle,
  injectionsForMonth,
} from "../backend/clinical.js";
import { getPaperBscTransitions } from "../backend/config/table-s2-bsc-transitions.js";
import {
  runAnalysis,
  runAnalysisCached,
  runMarkov,
  DEFAULT_HORIZON,
  DEFAULT_MODEL_PARAMS,
} from "../backend/engine.js";
import {
  getInjections2026MetaForDrug,
  getMetaReferenceIntervalWeeks,
} from "../backend/config/injections-2026-meta.js";

const probSum = (p) => p.imp2 + p.imp1 + p.remain + p.wors1 + p.wors2;

const HORIZON = {
  timeHorizonYears: DEFAULT_HORIZON.timeHorizonYears,
  cycleLengthYears: DEFAULT_HORIZON.cycleLengthYears,
  discountRate: DEFAULT_HORIZON.discountRate,
};

describe("遷移確率の質量保存", () => {
  it("normalizeTransitionProbs は合計1に正規化する", () => {
    const p = normalizeTransitionProbs({
      imp2: 0.1,
      imp1: 0.2,
      remain: 0.5,
      wors1: 0.15,
      wors2: 0.1, // 合計 1.05
    });
    expect(probSum(p)).toBeCloseTo(1, 12);
  });

  it("全臨床テーブル(base/scenario)の遷移が正規化後に合計1", () => {
    for (const table of [TRANS_BASE, TRANS_SCENARIO]) {
      for (const drugs of Object.values(table)) {
        for (const phases of Object.values(drugs)) {
          for (const probs of Object.values(phases)) {
            expect(probSum(normalizeTransitionProbs(probs))).toBeCloseTo(1, 9);
          }
        }
      }
    }
  });

  it("BSC は O&T 2023 Table S2（改善 0%）で合計1を保つ", () => {
    for (const subtypeId of ["typical", "pcv", "rap"]) {
      for (const phase of ["induction", "year1", "year2", "year3plus"]) {
        const p = getBscTransitionProbs(TRANS_BASE, subtypeId, phase);
        expect(p).not.toBeNull();
        expect(p.imp1).toBe(0);
        expect(p.imp2).toBe(0);
        expect(probSum(p)).toBeCloseTo(1, 9);
      }
    }
  });

  it("BSC 悪化確率は論文 Table S2 の値（サイクルあたり、年率換算なし）", () => {
    const y2 = getPaperBscTransitions("year2");
    expect(y2.wors1).toBeCloseTo(0.27, 9);
    expect(y2.wors2).toBeCloseTo(0.283, 9);
    expect(getPaperBscTransitions("induction").wors1).toBeCloseTo(0.141, 9);
    expect(getPaperBscTransitions("year1").wors2).toBeCloseTo(0.182, 9);
  });
});

describe("フェーズ・治療期間ロジック", () => {
  it("四半期サイクル: 導入3か月 → year1 → year2 → year3+", () => {
    expect(phaseForCycle(0, 0.25)).toBe("induction");
    expect(phaseForCycle(1, 0.25)).toBe("year1");
    expect(phaseForCycle(4, 0.25)).toBe("year1");
    expect(phaseForCycle(5, 0.25)).toBe("year2");
    expect(phaseForCycle(9, 0.25)).toBe("year3plus");
    expect(phaseForCycle(40, 0.25)).toBe("year3plus");
  });

  it("treatmentDurationYears=null は常に治療中", () => {
    expect(isOnTreatment(999, 0.25, null)).toBe(true);
  });

  it("treatmentDurationYears=2 は 2年目以降 false", () => {
    expect(isOnTreatment(7, 0.25, 2)).toBe(true); // 1.75年
    expect(isOnTreatment(8, 0.25, 2)).toBe(false); // 2.0年
  });
});

describe("2026 meta 注射回数", () => {
  it("aflibercept 8 mg の2年目以降は Q16 維持相当を使う", () => {
    const schedule = getInjections2026MetaForDrug("aflibercept_8mg");
    const expected = 52 / getMetaReferenceIntervalWeeks("aflibercept_8mg");
    expect(schedule.year1).toBe(5.5);
    expect(schedule.year2).toBeCloseTo(expected, 12);
    expect(schedule.year3plus).toBeCloseTo(expected, 12);
  });

  it("最初の12か月の合計は year1（導入期を二重計上しない）", () => {
    const ctx = {
      clinicalCase: "2026_meta",
      subtypeId: "typical",
      drugId: "aflibercept_bs",
      treatmentDurationYears: 5,
      cycleLengthYears: 0.25,
    };
    const year1 = getInjections2026MetaForDrug("aflibercept_bs").year1;
    let firstYearCycles = 0;
    for (let c = 0; c < 4; c++) firstYearCycles += injectionsForCycle(c, ctx);
    expect(firstYearCycles).toBeCloseTo(year1, 9);

    let firstYearMonths = 0;
    for (let m = 0; m < 12; m++) firstYearMonths += injectionsForMonth(m, ctx);
    expect(firstYearMonths).toBeCloseTo(year1, 9);
  });

  it("5年の表期待回数は year1 + 4×year2", () => {
    const ctx = {
      clinicalCase: "2026_meta",
      subtypeId: "typical",
      drugId: "aflibercept_bs",
      treatmentDurationYears: 5,
      cycleLengthYears: 0.25,
    };
    const s = getInjections2026MetaForDrug("aflibercept_bs");
    let total = 0;
    for (let c = 0; c < 20; c++) total += injectionsForCycle(c, ctx);
    expect(total).toBeCloseTo(s.year1 + 4 * s.year2, 9);
  });

  it("ラニビズマブ 9.88 / 6.88 の5年期待回数は 37.40", () => {
    const s = getInjections2026MetaForDrug("ranibizumab_bs");
    expect(s.year1).toBe(9.88);
    expect(s.year2).toBeCloseTo(6.88, 10);
    expect(s.year1 + 4 * s.year2).toBeCloseTo(37.4, 10);
  });
});

describe("runMarkov の出力整合", () => {
  const base = {
    drugId: "aflibercept",
    subtypeId: "typical",
    costPaperId: "paper2_rbz",
    clinicalCase: "base",
    horizon: HORIZON,
    modelParams: DEFAULT_MODEL_PARAMS,
  };

  it("コスト内訳の合計 = totalCost", () => {
    const r = runMarkov(base);
    const sum = Object.values(r.costBreakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(r.totalCost, 6);
  });

  it("QALY・コストは正、軌跡の生存率は単調非増加", () => {
    const r = runMarkov(base);
    expect(r.totalQALY).toBeGreaterThan(0);
    expect(r.totalCost).toBeGreaterThan(0);
    const alive = r.trajectory.map((t) => parseFloat(t.alive));
    for (let i = 1; i < alive.length; i++) {
      expect(alive[i]).toBeLessThanOrEqual(alive[i - 1] + 1e-9);
    }
  });

  it("治療期間が短いほど薬剤コストは下がる", () => {
    const r2 = runMarkov({ ...base, treatmentDurationYears: 2 });
    const r5 = runMarkov({ ...base, treatmentDurationYears: 5 });
    const rLife = runMarkov({ ...base, treatmentDurationYears: null });
    expect(r2.costBreakdown.drugAdmin).toBeLessThan(r5.costBreakdown.drugAdmin);
    expect(r5.costBreakdown.drugAdmin).toBeLessThan(rLife.costBreakdown.drugAdmin);
  });

  it("導入期の注射回数を3か月合計として集計する", () => {
    const r = runMarkov({ ...base, treatmentDurationYears: 0.25 });
    expect(r.tableExpectedInjections).toBeCloseTo(3, 9);
    expect(r.totalInjections).toBeCloseTo(3, 9);
  });

  it("改善は視力良好方向 — 導入〜1年で typical AFL の平均 BCVA が上がる", () => {
    const r = runMarkov({ ...base, treatmentDurationYears: 5 });
    const y0 = parseFloat(r.trajectory[0].meanBcva);
    const y1 = parseFloat(r.trajectory[1].meanBcva);
    expect(y1).toBeGreaterThan(y0);
  });

  it("表示用注射回数は非割引・生存重み付き期待回数", () => {
    const r = runMarkov({ ...base, treatmentDurationYears: 5 });
    expect(r.totalInjections).toBeGreaterThan(0);
    expect(r.tableExpectedInjections).toBeGreaterThanOrEqual(r.totalInjections);
  });

  it("割引率を上げると総コスト・QALY とも減る", () => {
    const low = runMarkov({ ...base, horizon: { ...HORIZON, discountRate: 0 } });
    const high = runMarkov({ ...base, horizon: { ...HORIZON, discountRate: 0.05 } });
    expect(high.totalCost).toBeLessThan(low.totalCost);
    expect(high.totalQALY).toBeLessThan(low.totalQALY);
  });
});

describe("runAnalysisCached", () => {
  it("同一入力は同一結果(キャッシュヒット)、非キャッシュ版と一致する", () => {
    const input = {
      selectedDrugIds: ["ranibizumab_bs", "aflibercept"],
      referenceDrugId: "aflibercept",
      subtypeId: "typical",
      costPaperId: "paper2_rbz",
      clinicalCase: "base",
      horizon: HORIZON,
    };
    const a = runAnalysisCached(input);
    const b = runAnalysisCached({ ...input });
    expect(b).toBe(a); // 参照同一 = キャッシュヒット

    const fresh = runAnalysis(input);
    expect(a.results.aflibercept.totalQALY).toBeCloseTo(
      fresh.results.aflibercept.totalQALY,
      12
    );
    expect(a.results.aflibercept.totalCost).toBeCloseTo(
      fresh.results.aflibercept.totalCost,
      6
    );
  });
});

describe("ICER 判定", () => {
  it("参照薬は '—（参照）'、Δは比較薬剤−参照薬で計算する", () => {
    const analysis = runAnalysis({
      selectedDrugIds: ["ranibizumab_bs", "aflibercept", "aflibercept_bs", "faricimab"],
      referenceDrugId: "aflibercept",
      subtypeId: "typical",
      costPaperId: "paper2_rbz",
      clinicalCase: "base",
      horizon: HORIZON,
    });
    const ref = analysis.icerRows.find((r) => r.drugId === "aflibercept");
    expect(ref.icer).toBe("—（参照）");

    for (const row of analysis.icerRows.filter((r) => r.deltaQaly != null)) {
      const result = analysis.results[row.drugId];
      const reference = analysis.results.aflibercept;
      expect(row.deltaQaly).toBeCloseTo(result.totalQALY - reference.totalQALY, 12);
      expect(row.deltaCost).toBeCloseTo(result.totalCost - reference.totalCost, 6);
    }
  });

  it("同等 QALY で低コストなら Dominated ではなく cost-saving と判定する", () => {
    const analysis = runAnalysis({
      selectedDrugIds: ["aflibercept", "aflibercept_bs", "faricimab"],
      referenceDrugId: "aflibercept",
      subtypeId: "typical",
      costPaperId: "paper2_rbz",
      clinicalCase: "base",
      horizon: HORIZON,
    });
    const bs = analysis.icerRows.find((r) => r.drugId === "aflibercept_bs");
    const faricimab = analysis.icerRows.find((r) => r.drugId === "faricimab");

    expect(bs.deltaQaly).toBeCloseTo(0, 12);
    expect(bs.deltaCost).toBeLessThan(0);
    expect(bs.icer).toBe("Cost-saving (QALY同等)");

    expect(faricimab.deltaQaly).toBeCloseTo(0, 12);
    expect(faricimab.deltaCost).toBeGreaterThan(0);
    expect(faricimab.icer).toBe("Dominated");
  });
});
