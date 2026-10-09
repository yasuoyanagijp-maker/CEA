import { phaseForCycle, isOnTreatment } from "./utils.js";
import { buildSubtypeBaseline } from "./config/baseline-characteristics.js";
import {
  TRANS_BASE_TABLE_S5,
  TABLE_S5_SOURCE,
} from "./config/table-s5-transitions.js";
import {
  INJ_BASE_TABLE_S6,
  TABLE_S6_SOURCE,
} from "./config/table-s6-injections.js";
import {
  TRANS_SCENARIO_TABLE_S7_S8,
  INJ_SCENARIO_TABLE_S8,
  TABLE_S7_S8_SOURCE,
} from "./config/table-s7-s8-scenario.js";
import {
  getInjections2026MetaForDrug,
  INJECTIONS_2026_META_SOURCE,
  scheduleInjectionsForCycle,
  scheduleInjectionsForMonth,
} from "./config/injections-2026-meta.js";
import {
  CLINICAL_CASE_LIT_2025,
  INJECTIONS_LIT_2025_SOURCE,
  getInjectionsLit2025ForDrug,
} from "./config/injections-lit-2025.js";
import { getPaperBscTransitions, TABLE_S2_BSC_SOURCE } from "./config/table-s2-bsc-transitions.js";
import { annualInjectionsFromIntervalWeeks } from "./config/treatment-intervals.js";
import {
  buildInjectionsByDrugSubtype,
  getTransitionKey,
  isAfl2mgDerivedInjection,
  AFL2MG_DERIVED_INJECTION_FACTOR,
  AFL2MG_DERIVED_INJECTION_NOTE,
} from "./config/drug-clinical-profile.js";
import { getDrug } from "./drugs.js";
import { DEFAULT_HORIZON } from "./constants.js";
import {
  DEFAULT_TRANSITION_MODE,
  TRANSITION_MODE_OPTIONS,
  TRANSITION_POOL_SOURCE,
  isPooledTransitionMode,
  overlayPooledTransitions,
  TRANS_POOLED_TABLE,
} from "./config/transition-pool.js";
import {
  EXPERT_ESTIMATE_LABEL,
  getInjectionEstimateFlags,
  isExpertEstimateCalendarYear,
} from "./config/injection-estimates.js";

/** ベースライン — Yoneda [1] + Table S2 初期分布；遷移・注射は Table S5–S8 */
export const SUBTYPES = {
  typical: {
    label: "典型 nAMD",
    ...buildSubtypeBaseline("typical"),
    referenceS12: {
      rbz_bs: { qaly: 7.543, cost: 23_581_934 },
      aflibercept: { qaly: 7.534, cost: 24_115_743 },
    },
  },
  pcv: {
    label: "PCV",
    ...buildSubtypeBaseline("pcv"),
    referenceS12: {
      rbz_bs: { qaly: 8.203, cost: 22_828_047 },
      aflibercept: { qaly: 8.141, cost: 24_629_713 },
    },
  },
  rap: {
    label: "RAP",
    ...buildSubtypeBaseline("rap"),
    referenceS12: {
      rbz_bs: { qaly: 5.05, cost: 23_605_224 },
      aflibercept: { qaly: 5.036, cost: 25_493_773 },
    },
  },
};

export const TRANS_BASE = TRANS_BASE_TABLE_S5;
export const TRANS_SCENARIO = TRANS_SCENARIO_TABLE_S7_S8;

/**
 * サマリー・スイッチタブ用 注射回数 — clinicalKey（rbz_bs / aflibercept）で集約（Table S6）。
 * 個別患者タブは薬剤別（AFL 8mg/ファリ/ブロルを AFL 2mg から導出）の INJ_*_PERDRUG を使う。
 */
export const INJ_BASE = INJ_BASE_TABLE_S6;
export const INJ_SCENARIO = INJ_SCENARIO_TABLE_S8;

