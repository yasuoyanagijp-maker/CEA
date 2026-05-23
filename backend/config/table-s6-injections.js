/**
 * Supplementary Table S6 — Treatment frequency (base case, annual injections)
 * Yoneda et al. [1]; Jin et al. [2] (typical); Hoshino et al. [3] (RAP Y1/Y≥2)
 *
 * 単位: 年間注射回数（induction は最初の3か月あたりの表記値）
 */

const S6 = {
  typical: {
    rbz_bs: { induction: 3.0, year1: 2.2, year2: 2.0, year3plus: 1.6 },
    aflibercept: { induction: 3.0, year1: 2.2, year2: 1.9, year3plus: 1.3 },
  },
  pcv: {
    rbz_bs: { induction: 3.0, year1: 3.1, year2: 2.0, year3plus: 1.4 },
    aflibercept: { induction: 3.0, year1: 2.4, year2: 1.8, year3plus: 1.7 },
  },
  rap: {
    rbz_bs: { induction: 3.0, year1: 1.8, year2: 4.7, year3plus: 4.7 },
    aflibercept: { induction: 3.0, year1: 1.3, year2: 4.9, year3plus: 4.9 },
  },
};

function cloneSubtype(subtype) {
  const out = {};
  for (const [drug, phases] of Object.entries(subtype)) {
    out[drug] = { ...phases };
  }
  return out;
}

/** Markov 用 — Table S6 ベースケース（年次フェーズ別注射回数） */
export const INJ_BASE_TABLE_S6 = Object.fromEntries(
  Object.entries(S6).map(([id, drugs]) => [id, cloneSubtype(drugs)])
);

export const TABLE_S6_SOURCE = "Supplementary Table S6 (base case)";

export { S6 as TABLE_S6_RAW };
