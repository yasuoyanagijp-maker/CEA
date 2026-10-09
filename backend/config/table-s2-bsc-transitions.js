/**
 * BSC / off-treatment 遷移 — Yanagi et al., Ophthalmol Ther 2023 ESM Table S2
 * （Wong et al. 2008 の自然経過。O&T 2024 本文も中止後は同一の BSC 経過と明記）
 *
 * 論文 Table S2 BSC 列（%）:
 *   Induction          改善1 0.00 / 改善2 0.00 / 悪化1 14.10 / 悪化2 10.10
 *   Year 1 (Months 4–12) 改善1 0.00 / 改善2 0.00 / 悪化1 12.90 / 悪化2 18.20
 *   Year 2 / ≥Year 3   改善1 0.00 / 改善2 0.00 / 悪化1 27.00 / 悪化2 28.30
 *
 * 論文の表はサイクル単位か年単位かを書いていない。Table S5 の治療中遷移と
 * 同じ「フェーズ別・行合計 100%」の形式なので、本ツールは治療中遷移と同様に
 * **3か月サイクルあたりの確率としてそのまま適用**する（年率→サイクル換算はしない）。
 * Remaining = 100% − (悪化1 + 悪化2)。改善は 0%（論文: BSC は stable or worsen）。
 *
 * 以前の実装（治療中 rbz_bs 列に ×1.35 / ×0.25 を掛ける）は両論文に記載がなく廃止した。
 */

import { tp } from "../utils.js";

export const TABLE_S2_BSC_SOURCE =
  "Table S2 BSC 列（Yanagi, Ophthalmol Ther, 2023；Wong, Ophthalmology, 2008）。3か月サイクルあたりで適用（論文はサイクル単位か年単位かを明記せず）";

/** フェーズ → 正規化済み遷移（改善 0%） */
export const BSC_TRANSITIONS_TABLE_S2 = {
  induction: tp(0, 0, 75.8, 14.1, 10.1),
  year1: tp(0, 0, 68.9, 12.9, 18.2),
  year2: tp(0, 0, 44.7, 27.0, 28.3),
  year3plus: tp(0, 0, 44.7, 27.0, 28.3),
};

/** @param {string} phase */
export function getPaperBscTransitions(phase) {
  return BSC_TRANSITIONS_TABLE_S2[phase] ?? BSC_TRANSITIONS_TABLE_S2.year3plus;
}