/** 個別患者タブ用 注射回数 — 病型 × 薬剤ID（AFL 8mg/ファリ/ブロルは AFL 2mg 由来） */
export const INJ_BASE_PERDRUG = buildInjectionsByDrugSubtype("base");
export const INJ_SCENARIO_PERDRUG = buildInjectionsByDrugSubtype("scenario");

export {
  TABLE_S5_SOURCE,
  TABLE_S6_SOURCE,
  TABLE_S7_S8_SOURCE,
  INJECTIONS_2026_META_SOURCE,
  TABLE_S2_BSC_SOURCE,
  DEFAULT_TRANSITION_MODE,
  TRANSITION_MODE_OPTIONS,
  TRANSITION_POOL_SOURCE,
  EXPERT_ESTIMATE_LABEL,
  INJECTIONS_LIT_2025_SOURCE,
  CLINICAL_CASE_LIT_2025,
};

/**
 * 臨床データセット — 遷移・注射回数の4系統（base / scenario / 2026_meta / lit_2025_2026）を
 * 同一インターフェースで提供する。呼び出し側（markov.js）は clinicalCase の
 * 分岐を持たず、datasets のメソッドのみを使う。
 *
 * @typedef {object} ClinicalDataset
 * @property {string} id
 * @property {string} label — UI 表示名
 * @property {string} hint — UI 補足（出典）
 * @property {(subtypeId: string, clinicalKey: string) => boolean} hasTransitions
 * @property {(subtypeId: string, clinicalKey: string, phase: string) => object|null} getTransitions
 * @property {(subtypeId: string, phase: string) => object|null} getBscTransitions
 * @property {(q: {subtypeId: string, drugId: string, clinicalKey: string, phase: string}) => number} getAnnualInjections
 * @property {(drugId: string, subtypeId: string, clinicalKey: string) => boolean} hasInjections
 */

/** @returns {ClinicalDataset} */
function makeTableDataset({ id, label, hint, transitions, injections }) {
  return {
    id,
    label,
    hint,
    hasTransitions: (subtypeId, clinicalKey) =>
      transitions[subtypeId]?.[clinicalKey] != null,
    getTransitions: (subtypeId, clinicalKey, phase) =>
      transitions[subtypeId]?.[clinicalKey]?.[phase] ?? null,
    getBscTransitions: (_subtypeId, phase) => getPaperBscTransitions(phase),
    getAnnualInjections: ({ subtypeId, clinicalKey, phase }) =>
      injections[subtypeId]?.[clinicalKey]?.[phase] ?? 0,
    hasInjections: (drugId, subtypeId, clinicalKey) =>
      injections[subtypeId]?.[clinicalKey] != null,
  };
}

const BASE_DATASET = makeTableDataset({
  id: "base",
  label: "ベースケース（Table S5 遷移・S6 注射）",
  hint: "遷移: Table S5 / 注射: Table S6",
  transitions: TRANS_BASE,
  injections: INJ_BASE,
});

const SCENARIO_DATASET = makeTableDataset({
  id: "scenario",
  label: "シナリオ（Table S7–S8）",
  hint: "遷移: Table S7–S8 / 注射: Table S8",
  transitions: TRANS_SCENARIO,
  injections: INJ_SCENARIO,
});

/** 2026 meta — 遷移は Table S5、注射回数のみ薬剤別メタ解析値 */
const META_2026_DATASET = {
  ...makeTableDataset({
    id: "2026_meta",
    label: "2026 meta（注射回数のみ更新）",
    hint: "遷移: Table S5 / 注射: 2026 meta（1年目＝導入期を含む総数。主に Wojciechowski 2025 の範囲中点。2年目以降は専門家による推計）",
    transitions: TRANS_BASE,
    injections: {},
  }),
  getAnnualInjections: ({ drugId, phase }) =>
    getInjections2026MetaForDrug(drugId)?.[phase] ?? 0,
  hasInjections: (drugId) => getInjections2026MetaForDrug(drugId) != null,
  missingInjectionsWarning: (drugName) =>
    `${drugName}: 2026 meta 注射回数が未設定`,
};

