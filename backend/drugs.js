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
    clinicalNote: "遷移 S5: rbz_bs 列。注射 S6: typical/PCV/RAP 実臨床（rbz_bs 列）",
  },
  aflibercept: {
    id: "aflibercept",
    name: "アフリベルセプト 2 mg",
    brand: "アイリーア",
    color: "#1565C0",
    monitoringRegimen: "tae",
    clinicalKey: "aflibercept",
    transitionKey: "aflibercept",
  },
  aflibercept_bs: {
    id: "aflibercept_bs",
    name: "アフリベルセプト BS",
    brand: "（バイオシミラー）",
    color: "#0277BD",
    monitoringRegimen: "tae",
    clinicalKey: "aflibercept_bs",
    transitionKey: "aflibercept",
    clinicalNote: "遷移 S5: aflibercept 列。注射 S6: 病型別 aflibercept 列（薬価のみ BS）",
  },
  aflibercept_8mg: {
    id: "aflibercept_8mg",
    name: "アフリベルセプト 8 mg",
    brand: "アイリーア 8 mg",
    color: "#0D47A1",
    monitoringRegimen: "tae",
    clinicalKey: "aflibercept_8mg",
    transitionKey: "aflibercept",
    clinicalNote: "遷移 S5: aflibercept 列。注射: 参考値（AFL 2 mg × 0.8、病型別 S6）",
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
    clinicalNote: "遷移 S5: aflibercept 列（暫定）。注射: 参考値（AFL 2 mg × 0.8、病型別 S6）",
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
    clinicalNote: "遷移 S5: aflibercept 列（暫定）。注射: 参考値（AFL 2 mg × 0.8、病型別 S6）",
    injectionReference: true,
  },
  ranibizumab_bs: {
    id: "ranibizumab_bs",
    name: "ラニビズマブ BS",
    brand: "ラニビズマブ BS",
    color: "#00695C",
    monitoringRegimen: "tae",
    clinicalKey: "ranibizumab_bs",
    transitionKey: "rbz_bs",
    clinicalNote: "遷移 S5: rbz_bs 列。注射 S6: 病型別 rbz_bs 列",
  },
};

export const DRUG_IDS = Object.keys(DRUG_CATALOG);

/** 個別患者タブ — 全薬剤を表示 */
export const PATIENT_DRUG_IDS = DRUG_IDS;

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
