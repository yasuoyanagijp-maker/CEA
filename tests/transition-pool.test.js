import { describe, it, expect } from "vitest";
import {
  poolPercentVectors,
  TRANSITION_POOL_WEIGHTS,
  TABLE_S5_POOLED_RAW_PERCENT,
  TRANS_POOLED_TABLE,
  TRANSITION_MODE_POOLED,
} from "../backend/config/transition-pool.js";
import { TABLE_S5_RAW_PERCENT } from "../backend/config/table-s5-transitions.js";
import { normalizeTransitionProbs } from "../backend/utils.js";
import {
  runAnalysis,
  runMarkov,
  DEFAULT_HORIZON,
  DEFAULT_MODEL_PARAMS,
} from "../backend/engine.js";

const PHASES = ["induction", "year1", "year2", "year3plus"];
const SUBTYPES = ["typical", "pcv", "rap"];
const HORIZON = { ...DEFAULT_HORIZON, discountRate: 0.02 };

function probSum(p) {
  return p.imp2 + p.imp1 + p.remain + p.wors1 + p.wors2;
}

describe("病型別 RBZ+AFL 遷移統合", () => {
  it("加重平均は (n_rbz * p_rbz + n_afl * p_afl) / (n_rbz + n_afl)", () => {
    expect(poolPercentVectors([10, 0, 90, 0, 0], [0, 0, 100, 0, 0], 1, 1)).toEqual([
      5, 0, 95, 0, 0,
    ]);
    expect(poolPercentVectors([10, 20, 30, 20, 20], [0, 10, 50, 20, 20], 80, 188)[0]).toBeCloseTo(
      (10 * 80 + 0 * 188) / 268,
      10
    );
  });

  it("病型をまたいでまとめない — typical と PCV の統合値は異なる", () => {
    const t = TABLE_S5_POOLED_RAW_PERCENT.typical.pooled.year2;
    const p = TABLE_S5_POOLED_RAW_PERCENT.pcv.pooled.year2;
    expect(t).not.toEqual(p);
  });

  it("各病型・期間の統合は S5 2列の症例数加重と一致し、正規化後に合計1", () => {
    for (const subtypeId of SUBTYPES) {
      for (const phase of PHASES) {
        const w = TRANSITION_POOL_WEIGHTS[subtypeId][phase];
        const expected = poolPercentVectors(
          TABLE_S5_RAW_PERCENT[subtypeId].rbz_bs[phase],
          TABLE_S5_RAW_PERCENT[subtypeId].aflibercept[phase],
          w.rbz,
          w.afl
        );
        const compiled = TRANS_POOLED_TABLE[subtypeId].pooled[phase];
        expect(probSum(normalizeTransitionProbs(compiled))).toBeCloseTo(1, 9);
        expect(compiled.imp2).toBeCloseTo(expected[0] / 100, 3);
      }
    }
  });

  it("Yoneda 期間は 7:3、Jin 期間は 131:84 按分、RAP Y2/Y3+ は 1:1", () => {
    expect(TRANSITION_POOL_WEIGHTS.typical.year1).toMatchObject({ rbz: 80, afl: 188 });
    expect(TRANSITION_POOL_WEIGHTS.pcv.year1).toMatchObject({ rbz: 60, afl: 140 });
    expect(TRANSITION_POOL_WEIGHTS.rap.year1).toMatchObject({ rbz: 10, afl: 22 });
    expect(TRANSITION_POOL_WEIGHTS.typical.year2.rbz + TRANSITION_POOL_WEIGHTS.typical.year2.afl).toBe(
      111
    );
    expect(TRANSITION_POOL_WEIGHTS.pcv.year2.rbz + TRANSITION_POOL_WEIGHTS.pcv.year2.afl).toBe(104);
    expect(TRANSITION_POOL_WEIGHTS.rap.year2).toMatchObject({ rbz: 1, afl: 1 });
    expect(TRANSITION_POOL_WEIGHTS.rap.year3plus).toMatchObject({ rbz: 1, afl: 1 });
  });

  it("既定（薬剤別）では QALY が薬剤系列で分かれ、統合では全薬剤同一 QALY", () => {
    const specific = runAnalysis({
      selectedDrugIds: ["ranibizumab_bs", "aflibercept_bs", "faricimab"],
      referenceDrugId: "aflibercept_bs",
      subtypeId: "pcv",
      costPaperId: "default_integrated",
      clinicalCase: "2026_meta",
      transitionMode: "drug_specific",
      horizon: HORIZON,
      treatmentDurationYears: 5,
      modelParams: DEFAULT_MODEL_PARAMS,
    });
    expect(specific.results.ranibizumab_bs.totalQALY).not.toBeCloseTo(
      specific.results.aflibercept_bs.totalQALY,
      4
    );

    const pooled = runAnalysis({
      selectedDrugIds: ["ranibizumab_bs", "aflibercept_bs", "faricimab", "brolucizumab"],
      referenceDrugId: "aflibercept_bs",
      subtypeId: "pcv",
      costPaperId: "default_integrated",
      clinicalCase: "2026_meta",
      transitionMode: TRANSITION_MODE_POOLED,
      horizon: HORIZON,
      treatmentDurationYears: 5,
      modelParams: DEFAULT_MODEL_PARAMS,
    });
    const q = pooled.results.aflibercept_bs.totalQALY;
    for (const id of ["ranibizumab_bs", "faricimab", "brolucizumab"]) {
      expect(pooled.results[id].totalQALY).toBeCloseTo(q, 9);
    }
    expect(pooled.results.ranibizumab_bs.totalCost).not.toBe(
      pooled.results.aflibercept_bs.totalCost
    );
  });

  it("統合モードでも病型が違えば QALY は違う", () => {
    const q = {};
    for (const subtypeId of SUBTYPES) {
      q[subtypeId] = runMarkov({
        drugId: "aflibercept_bs",
        subtypeId,
        costPaperId: "default_integrated",
        clinicalCase: "2026_meta",
        transitionMode: TRANSITION_MODE_POOLED,
        horizon: HORIZON,
        treatmentDurationYears: 5,
        modelParams: DEFAULT_MODEL_PARAMS,
      }).totalQALY;
    }
    expect(q.typical).not.toBeCloseTo(q.pcv, 3);
    expect(q.pcv).not.toBeCloseTo(q.rap, 3);
  });
});
