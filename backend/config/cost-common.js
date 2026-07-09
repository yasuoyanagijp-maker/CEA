/**
 * コスト論文間で共通のコスト定数 — 一元管理。
 * 論文モジュール(papers/)はここを参照し、論文固有の差分
 * (投与手技料の扱い・社会的費用の有無)のみを各自で持つ。
 */

import { DEFAULT_TRANSPORT } from "./transport.js";

/**
 * 薬価: 公定薬価・注射用キット（2026-07 ユーザー確認）。瓶製品は採用しない。
 * 論文1・論文2 とも同一の公定薬価を使用。
 *
 * | 薬剤 | キット薬価（円） |
 * | アフリベルセプトBS「NIT」/ バイエルAG | 67,959 |
 * | ラニビズマブBS「センジュ」 | 72,136 |
 * | ルセンティスキット | 92,753 |
 * | アイリーア 2 mg キット | 99,522 |
 * | ベオビュキット | 103,163 |
 * | バビースモキット | 141,784 |
 * | アイリーア 8 mg キット | 145,718 |
 * （参考・未使用）アイリーア 8 mg 瓶 146,272
 */
export const DRUG_PRICES_JPY = {
  ranibizumab: 92_753, // ルセンティス注射用キット 0.5mg/0.05mL
  aflibercept: 99_522, // アイリーア 2mg キット（瓶製品は不使用）
  aflibercept_8mg: 145_718, // アイリーア 8mg キット（瓶 146,272 は不使用）
  faricimab: 141_784, // バビースモキット
  brolucizumab: 103_163, // ベオビュ注射用キット
  ranibizumab_bs: 72_136, // ラニビズマブBS「センジュ」
  aflibercept_bs: 67_959, // アフリベルセプトBSキット「NIT」/ バイエルAG 同額
};

/**
 * 注射・投与コスト。
 * 薬剤費は DRUG_PRICES_JPY を正とし、ここでは非薬剤の投与関連コストのみ扱う。
 */
export const ADMINISTRATION_COSTS_JPY = {
  paper1OutpatientAttendanceAndExam: 6_930,
  paper1InjectionAdministration: 5_800,
  paper1Faricimab: 6_930 + 5_800,
  paper2Rbz: 6_000,
};

/**
 * O&T 2024;13:2629-2644 Table S10 を、診療報酬の分解構造で表現。
 * - 診察料: 初診 2,910円 / 再診 760円
 * - 検査セット: D263 + D264 + D257 + D255 = 3,730円（毎回）
 * - 画像: OCT 1,900円（毎回） / OCTA 4,000円（3回に1回）
 * - 蛍光眼底法: 4,000円（初診のみ1回）
 */
export const MONITORING_STANDARD = {
  kind: "visitBundle",
  tae: {
    year1: { visits: 2.0 },
    year2plus: { visits: 1.5 },
  },
  bsc: {
    year1: { visits: 1.0 },
    year2plus: { visits: 1.0 },
  },
  unitCosts: {
    initialConsultation: 2_910,
    revisit: 760,
    examSet: 3_730,
    oct: 1_900,
    octa: 4_000,
    fa: 4_000,
  },
  octaEveryVisits: 3,
  initialFluorescenceAngiographyVisits: 1,
};

/**
 * JME 2025;28:448-459 Table S3.
 * 補足表は monitoring visit の単価のみを提示するため、訪問頻度は既存モデルの
 * TAE/BSC 年間 visit count（physician 列）に合わせる。
 */
export const MONITORING_JME_2025 = {
  tae: {
    year1: { physician: 2.0, oct: 0, slit: 0, fa: 0 },
    year2plus: { physician: 1.5, oct: 0, slit: 0, fa: 0 },
  },
  bsc: {
    year1: { physician: 1.0, oct: 0, slit: 0, fa: 0 },
    year2plus: { physician: 1.0, oct: 0, slit: 0, fa: 0 },
  },
  unitCosts: { physician: 5_930, oct: 0, slit: 0, fa: 0 },
};

/** JME 2025;28:448-459 Table S6 — nAMD adverse events. */
export const ADVERSE_EVENTS_JME_2025_NAMD = [
  { id: "cataract", rate: 0.00024, unitCost: 229_460 },
  { id: "endophthalmitis", rate: 0.00018, unitCost: 345_006 },
  { id: "rhegmatogenousRD", rate: 0.00006, unitCost: 304_330 },
  { id: "stroke", rate: 0.00012, unitCost: 1_440_107 },
  { id: "tractionalRD", rate: 0.00006, unitCost: 234_084 },
  {
    id: "retinalArteryOcclusion",
    rate: 0.00072,
    unitCost: 32_570,
    scenarioOnly: true,
  },
];

/** O&T 2024;13:2629-2644 Supplementary Table S9 — nAMD adverse events. */
export const ADVERSE_EVENTS_OT_2024_NAMD = [
  { id: "cataract", rate: 0.00024, unitCost: 178_400 },
  { id: "endophthalmitis", rate: 0.00018, unitCost: 297_200 },
  { id: "rhegmatogenousRD", rate: 0.00006, unitCost: 389_500 },
  {
    id: "retinalArteryOcclusion",
    rate: 0.00072,
    unitCost: 8_820,
    scenarioOnly: true,
  },
];

/**
 * 統合 default 用 AE。
 * 重複する O&T/JME 項目は単純平均、O&T にない項目は JME 値を保持する。
 */
export const ADVERSE_EVENTS_INTEGRATED_NAMD = [
  { id: "cataract", rate: 0.00024, unitCost: Math.round((229_460 + 178_400) / 2) },
  { id: "endophthalmitis", rate: 0.00018, unitCost: Math.round((345_006 + 297_200) / 2) },
  { id: "rhegmatogenousRD", rate: 0.00006, unitCost: Math.round((304_330 + 389_500) / 2) },
  { id: "stroke", rate: 0.00012, unitCost: 1_440_107 },
  { id: "tractionalRD", rate: 0.00006, unitCost: 234_084 },
  {
    id: "retinalArteryOcclusion",
    rate: 0.00072,
    unitCost: 8_820,
    scenarioOnly: true,
  },
];

/** JME 2025;28:448-459 Tables S8-S9 — societal costs for nAMD/DME. */
export const SOCIETAL_JME_2025 = {
  kind: "jme2025",
  averageWagePerCycle: 311_800,
  productivityWithoutVisualImpairment: 1,
  productivityWithVisualImpairment: 0.37,
  productivityBlindness: 0.37,
  treatmentProductivityImpairmentDays: 2,
  informalCarePerCycle: {
    noVisualImpairment: 0,
    visualImpairment: 143_581.9,
    blind: 145_465.8,
  },
  informalCareOnTreatmentDay: 11_136,
  informalCareOnMonitoringVisit: 11_136,
  transport: DEFAULT_TRANSPORT,
};

export { DEFAULT_TRANSPORT };
