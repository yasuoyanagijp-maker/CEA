/**
 * ゴールデン値（現行実装の出力スナップショット）を再生成する。
 * リファクタリングで意図的に挙動を変えた場合のみ実行し、差分をレビューすること。
 *
 *   node tests/generate-golden.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runAnalysis } from "../backend/engine.js";
import { buildGoldenCases } from "./golden-cases.js";

const round = (v, digits) =>
  v == null ? null : Number(v.toFixed(digits));

const snapshot = {};
for (const { id, input } of buildGoldenCases()) {
  const analysis = runAnalysis(input);
  snapshot[id] = Object.fromEntries(
    Object.entries(analysis.results).map(([drugId, r]) => [
      drugId,
      {
        totalQALY: round(r.totalQALY, 6),
        totalCost: round(r.totalCost, 2),
        incomplete: r.incomplete ?? false,
        costBreakdown: r.costBreakdown
          ? Object.fromEntries(
              Object.entries(r.costBreakdown).map(([k, v]) => [k, round(v, 2)])
            )
          : null,
      },
    ])
  );
}

const outPath = join(dirname(fileURLToPath(import.meta.url)), "golden.json");
writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n");
console.log(`Wrote ${Object.keys(snapshot).length} cases to ${outPath}`);
