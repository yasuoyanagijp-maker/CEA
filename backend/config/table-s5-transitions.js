/**
 * Supplementary Table S5 — Transition probabilities (base case)
 * Yoneda et al. [1]; Jin et al. [2] (typical Y1/Y≥2); Hoshino [3], Kertes [4] (RAP)
 *
 * 行順: Improving 2 HS, Improving 1 HS, Remaining, Worsening 1 HS, Worsening 2 HS
 * → tp(imp2, imp1, remain, wors1, wors2)
 */

import { tp } from "../utils.js";

/** @param {number[]} p — [imp2, imp1, remain, wors1, wors2] を % で指定 */
function t(p) {
  return tp(p[0], p[1], p[2], p[3], p[4]);
}

const S5 = {
  typical: {
    rbz_bs: {
      induction: [16.7, 16.0, 39.4, 13.5, 14.4],
      year1: [15.0, 15.2, 39.6, 15.0, 15.2],
      year2: [5.0, 10.4, 43.6, 21.3, 19.7],
      year3plus: [8.9, 15.0, 47.6, 17.1, 11.4],
    },
    aflibercept: {
      induction: [22.2, 16.1, 35.6, 13.4, 12.7],
      year1: [17.4, 14.5, 36.2, 17.4, 14.5],
      year2: [6.8, 13.4, 48.3, 18.8, 12.7],
      year3plus: [9.0, 14.4, 46.1, 17.5, 13.0],
    },
  },
  pcv: {
    rbz_bs: {
      induction: [18.4, 18.0, 41.0, 9.6, 13.0],
      year1: [13.5, 15.6, 41.8, 13.5, 15.6],
      year2: [3.7, 15.8, 64.5, 13.3, 2.7],
      year3plus: [2.2, 11.8, 64.3, 17.4, 4.3],
    },
    aflibercept: {
      induction: [26.5, 15.9, 32.9, 13.1, 11.6],
      year1: [19.1, 14.0, 33.8, 19.1, 14.0],
      year2: [3.9, 12.3, 55.4, 19.5, 8.9],
      year3plus: [11.0, 14.6, 43.0, 16.8, 14.6],
    },
  },
  rap: {
    rbz_bs: {
      induction: [17.8, 16.6, 39.6, 12.2, 13.8],
      year1: [14.8, 15.3, 39.8, 14.8, 15.3],
      year2: [22.3, 19.6, 40.0, 11.0, 7.1],
      year3plus: [12.4, 15.1, 42.3, 16.1, 14.1],
    },
    aflibercept: {
      induction: [21.2, 14.9, 34.2, 16.4, 13.3],
      year1: [18.7, 14.1, 34.4, 18.7, 14.1],
      year2: [16.8, 19.1, 44.2, 12.5, 7.4],
      year3plus: [10.6, 15.3, 45.3, 16.5, 12.3],
    },
  },
};

function compileDrugPhases(drugPhases) {
  const out = {};
  for (const [phase, pcts] of Object.entries(drugPhases)) {
    out[phase] = t(pcts);
  }
  return out;
}

function compileSubtype(subtype) {
  const out = {};
  for (const [drug, phases] of Object.entries(subtype)) {
    out[drug] = compileDrugPhases(phases);
  }
  return out;
}

/** Markov 用 — Table S5 ベースケース遷移（% は表どおり、適用時に正規化） */
export const TRANS_BASE_TABLE_S5 = Object.fromEntries(
  Object.entries(S5).map(([subtypeId, drugs]) => [subtypeId, compileSubtype(drugs)])
);

export const TABLE_S5_SOURCE = "Supplementary Table S5 (base case)";

export { S5 as TABLE_S5_RAW_PERCENT };