const LIT_2025_DATASET = {
  ...makeTableDataset({
    id: CLINICAL_CASE_LIT_2025,
    label: "感度分析（2025–2026 確認文献の注射回数）",
    hint: "遷移: Table S5 / 注射: PULSAR日本・Okawa・Matsumoto/Inoda 等の確認値。無いセルは 2026 meta 既存値（専門家による推計）",
    transitions: TRANS_BASE,
    injections: {},
  }),
  getAnnualInjections: ({ drugId, phase }) =>
    getInjectionsLit2025ForDrug(drugId)?.[phase] ?? 0,
  hasInjections: (drugId) => getInjectionsLit2025ForDrug(drugId) != null,
  missingInjectionsWarning: (drugName) =>
    `${drugName}: 感度分析注射回数が未設定`,
};

export const CLINICAL_DATASETS = {
  base: BASE_DATASET,
  scenario: SCENARIO_DATASET,
  "2026_meta": META_2026_DATASET,
  [CLINICAL_CASE_LIT_2025]: LIT_2025_DATASET,
};

export function usesYear1InclusiveSchedule(clinicalCase) {
  return clinicalCase === "2026_meta" || clinicalCase === CLINICAL_CASE_LIT_2025;
}

export function getInjectionScheduleForCase(clinicalCase, drugId) {
  if (clinicalCase === CLINICAL_CASE_LIT_2025) {
    return getInjectionsLit2025ForDrug(drugId);
  }
  if (clinicalCase === "2026_meta") {
    return getInjections2026MetaForDrug(drugId);
  }
  return null;
}

export const CLINICAL_CASE_OPTIONS = Object.values(CLINICAL_DATASETS).map(
  ({ id, label, hint }) => ({ id, label, hint })
);

/** @returns {ClinicalDataset} */
export function getClinicalDataset(
  clinicalCase,
  transitionMode = DEFAULT_TRANSITION_MODE
) {
  const base = CLINICAL_DATASETS[clinicalCase] ?? BASE_DATASET;
  if (!isPooledTransitionMode(transitionMode)) return base;
  return {
    ...base,
    getTransitions: (subtypeId, _clinicalKey, phase) =>
      TRANS_POOLED_TABLE[subtypeId]?.pooled?.[phase] ?? null,
    hasTransitions: (subtypeId) => TRANS_POOLED_TABLE[subtypeId]?.pooled != null,
  };
}

/**
 * 選択間隔を反映した年間注射回数 — Markov とスイッチタブで共通
 * 間隔指定あり: 52 ÷ 間隔（週）— 薬剤共通
 * 間隔指定なし: 臨床データセット（Table S6 / 2026 meta）の文献値
 */
export function getEffectiveAnnualInjectionRate({
  clinicalCase,
  subtypeId,
  drugId,
  intervalWeeks = null,
  phase = "year1",
}) {
  if (intervalWeeks != null && intervalWeeks > 0) {
    return annualInjectionsFromIntervalWeeks(intervalWeeks);
  }
  const drug = getDrug(drugId);
  if (!drug) return null;
  const dataset = getClinicalDataset(clinicalCase);
  return dataset.getAnnualInjections({
    subtypeId,
    drugId,
    // INJ_BASE/INJ_SCENARIO は S6 列（rbz_bs / aflibercept）で集約 → transitionKey で参照
    clinicalKey: drug.transitionKey ?? drug.clinicalKey,
    phase,
  });
}

/**
 * 個別患者タブ用 — 遷移（clinicalKey 別）と注射（薬剤ID 別）を返す。
 * サマリー/スイッチが使う getClinicalDataset とは別に、薬剤別注射モデル
 * （AFL 8mg/ファリ/ブロル = AFL 2mg 由来）を保持する。
 * @param {'base'|'scenario'|'2026_meta'|'lit_2025_2026'} clinicalCase
 * @param {string} [transitionMode]
 */
