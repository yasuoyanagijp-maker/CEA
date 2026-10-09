import { POOLED_TRANSITION_NOTE } from "./config/citations.js";
import { isPooledTransitionMode } from "./config/transition-pool.js";
import {
  getInjections2026MetaForDrug,
  META_2026_YEAR1_NOTE_SOURCE,
  META_2026_YEAR2_NOTE_SOURCE,
} from "./config/injections-2026-meta.js";
import {
  CLINICAL_CASE_LIT_2025,
  getInjectionsLit2025ForDrug,
  LIT_2025_YEAR1_SOURCE,
} from "./config/injections-lit-2025.js";

/** 7 薬剤 — clinicalKey=drugId、遷移(S5)は transitionKey */
export const DRUG_CATALOG = {
  ranibizumab: {
    id: "ranibizumab",
    name: "ラニビズマブ",
    brand: "ルセンティス",
    color: "#2E7D32",
    monitoringRegimen: "tae",
    clinicalKey: "ranibizumab",
    transitionKey: "rbz_bs",
    transitionNote: "遷移 S5: rbz_bs 列",
    injectionNote: "注射 S6: 病型別 rbz_bs 列（BS と同一回数）",
  },
  ranibizumab_bs: {
    id: "ranibizumab_bs",
    name: "ラニビズマブ BS",
    brand: "ラニビズマブ BS",
    color: "#00695C",
    monitoringRegimen: "tae",
    clinicalKey: "ranibizumab_bs",
    transitionKey: "rbz_bs",
    transitionNote: "遷移 S5: rbz_bs 列",
    injectionNote: "注射 S6: 病型別 rbz_bs 列（先発と同一回数、薬価のみ BS）",
  },
  aflibercept: {
    id: "aflibercept",
    name: "アフリベルセプト 2 mg",
    brand: "アイリーア",
    color: "#1565C0",
    monitoringRegimen: "tae",
    clinicalKey: "aflibercept",
    transitionKey: "aflibercept",
    transitionNote: "遷移 S5: aflibercept 列",
    injectionNote: "注射 S6: 病型別 aflibercept 列",
  },
  aflibercept_bs: {
    id: "aflibercept_bs",
    name: "アフリベルセプト BS",
    brand: "（バイオシミラー）",
    color: "#0277BD",
    monitoringRegimen: "tae",
    clinicalKey: "aflibercept_bs",
    transitionKey: "aflibercept",
    transitionNote: "遷移 S5: aflibercept 列",
    injectionNote: "注射 S6: 病型別 aflibercept 列（2 mg と同一回数、薬価のみ BS）",
  },
  aflibercept_8mg: {
    id: "aflibercept_8mg",
    name: "アフリベルセプト 8 mg",
    brand: "アイリーア 8 mg",
    color: "#0D47A1",
    monitoringRegimen: "tae",
    clinicalKey: "aflibercept_8mg",
    transitionKey: "aflibercept",
    transitionNote: "遷移 Table S5: aflibercept 列（Yanagi, Ophthalmol Ther, 2024）",
    injectionNote:
      "注射：induction=3・year1以降 AFL 2 mg × 0.8（病型別 Table S6、専門家による推計）",
    injectionReference: true,
  },
  faricimab: {
    id: "faricimab",
    name: "ファリシマブ",
    brand: "バビースモ",
    color: "#6A1B9A",
    monitoringRegimen: "tae",
    clinicalKey: "faricimab",
    transitionKey: "aflibercept",
    transitionNote: "遷移 Table S5: aflibercept 列（Yanagi, Ophthalmol Ther, 2024）",
    injectionNote:
      "注射：induction=4・year1以降 AFL 2 mg × 0.8（病型別 Table S6、専門家による推計）",
    injectionReference: true,
  },
  brolucizumab: {
    id: "brolucizumab",
    name: "ブロルシズマブ",
    brand: "ベオビュ",
    color: "#E65100",
    monitoringRegimen: "tae",
    clinicalKey: "brolucizumab",
    transitionKey: "aflibercept",
    transitionNote: "遷移 Table S5: aflibercept 列（Yanagi, Ophthalmol Ther, 2024）",
    injectionNote:
      "注射：induction=2・year1以降 AFL 2 mg × 0.8（病型別 Table S6、専門家による推計）",
    injectionReference: true,
  },
};

