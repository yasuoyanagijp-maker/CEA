import { deriveBscTransitionProbs, tp } from "./utils.js";
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
  getInjections2026MetaForDrug,
  INJECTIONS_2026_META_SOURCE,
} from "./config/injections-2026-meta.js";

/** BSC 自然経過 — Table S5 に BSC 列がないため rbz_bs 治療遷移から導出（論文1 簡略モデルと同趣旨） */
export const BSC_PROGRESSION_MULTIPLIER = 1.35;

const BSC_REFERENCE_KEY = "rbz_bs";

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

/** ベースケース遷移 — Supplementary Table S5 */
export const TRANS_BASE = TRANS_BASE_TABLE_S5;

export { TABLE_S5_SOURCE };

export const TRANS_SCENARIO = {
  typical: {
    rbz_bs: {
      induction: tp(11.5, 23.1, 54.2, 2.2, 9.1),
      year1: tp(2.5, 10.1, 55.8, 9.9, 21.8),
      year2: tp(5.0, 10.4, 43.7, 19.7, 21.3),
      year3plus: tp(8.1, 14.2, 47.6, 12.4, 17.9),
    },
    aflibercept: {
      induction: tp(10.7, 20.3, 53.0, 4.1, 11.9),
      year1: tp(6.7, 12.1, 44.6, 17.1, 19.7),
      year2: tp(6.7, 13.4, 48.2, 12.8, 18.8),
      year3plus: tp(8.5, 14.0, 46.2, 13.6, 17.9),
    },
  },
  pcv: {
    rbz_bs: {
      induction: tp(6.4, 33.3, 59.0, 0.0, 1.2),
      year1: tp(2.3, 13.7, 68.3, 2.2, 13.5),
      year2: tp(2.7, 13.3, 64.5, 3.7, 15.8),
      year3plus: tp(1.6, 9.6, 64.3, 5.7, 20.2),
    },
    aflibercept: {
      induction: tp(13.9, 30.0, 51.7, 0.4, 4.0),
      year1: tp(7.4, 13.3, 46.2, 14.2, 18.8),
      year2: tp(4.9, 14.1, 56.0, 7.3, 17.7),
      year3plus: tp(10.3, 14.1, 43.0, 15.5, 17.3),
    },
  },
  rap: {
    rbz_bs: {
      induction: tp(14.9, 20.4, 47.6, 5.3, 11.8),
      year1: tp(10.2, 18.4, 51.5, 6.1, 13.8),
      year2: tp(8.9, 16.1, 50.0, 8.9, 16.1),
      year3plus: tp(8.2, 15.4, 49.8, 9.7, 16.9),
    },
    aflibercept: {
      induction: tp(11.3, 21.2, 53.0, 3.5, 11.0),
      year1: tp(7.6, 16.1, 52.6, 7.6, 16.1),
      year2: tp(5.5, 15.7, 57.6, 5.5, 15.7),
      year3plus: tp(4.9, 14.7, 57.4, 6.2, 16.8),
    },
  },
};

/** ベースケース注射回数 — Supplementary Table S6 */
export const INJ_BASE = INJ_BASE_TABLE_S6;

export { TABLE_S6_SOURCE };

export const INJ_SCENARIO = {
  typical: {
    rbz_bs: { induction: 3.0, year1: 1.2, year2: 2.0, year3plus: 1.6 },
    aflibercept: { induction: 3.0, year1: 1.5, year2: 1.9, year3plus: 1.3 },
  },
  pcv: {
    rbz_bs: { induction: 3.0, year1: 1.1, year2: 2.0, year3plus: 1.4 },
    aflibercept: { induction: 3.0, year1: 1.5, year2: 1.8, year3plus: 1.7 },
  },
  rap: {
    rbz_bs: { induction: 3.0, year1: 4.2, year2: 4.7, year3plus: 4.7 },
    aflibercept: { induction: 3.0, year1: 4.7, year2: 4.9, year3plus: 4.9 },
  },
};

export function getClinicalTables(clinicalCase) {
  if (clinicalCase === "scenario") {
    return { transitions: TRANS_SCENARIO, injections: INJ_SCENARIO };
  }
  if (clinicalCase === "2026_meta") {
    return { transitions: TRANS_BASE, injections: null };
  }
  return { transitions: TRANS_BASE, injections: INJ_BASE };
}

export { INJECTIONS_2026_META_SOURCE };

/**
 * フェーズあたり年間注射回数
 * @param {'base'|'scenario'|'2026_meta'} clinicalCase
 */
export function getInjectionRate(
  clinicalCase,
  injections,
  subtypeId,
  drugId,
  clinicalKey,
  phase
) {
  if (clinicalCase === "2026_meta") {
    const schedule = getInjections2026MetaForDrug(drugId);
    if (!schedule) return 0;
    return schedule[phase] ?? 0;
  }
  return injections?.[subtypeId]?.[clinicalKey]?.[phase] ?? 0;
}

/**
 * 治療中止後の BSC 遷移（サブタイプ×フェーズ）
 * @param {object} transitions — TRANS_BASE または TRANS_SCENARIO
 * @param {string} subtypeId
 * @param {string} phase
 */
export function getBscTransitionProbs(transitions, subtypeId, phase) {
  const treated = transitions[subtypeId]?.[BSC_REFERENCE_KEY]?.[phase];
  if (!treated) return null;
  return deriveBscTransitionProbs(treated, BSC_PROGRESSION_MULTIPLIER);
}