export function getClinicalTables(
  clinicalCase,
  transitionMode = DEFAULT_TRANSITION_MODE
) {
  let tables;
  if (clinicalCase === "scenario") {
    tables = { transitions: TRANS_SCENARIO, injections: INJ_SCENARIO_PERDRUG };
  } else if (usesYear1InclusiveSchedule(clinicalCase)) {
    tables = { transitions: TRANS_BASE, injections: null };
  } else {
    tables = { transitions: TRANS_BASE, injections: INJ_BASE_PERDRUG };
  }
  if (isPooledTransitionMode(transitionMode)) {
    return {
      ...tables,
      transitions: overlayPooledTransitions(tables.transitions),
    };
  }
  return tables;
}

/**
 * フェーズあたり年間注射回数（薬剤ID 別）
 * @param {'base'|'scenario'|'2026_meta'|'lit_2025_2026'} clinicalCase
 */
export function getInjectionRate(
  clinicalCase,
  injections,
  subtypeId,
  drugId,
  phase
) {
  if (usesYear1InclusiveSchedule(clinicalCase)) {
    const schedule = getInjectionScheduleForCase(clinicalCase, drugId);
    if (!schedule) return 0;
    return schedule[phase] ?? 0;
  }
  return injections?.[subtypeId]?.[drugId]?.[phase] ?? 0;
}

/**
 * Table S6 のフェーズ別注射パラメータ（参照表示用）
 * @returns {{ source: string, phases: Record<string, number>|null, clinicalKey: string }}
 */
export function getInjectionPhaseReference(
  clinicalCase,
  subtypeId,
  drugId,
  drugCatalog
) {
  const drug = drugCatalog?.[drugId] ?? { clinicalKey: drugId };
  const clinicalKey = drug.clinicalKey ?? drugId;
  const transitionKey = drug.transitionKey ?? getTransitionKey(drugId);
  const { injections } = getClinicalTables(clinicalCase);

  const estimateFlags = getInjectionEstimateFlags(clinicalCase, drugId);

  if (usesYear1InclusiveSchedule(clinicalCase)) {
    const schedule = getInjectionScheduleForCase(clinicalCase, drugId);
    const isLit = clinicalCase === CLINICAL_CASE_LIT_2025;
    return {
      source: isLit ? INJECTIONS_LIT_2025_SOURCE : INJECTIONS_2026_META_SOURCE,
      clinicalKey,
      transitionKey,
      phases: schedule,
      estimateFlags,
      note: isLit
        ? `year1 は導入期を含む12か月合計。確認文献がある薬剤だけ差し替え。無いセルと year2以降は 2026 meta 既存値${EXPERT_ESTIMATE_LABEL}`
        : `year1 は導入期を含む12か月合計（最初の12か月＝year1。導入3回を上乗せしない）。year2以降は原則 year1−3（AFL 8 mgはQ16維持相当）${EXPERT_ESTIMATE_LABEL}。ラニビズマブ year1 9.88 は Table 2 の Q4/Q8 中点`,
    };
  }

  const phases = injections?.[subtypeId]?.[drugId] ?? null;
  const isReference = isAfl2mgDerivedInjection(drugId);
  return {
    source: clinicalCase === "scenario" ? "Supplementary Table S8 (scenario)" : TABLE_S6_SOURCE,
    clinicalKey,
    transitionKey,
    phases,
    estimateFlags,
    isInjectionReference: isReference,
    injectionReferenceFactor: isReference ? AFL2MG_DERIVED_INJECTION_FACTOR : null,
    injectionReferenceNote: isReference ? AFL2MG_DERIVED_INJECTION_NOTE : null,
    note: isReference
      ? `${EXPERT_ESTIMATE_LABEL} — induction は薬剤別（AFL 8 mg=3, ファリ=4, ブロル=2）。year1以降は同一病型 AFL 2 mg × ${AFL2MG_DERIVED_INJECTION_FACTOR}`
      : "induction=最初3か月の回数、year1/year2/year3plus=年間回数（病型×薬剤別）",
  };
}

