export const N_STATES = 5;
export const STATE_LABELS = ["視力障害無し", "軽度", "中度", "重度", "失明"];

/**
 * 失明に伴う社会的費用（介護・通院）の状態別按分
 * 無・軽・中は表値100%、重度50%、失明100%
 */
export const BLINDNESS_SOCIETAL_COST_WEIGHT = [1, 1, 1, 0.5, 1];

export const DEFAULT_HORIZON = {
  timeHorizonYears: 25,
  cycleLengthYears: 0.25,
  discountRate: 0.02,
  wtpPerQaly: 5_000_000,
};

/** 抗VEGF治療を続ける年数。null = 解析期間いっぱい（生涯） */
export const TREATMENT_DURATION_MODES = {
  years_2: 2,
  years_5: 5,
  lifetime: null,
};

export const DEFAULT_TREATMENT_DURATION_YEARS = 5;

export const TREATMENT_DURATION_OPTIONS = [
  { id: "years_2", label: "2年", years: 2 },
  { id: "years_5", label: "5年", years: 5 },
  { id: "lifetime", label: "生涯", years: null },
];

export const CLINICAL_PHASES = ["induction", "year1", "year2", "year3plus"];
