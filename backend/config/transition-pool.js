/**
 * 病型別・期間別の RBZ + AFL 遷移統合（症例数加重）。
 *
 * ルール（柳 2026-10-09）:
 *   - 典型 / PCV / RAP をまたいでまとめない
 *   - 各病型 × 各期間で S5 の rbz_bs 列と aflibercept 列を症例数加重平均
 *   - その病型の統合値を全薬剤に適用
 *
 * 重みは S5 脚注の元研究 n。薬剤×病型の正確な n が取れない期間は方法を明記。
 */

import { tp } from "../utils.js";
import { TABLE_S5_RAW_PERCENT } from "./table-s5-transitions.js";

export const DEFAULT_TRANSITION_MODE = "drug_specific";
export const TRANSITION_MODE_POOLED = "rbz_afl_pooled";

export const TRANSITION_MODE_OPTIONS = [
  {
    id: DEFAULT_TRANSITION_MODE,
    label: "薬剤別（S5: ラニビズマブ列 / アフリベルセプト列）",
    hint: "ラニビズマブ系は S5 rbz_bs 列、アフリベルセプト系・ファリ・ブロルは S5 aflibercept 列。",
  },
  {
    id: TRANSITION_MODE_POOLED,
    label: "共通（病型別・RBZ+AFL 症例数加重統合）",
    hint: "各病型・各期間で S5 の RBZ 列と AFL 列を元研究の症例数で加重平均し、その病型の統合値を全薬剤に適用（病型横断はしない）。",
  },
];

export const TRANSITION_POOL_KEY = "pooled";

/**
 * 期間ごとの重み。n は「その期間の遷移を作った研究」の治療群人数。
 *
 * Yoneda 2023 (J-CREST, PMID 37295608): 500 例（typical 268 / PCV 200 / RAP 32）。
 *   AFL:RBZ ≈ 7:3、病型で選択比は差なし → 病型合計 × 0.3 / 0.7。
 * Jin 2021 (Bundang, PMID 34272450): 215 眼（RBZ 131 / AFL 84）。PCV 104、typical 111
 *   （typical = nAMD other than PCV）。薬剤×病型の内訳は本文表が画像のため未取得。
 *   「subgroup は well-balanced」とあるので、全体比 131:84 を病型合計に按分。
 * Hoshino 2020 (日眼会誌 124:628): RAP Y2。公開抄録から薬剤別 n を確認できず → 1:1。
 * Kertes 2021 (CANTREAT 延長): RAP Y≥3。RBZ T&E のみで AFL 群なし → 1:1
 *   （S5 の 2 列は同一研究からモデル化した値なので等重み）。
 * induction: 脚注 d は Yanagi 前研究の mean BCVA 仮定。薬剤別 n なし。
 *   導入期の対象集団は Y1 と同じ J-CREST とみなし Yoneda 7:3 を使う。
 */
export const TRANSITION_POOL_WEIGHTS = {
  typical: {
    induction: {
      rbz: 80,
      afl: 188,
      source: "Yoneda 2023 J-CREST typical 268 × 3:7（選択比は病型で差なし）",
    },
    year1: {
      rbz: 80,
      afl: 188,
      source: "Yoneda 2023 J-CREST typical 268 × 3:7",
    },
    year2: {
      rbz: 68,
      afl: 43,
      source: "Jin 2021 typical 111 眼 × 全体比 131:84",
    },
    year3plus: {
      rbz: 68,
      afl: 43,
      source: "Jin 2021 typical 111 眼 × 全体比 131:84（3・4年 mean/SD 平均）",
    },
  },
  pcv: {
    induction: {
      rbz: 60,
      afl: 140,
      source: "Yoneda 2023 J-CREST PCV 200 × 3:7",
    },
    year1: {
      rbz: 60,
      afl: 140,
      source: "Yoneda 2023 J-CREST PCV 200 × 3:7",
    },
    year2: {
      rbz: 63,
      afl: 41,
      source: "Jin 2021 PCV 104 眼 × 全体比 131:84",
    },
    year3plus: {
      rbz: 63,
      afl: 41,
      source: "Jin 2021 PCV 104 眼 × 全体比 131:84（3・4年 mean/SD 平均）",
    },
  },
  rap: {
    induction: {
      rbz: 10,
      afl: 22,
      source: "Yoneda 2023 J-CREST RAP 32 × 3:7",
    },
    year1: {
      rbz: 10,
      afl: 22,
      source: "Yoneda 2023 J-CREST RAP 32 × 3:7",
    },
    year2: {
      rbz: 1,
      afl: 1,
      source: "Hoshino 2020 の薬剤別 n を公開抄録から確認できず、等重み 1:1",
    },
    year3plus: {
      rbz: 1,
      afl: 1,
      source: "Kertes 2021 は RBZ のみ。AFL 群なしのため等重み 1:1",
    },
  },
};

