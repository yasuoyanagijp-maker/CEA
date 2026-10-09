/**
 * 注射回数のうち、照合で原典の数値が見つからない値。
 * 値そのものは変えない。UI・表・注記には EXPERT_ESTIMATE_LABEL を付ける。
 */

import { DRUG_CATALOG } from "../drugs.js";
import {
  AFL2MG_DERIVED_DRUG_IDS,
  isAfl2mgDerivedInjection,
} from "./drug-clinical-profile.js";
import {
  INJECTIONS_2026_META_YEAR1,
  META_2026_PHASE_IS_ESTIMATE,
  getInjections2026MetaForDrug,
} from "./injections-2026-meta.js";
import {
  CLINICAL_CASE_LIT_2025,
  LIT_2025_PHASE_IS_ESTIMATE,
  getInjectionsLit2025ForDrug,
} from "./injections-lit-2025.js";

export const EXPERT_ESTIMATE_LABEL = "（専門家による推計）";

const PHASES = ["induction", "year1", "year2", "year3plus"];
const SUBTYPE_IDS = ["typical", "pcv", "rap"];

export const META_2026_ESTIMATE_REASON = {
  induction: "Wojciechowski, Ophthalmol Ther, 2025 は週52までの総数のみ。導入3回は year1 の内訳仮定",
  year2: "NMA は1年ホライズン。year2+ = year1−3 はモデル仮定（AFL 8 mg は Q16=3.25）",
};

const S6_DERIVED_REASON =
  "S6/S8 未掲載。induction は薬剤別仮定、year1以降は同一病型 AFL 2 mg × 0.8";

/**
 * @param {{ clinicalCase?: string, drugId: string, phase: string }} q
 */
export function isExpertEstimateInjection({ clinicalCase, drugId, phase }) {
  if (clinicalCase === "2026_meta") {
    return META_2026_PHASE_IS_ESTIMATE[drugId]?.[phase] === true;
  }
  if (clinicalCase === CLINICAL_CASE_LIT_2025) {
    return LIT_2025_PHASE_IS_ESTIMATE[drugId]?.[phase] === true;
  }
  if (clinicalCase === "base" || clinicalCase === "scenario") {
    return isAfl2mgDerivedInjection(drugId);
  }
  return false;
}

/**
 * カレンダー年の期待注射が推計を含むか（年0＝最初の12か月＝year1）。
 * @param {{ clinicalCase?: string, drugId: string, calendarYear: number }} q
 */
export function isExpertEstimateCalendarYear({ clinicalCase, drugId, calendarYear }) {
  const phase = calendarYear <= 0 ? "year1" : calendarYear === 1 ? "year2" : "year3plus";
  return isExpertEstimateInjection({ clinicalCase, drugId, phase });
}

/** @param {unknown} value @param {boolean} estimate */
export function formatInjectionCount(value, estimate) {
  if (value == null || value === "") return "—";
  const text =
    typeof value === "number" && Number.isFinite(value)
      ? String(Math.round(value * 1e10) / 1e10)
      : String(value);
  return estimate ? `${text}${EXPERT_ESTIMATE_LABEL}` : text;
}

export function getInjectionEstimateFlags(clinicalCase, drugId) {
  const flags = {};
  for (const phase of PHASES) {
    flags[phase] = isExpertEstimateInjection({ clinicalCase, drugId, phase });
  }
  return flags;
}

/**
 * 報告・テスト用。注釈を付けたセルの一覧。
 * 2026 meta は病型非依存（全病型に同じ回数）。
 */
export function listExpertEstimateInjections() {
  const rows = [];

  for (const drugId of Object.keys(INJECTIONS_2026_META_YEAR1)) {
    const phases = getInjections2026MetaForDrug(drugId);
    const flags = META_2026_PHASE_IS_ESTIMATE[drugId] ?? {};
    for (const phase of PHASES) {
      if (!flags[phase]) continue;
      rows.push({
        clinicalCase: "2026_meta",
        drugId,
        drugName: DRUG_CATALOG[drugId]?.name ?? drugId,
        subtypeId: null,
        subtypeNote: "病型共通（ネットワークメタ解析セットは病型で回数を分けない）",
        phase,
        value: phases[phase],
        reason:
          phase === "induction"
            ? META_2026_ESTIMATE_REASON.induction
            : META_2026_ESTIMATE_REASON.year2,
      });
    }
  }

  for (const drugId of Object.keys(INJECTIONS_2026_META_YEAR1)) {
    const phases = getInjectionsLit2025ForDrug(drugId);
    const flags = LIT_2025_PHASE_IS_ESTIMATE[drugId] ?? {};
    for (const phase of PHASES) {
      if (!flags[phase]) continue;
      rows.push({
        clinicalCase: CLINICAL_CASE_LIT_2025,
        drugId,
        drugName: DRUG_CATALOG[drugId]?.name ?? drugId,
        subtypeId: null,
        subtypeNote: "病型共通",
        phase,
        value: phases?.[phase],
        reason:
          phase === "year1"
            ? "感度セットに新文献なし。Wojciechowski, Ophthalmol Ther, 2025 セットの既存値を流用"
            : phase === "induction"
              ? META_2026_ESTIMATE_REASON.induction
              : "確認文献は1年ホライズン。year2+ は Wojciechowski, Ophthalmol Ther, 2025 セットの既存値",
      });
    }
  }

  for (const clinicalCase of ["base", "scenario"]) {
    for (const drugId of AFL2MG_DERIVED_DRUG_IDS) {
      for (const subtypeId of SUBTYPE_IDS) {
        for (const phase of PHASES) {
          rows.push({
            clinicalCase,
            drugId,
            drugName: DRUG_CATALOG[drugId]?.name ?? drugId,
            subtypeId,
            subtypeNote: subtypeId,
            phase,
            value: null,
            reason: S6_DERIVED_REASON,
          });
        }
      }
    }
  }

  return rows;
}

export { META_2026_PHASE_IS_ESTIMATE };
