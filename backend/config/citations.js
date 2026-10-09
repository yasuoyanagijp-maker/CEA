/**
 * UI に出す文献表記。形式は「著者, ジャーナル名, 年」。
 * 内部 ID（2026_meta 等）は変えない。
 */

export const CITE = {
  wojciechowski2025: "Wojciechowski, Ophthalmol Ther, 2025",
  yanagi2024: "Yanagi, Ophthalmol Ther, 2024",
  yanagi2025jme: "Yanagi, J Med Econ, 2025",
  yanagi2023: "Yanagi, Ophthalmol Ther, 2023",
  yoneda2023: "Yoneda, Ophthalmol Retina, 2023",
  jin2021: "Jin, Sci Rep, 2021",
  hoshino2020: "Hoshino, 日眼会誌, 2020",
  kertes2021: "Kertes, Ophthalmology, 2021",
  iida2025: "Iida, Jpn J Ophthalmol, 2025",
  okawa2025: "Okawa, J Vitreoretin Dis, 2025",
  matsumoto2022: "Matsumoto, Sci Rep, 2022",
  inoda2024: "Inoda, Sci Rep, 2024",
  elAlili2026: "El Alili, Ophthalmol Ther, 2026",
  wong2008: "Wong, Ophthalmology, 2008",
};

export const CLINICAL_CASE_LABELS = {
  base: `注射回数：ベースケース Table S6（${CITE.yanagi2024}）`,
  scenario: `注射回数：シナリオ Table S8（${CITE.yanagi2024}）`,
  "2026_meta": `注射回数：ネットワークメタ解析（${CITE.wojciechowski2025}）`,
  lit_2025_2026: `注射回数：感度分析・確認文献（${CITE.iida2025} ほか）`,
};

export const CLINICAL_CASE_HINTS = {
  base: `遷移は Table S5（${CITE.yanagi2024}）。注射は Table S6（${CITE.yoneda2023} / ${CITE.jin2021} / ${CITE.hoshino2020}）。`,
  scenario: `遷移は Table S7、注射は Table S8（${CITE.yanagi2024}）。`,
  "2026_meta": `遷移は Table S5（${CITE.yanagi2024}）。1年目注射は ${CITE.wojciechowski2025} の範囲中点（AFL 2 mg は報告上限）。ブロルシズマブは ${CITE.matsumoto2022} / ${CITE.inoda2024}。2年目以降は専門家による推計。`,
  lit_2025_2026: `遷移は Table S5（${CITE.yanagi2024}）。1年目は ${CITE.iida2025} / ${CITE.okawa2025} / ${CITE.matsumoto2022} / ${CITE.inoda2024}。無いセルは ${CITE.wojciechowski2025} セットの既存値（専門家による推計）。`,
};

export const TRANSITION_MODE_LABELS = {
  drug_specific: `薬剤別 Table S5（${CITE.yanagi2024}）`,
  rbz_afl_pooled: `病型別 RBZ+AFL 統合（${CITE.yanagi2024}）`,
};

/** 統合モード時に各薬剤行へ出す遷移注記（スライド用。数値は変えない） */
export const POOLED_TRANSITION_NOTE = "遷移：病型別 RBZ+AFL 統合（全薬剤共通）";

export const TRANSITION_MODE_HINTS = {
  drug_specific: `ラニビズマブ系は Table S5 の rbz_bs 列、アフリベルセプト系・ファリシマブ・ブロルシズマブは aflibercept 列（${CITE.yanagi2024}）。`,
  rbz_afl_pooled: `各病型・各期間で Table S5 の RBZ 列と AFL 列を元研究の症例数で加重平均し、その病型の統合値を全薬剤に適用（病型横断はしない）。重み: ${CITE.yoneda2023}、${CITE.jin2021}、${CITE.hoshino2020}、${CITE.kertes2021}。`,
};

export const COST_PAPER_LABELS = {
  default_integrated: `コスト：2論文統合（${CITE.yanagi2024} / ${CITE.yanagi2025jme}）`,
  paper1_faricimab: `コスト：ファリシマブ CEA（${CITE.yanagi2025jme}）`,
  paper2_rbz: `コスト：ラニビズマブ BS 病型別 CEA（${CITE.yanagi2024}）`,
};
