/**
 * ゴールデンテスト — リファクタリング前の実装出力(tests/golden.json)と
 * 完全一致(丸め誤差内)することを保証する。
 * 意図的にモデル挙動を変える場合は tests/generate-golden.mjs で再生成し、
 * 差分をコミットに含めてレビューすること。
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "../backend/engine.js";
import { buildGoldenCases } from "./golden-cases.js";
import golden from "./golden.json";

const QALY_TOL = 1e-6;
const COST_TOL = 0.5; // 円

describe("golden: runAnalysis outputs match pre-refactor snapshot", () => {
  for (const { id, input } of buildGoldenCases()) {
    it(id, () => {
      const expected = golden[id];
      expect(expected, `golden.json に ${id} がない — generate-golden.mjs を再実行`).toBeDefined();

      const analysis = runAnalysis(input);
      for (const [drugId, exp] of Object.entries(expected)) {
        const r = analysis.results[drugId];
        expect(r, `${drugId} の結果がない`).toBeDefined();

        if (exp.totalQALY == null) {
          expect(r.totalQALY).toBeNull();
        } else {
          expect(r.totalQALY).toBeCloseTo(exp.totalQALY, 5);
        }
        expect(Math.abs(r.totalCost - exp.totalCost)).toBeLessThan(COST_TOL);
        expect(r.incomplete ?? false).toBe(exp.incomplete);

        if (exp.costBreakdown) {
          for (const [k, v] of Object.entries(exp.costBreakdown)) {
            expect(
              Math.abs(r.costBreakdown[k] - v),
              `costBreakdown.${k} (${drugId})`
            ).toBeLessThan(COST_TOL);
          }
        }
      }
    });
  }
});
