/**
 * Supplementary Table S7–S8 — Scenario case
 * 遷移確率 (S7–S8) と年間注射回数 (S8)。
 * ベースケース (table-s5-transitions.js / table-s6-injections.js) と同じ
 * 構造: subtypeId → clinicalKey → phase。
 */

import { tp } from "../utils.js";

export const TRANS_SCENARIO_TABLE_S7_S8 = {
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

export const INJ_SCENARIO_TABLE_S8 = {
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

export const TABLE_S7_S8_SOURCE = "Supplementary Table S7–S8 (scenario case)";