function joinClinicalNote(transitionNote, injectionNote) {
  if (transitionNote && injectionNote) return `${transitionNote}。${injectionNote}`;
  return transitionNote || injectionNote || "";
}

function formatInjCount(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.round(n * 1e10) / 1e10);
}

function injectionBiosimilarClause(drugId) {
  if (drugId === "ranibizumab_bs") return "（先発と同一回数、薬価のみ BS）";
  if (drugId === "aflibercept_bs") return "（2 mg と同一回数、薬価のみ BS）";
  return "";
}

function year2NoteSource(drugId) {
  return META_2026_YEAR2_NOTE_SOURCE[drugId] ?? "専門家による推計";
}

function formatYearInclusiveInjectionNote(drugId, phases, year1Source) {
  if (!phases) return "";
  const y1 = formatInjCount(phases.year1);
  const y2 = formatInjCount(phases.year2);
  const source = year1Source || "文献値";
  return `注射：1年目 ${y1}（${source}）、2年目以降 ${y2}（${year2NoteSource(drugId)}）${injectionBiosimilarClause(drugId)}`;
}

/**
 * いま選ばれている注射回数セットに対応する1文。数値は変えない。
 * @param {string} drugId
 * @param {'base'|'scenario'|'2026_meta'|'lit_2025_2026'} [clinicalCase]
 */
export function getDrugInjectionNote(drugId, clinicalCase = "base") {
  const drug = DRUG_CATALOG[drugId];
  if (!drug) return "";
  if (clinicalCase === "2026_meta") {
    return formatYearInclusiveInjectionNote(
      drugId,
      getInjections2026MetaForDrug(drugId),
      META_2026_YEAR1_NOTE_SOURCE[drugId]
    );
  }
  if (clinicalCase === CLINICAL_CASE_LIT_2025) {
    return formatYearInclusiveInjectionNote(
      drugId,
      getInjectionsLit2025ForDrug(drugId),
      LIT_2025_YEAR1_SOURCE[drugId]
    );
  }
  if (clinicalCase === "scenario") {
    return drug.injectionNote.replaceAll("S6", "S8");
  }
  return drug.injectionNote;
}

for (const drug of Object.values(DRUG_CATALOG)) {
  drug.clinicalNote = joinClinicalNote(drug.transitionNote, drug.injectionNote);
}

/**
 * 利用者向け臨床注記。遷移は選択モード、注射は選択セットの1文だけ。
 * 数値・計算経路は変えない。
 */
export function getDrugClinicalNote(drugId, { transitionMode, clinicalCase } = {}) {
  const drug = DRUG_CATALOG[drugId];
  if (!drug) return "";
  const transitionNote = isPooledTransitionMode(transitionMode)
    ? POOLED_TRANSITION_NOTE
    : drug.transitionNote;
  return joinClinicalNote(transitionNote, getDrugInjectionNote(drugId, clinicalCase));
}

export const DRUG_IDS = Object.keys(DRUG_CATALOG);

/** 個別患者タブ — 全薬剤（RBZ 先発・BS を先頭） */
export const PATIENT_DRUG_IDS = DRUG_IDS;

/** 個別患者サマリー表示順 */
export const PATIENT_DISPLAY_ORDER = [...DRUG_IDS];

export function sortByDrugDisplayOrder(ids) {
  const order = new Map(PATIENT_DISPLAY_ORDER.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
}

/** @deprecated patientDrugIds — 後方互換。常に全薬剤 */
export function patientDrugIds(_selectedDrugIds = DRUG_IDS) {
  return [...DRUG_IDS];
}

export function getDrug(drugId) {
  return DRUG_CATALOG[drugId];
}

/** Table S5 遷移列 */
export function getDrugTransitionKey(drugId) {
  return DRUG_CATALOG[drugId]?.transitionKey ?? drugId;
}
