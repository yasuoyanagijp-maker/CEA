/**
 * ゴールデンテスト対象の解析条件マトリクス。
 * generate-golden.mjs と golden.test.js で共有する。
 */
import { DEFAULT_HORIZON } from "../backend/constants.js";

const HORIZON = {
  timeHorizonYears: DEFAULT_HORIZON.timeHorizonYears,
  cycleLengthYears: DEFAULT_HORIZON.cycleLengthYears,
  discountRate: DEFAULT_HORIZON.discountRate,
};

const ALL_DRUGS = [
  "ranibizumab",
  "aflibercept",
  "aflibercept_8mg",
  "faricimab",
  "brolucizumab",
  "ranibizumab_bs",
  "aflibercept_bs",
];

export function buildGoldenCases() {
  const cases = [];

  // サブタイプ × 臨床ケース × コスト論文（rbz_bs vs aflibercept の2剤）
  for (const subtypeId of ["typical", "pcv", "rap"]) {
    for (const clinicalCase of ["base", "scenario", "2026_meta"]) {
      for (const costPaperId of ["paper1_faricimab", "paper2_rbz"]) {
        cases.push({
          id: `${subtypeId}__${clinicalCase}__${costPaperId}`,
          input: {
            selectedDrugIds: ["ranibizumab_bs", "aflibercept"],
            referenceDrugId: "aflibercept",
            subtypeId,
            costPaperId,
            clinicalCase,
            horizon: HORIZON,
          },
        });
      }
    }
  }

  // 全7薬剤（デフォルト条件） — 臨床キー代理・2026 meta 個別回数のカバー
  for (const clinicalCase of ["base", "2026_meta"]) {
    cases.push({
      id: `all_drugs__typical__${clinicalCase}__paper2`,
      input: {
        selectedDrugIds: ALL_DRUGS,
        referenceDrugId: "aflibercept",
        subtypeId: "typical",
        costPaperId: "paper2_rbz",
        clinicalCase,
        horizon: HORIZON,
      },
    });
  }

  // 治療期間 2年 / 生涯（BSC 切替パスのカバー）
  for (const duration of [2, null]) {
    cases.push({
      id: `duration_${duration ?? "lifetime"}__typical__base__paper2`,
      input: {
        selectedDrugIds: ["ranibizumab_bs", "aflibercept"],
        referenceDrugId: "aflibercept",
        subtypeId: "typical",
        costPaperId: "paper2_rbz",
        clinicalCase: "base",
        horizon: HORIZON,
        treatmentDurationYears: duration,
      },
    });
  }

  return cases;
}
