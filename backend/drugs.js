/** 6 薬剤 — 臨床入力キー（論文2）とコストキーの対応 */
export const DRUG_CATALOG = {
  ranibizumab: {
    id: "ranibizumab",
    name: "ラニビズマブ",
    brand: "ルセンティス",
    color: "#2E7D32",
    monitoringRegimen: "tae",
    clinicalKey: "rbz_bs",
    clinicalNote: "論文2は rbz_bs 列を流用（典型nAMD）",
  },
  aflibercept: {
    id: "aflibercept",
    name: "アフリベルセプト 2 mg",
    brand: "アイリーア",
    color: "#1565C0",
    monitoringRegimen: "tae",
    clinicalKey: "aflibercept",
  },
  aflibercept_bs: {
    id: "aflibercept_bs",
    name: "アフリベルセプト BS",
    brand: "（バイオシミラー）",
    color: "#0277BD",
    monitoringRegimen: "tae",
    clinicalKey: "aflibercept",
    clinicalNote: "遷移・注射回数は aflibercept 列と同等",
  },
  aflibercept_8mg: {
    id: "aflibercept_8mg",
    name: "アフリベルセプト 8 mg",
    brand: "アイリーア 8 mg",
    color: "#0D47A1",
    monitoringRegimen: "tae",
    clinicalKey: "aflibercept",
    clinicalNote: "5状態遷移は aflibercept 2 mg 列を流用",
  },
  faricimab: {
    id: "faricimab",
    name: "ファリシマブ",
    brand: "バビースモ",
    color: "#6A1B9A",
    monitoringRegimen: "tae",
    clinicalKey: "aflibercept",
    clinicalNote: "5状態遷移は論文2未掲載のため aflibercept 列を暫定流用",
  },
  brolucizumab: {
    id: "brolucizumab",
    name: "ブロルシズマブ",
    brand: "ベオビュ",
    color: "#E65100",
    monitoringRegimen: "tae",
    clinicalKey: "aflibercept",
    clinicalNote: "5状態遷移は論文2未掲載のため aflibercept 列を暫定流用",
  },
  ranibizumab_bs: {
    id: "ranibizumab_bs",
    name: "ラニビズマブ BS",
    brand: "ラニビズマブ BS",
    color: "#00695C",
    monitoringRegimen: "tae",
    clinicalKey: "rbz_bs",
  },
};

export const DRUG_IDS = Object.keys(DRUG_CATALOG);

/** 個別患者タブで常に表示する BS 比較軸 */
export const PATIENT_CORE_DRUG_IDS = ["ranibizumab_bs", "aflibercept", "aflibercept_bs"];

/** 個別患者比較 — コア BS 3 剤 + サイドバーで選択した薬剤 */
export function patientDrugIds(selectedDrugIds = DRUG_IDS) {
  return [...new Set([...PATIENT_CORE_DRUG_IDS, ...selectedDrugIds])];
}

export function getDrug(drugId) {
  return DRUG_CATALOG[drugId];
}
