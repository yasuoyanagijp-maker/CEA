/**
 * nAMD CEA — プロジェクトルート (/Users/yy/CEA)
 * - frontend/App.jsx … UI
 * - backend/engine.js … Markov・コスト・論文データ
 */
export { default } from "./frontend/App.jsx";
export {
  runAnalysis,
  runMarkov,
  runPatientSimulation,
  runPatientDrugComparison,
  buildPatientAnnualDrugComparison,
  listMissingParams,
  DRUG_CATALOG,
  DRUG_IDS,
  PATIENT_DRUG_IDS,
  patientDrugIds,
  getDrugTransitionKey,
  SUBTYPES,
  COST_PAPER_LIST,
  DEFAULT_HORIZON,
  DEFAULT_MODEL_PARAMS,
  DEFAULT_TREATMENT_DURATION_YEARS,
  TREATMENT_DURATION_OPTIONS,
  INCOME_BRACKET_LIST,
} from "./backend/engine.js";