/**
 * カレンダー年ごとの期待注射回数（決定論的集計）
 * - ベース/シナリオ: induction は0–2か月に3等分、その他は年率×月/12
 * - 2026 meta: 最初の12か月合計＝year1（導入期を二重計上しない）
 */
export function buildInjectionYearReference({
  subtypeId,
  drugId,
  clinicalCase = "base",
  timeHorizonYears = DEFAULT_HORIZON.timeHorizonYears,
  treatmentDurationYears = null,
  drugCatalog,
}) {
  const { injections } = getClinicalTables(clinicalCase);
  const ref = getInjectionPhaseReference(clinicalCase, subtypeId, drugId, drugCatalog);
  const maxMonths = Math.round(timeHorizonYears * 12);
  const rows = [];
  let lifetime = 0;

  for (let year = 0; year < timeHorizonYears; year++) {
    let expected = 0;
    for (let month = year * 12; month < Math.min((year + 1) * 12, maxMonths); month++) {
      expected += injectionsForMonth(month, {
        clinicalCase,
        injections,
        subtypeId,
        drugId,
        treatmentDurationYears,
      });
    }
    expected = Math.round(expected * 1000) / 1000;
    lifetime += expected;
    rows.push({
      year,
      expected,
      expertEstimate: isExpertEstimateCalendarYear({
        clinicalCase,
        drugId,
        calendarYear: year,
      }),
    });
  }

  return {
    ...ref,
    rows,
    lifetime: Math.round(lifetime * 1000) / 1000,
  };
}

/** 月次の注射回数（Table S6 意味論・決定論的） */
export function injectionsForMonth(monthIndex, context) {
  const { clinicalCase, injections, subtypeId, drugId, treatmentDurationYears } = context;

  if (!isOnTreatment(Math.floor(monthIndex / 3), 0.25, treatmentDurationYears)) {
    return 0;
  }

  if (usesYear1InclusiveSchedule(clinicalCase)) {
    return scheduleInjectionsForMonth(
      getInjectionScheduleForCase(clinicalCase, drugId),
      monthIndex
    );
  }

  const phase = phaseForCycle(Math.floor(monthIndex / 3), 0.25);
  const rate = getInjectionRate(clinicalCase, injections, subtypeId, drugId, phase);

  if (phase === "induction" && monthIndex < 3) {
    return rate / 3;
  }
  if (phase === "induction") {
    return 0;
  }
  return rate / 12;
}

/**
 * Markov サイクル（四半期）あたりの注射回数
 * - induction: 最初の1サイクル（3か月）に phase 値を一括（年率×cycleLen ではない）
 * - その他: 年間回数 × cycleLengthYears
 */
export function injectionsForCycle(cycleIndex, context) {
  const {
    clinicalCase,
    injections,
    subtypeId,
    drugId,
    treatmentDurationYears,
    cycleLengthYears = 0.25,
  } = context;

  if (!isOnTreatment(cycleIndex, cycleLengthYears, treatmentDurationYears)) {
    return 0;
  }

  if (usesYear1InclusiveSchedule(clinicalCase)) {
    return scheduleInjectionsForCycle(
      getInjectionScheduleForCase(clinicalCase, drugId),
      cycleIndex,
      cycleLengthYears
    );
  }

  const phase = phaseForCycle(cycleIndex, cycleLengthYears);
  const rate = getInjectionRate(clinicalCase, injections, subtypeId, drugId, phase);

  if (phase === "induction") {
    return rate;
  }
  return rate * cycleLengthYears;
}

/**
 * 治療中止後の BSC 遷移 — O&T 2023 ESM Table S2（Wong 2008）。病型・治療列には依存しない。
 * @param {object} [_transitions] — 後方互換（未使用）
 * @param {string} [_subtypeId] — 後方互換（未使用）
 */
export function getBscTransitionProbs(_transitions, _subtypeId, phase) {
  return getPaperBscTransitions(phase);
}