const PHASES = ["induction", "year1", "year2", "year3plus"];
const SUBTYPE_IDS = ["typical", "pcv", "rap"];

/** @param {number[]} rbz @param {number[]} afl */
export function poolPercentVectors(rbz, afl, nRbz, nAfl) {
  const w = nRbz + nAfl;
  if (!w) throw new Error("transition pool weights must be positive");
  return rbz.map((v, i) => (v * nRbz + afl[i] * nAfl) / w);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function compilePercents(pcts) {
  return tp(pcts[0], pcts[1], pcts[2], pcts[3], pcts[4]);
}

function buildPooled() {
  const raw = {};
  const compiled = {};
  const notes = {};

  for (const subtypeId of SUBTYPE_IDS) {
    raw[subtypeId] = { pooled: {} };
    compiled[subtypeId] = { pooled: {} };
    notes[subtypeId] = {};
    for (const phase of PHASES) {
      const w = TRANSITION_POOL_WEIGHTS[subtypeId][phase];
      const rbz = TABLE_S5_RAW_PERCENT[subtypeId].rbz_bs[phase];
      const afl = TABLE_S5_RAW_PERCENT[subtypeId].aflibercept[phase];
      const pooled = poolPercentVectors(rbz, afl, w.rbz, w.afl);
      raw[subtypeId].pooled[phase] = pooled.map(round1);
      compiled[subtypeId].pooled[phase] = compilePercents(pooled);
      notes[subtypeId][phase] = {
        nRbz: w.rbz,
        nAfl: w.afl,
        source: w.source,
        rbz,
        afl,
        pooled,
        pooledRounded: pooled.map(round1),
      };
    }
  }

  return { raw, compiled, notes };
}

const BUILT = buildPooled();

/** 表示用（1小数）。合計は丸めで 100 にならない場合あり */
export const TABLE_S5_POOLED_RAW_PERCENT = BUILT.raw;

/** Markov 用（丸め前の加重平均を正規化） */
export const TRANS_POOLED_TABLE = BUILT.compiled;

export const TRANSITION_POOL_NOTES = BUILT.notes;

export const TRANSITION_POOL_SOURCE =
  "病型別・期間別に Table S5 の RBZ 列と AFL 列を元研究の症例数で加重平均。病型横断はしない。Yoneda Y1 は 7:3、Jin Y≥2 は 131:84 を病型合計に按分。RAP Y2/Y≥3 は薬剤別 n 不明または片群のみのため 1:1。";

export function isPooledTransitionMode(transitionMode) {
  return transitionMode === TRANSITION_MODE_POOLED;
}

export function getTransitionModeOption(transitionMode) {
  return (
    TRANSITION_MODE_OPTIONS.find((o) => o.id === transitionMode) ??
    TRANSITION_MODE_OPTIONS[0]
  );
}

/** 既存テーブルの各病型に、同じ統合フェーズを rbz_bs / aflibercept / pooled として載せる */
export function overlayPooledTransitions(transitions) {
  const out = {};
  for (const subtypeId of Object.keys(transitions)) {
    const pooled = TRANS_POOLED_TABLE[subtypeId]?.pooled;
    if (!pooled) {
      out[subtypeId] = transitions[subtypeId];
      continue;
    }
    out[subtypeId] = {
      ...transitions[subtypeId],
      rbz_bs: pooled,
      aflibercept: pooled,
      [TRANSITION_POOL_KEY]: pooled,
    };
  }
  return out;
}
