/**
 * nAMD CEA — プロジェクトルート (/Users/yy/CEA)
 * - frontend/App.jsx … UI
 * - backend/engine.js … Markov・コスト・論文データ
 */
export { default } from "./frontend/App.jsx";
export {
  runAnalysis,
  runMarkov,
  listMissingParams,
  DRUG_CATALOG,
  DRUG_IDS,
  SUBTYPES,
  COST_PAPER_LIST,
  DEFAULT_HORIZON,
  DEFAULT_MODEL_PARAMS,
  DEFAULT_TREATMENT_DURATION_YEARS,
  TREATMENT_DURATION_OPTIONS,
} from "./backend/engine.js";
