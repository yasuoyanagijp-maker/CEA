/**
 * QALY — 視力状態遷移（Markov）からの算出
 *
 * Yanagi et al. 2024 準拠:
 * - 3ヶ月サイクル
 * - 両眼モデル: 較好眼 BCVA に基づく5状態効用（非罹患眼は utilityNone）
 * - 半周期補正: (U_cycle開始 + U_cycle終了) / 2 × サイクル長 × 割引
 */

import { N_STATES } from "./constants.js";

/**
 * コホート分布から期待較好眼効用を算出（両眼・第二眼発症を考慮）
 * @param {number[]} cohort — 各状態の生存質量（aliveMass 込み）
 * @param {number[]} fellowDist — 他眼の状態分布
 * @param {number} pSecond — 両眼罹患確率
 * @param {{ utilities: number[], utilityNone: number }} qaly
 */
export function expectedBetterEyeUtility(cohort, fellowDist, pSecond, qaly) {
  const { utilities: u, utilityNone: uNone } = qaly;
  let expected = 0;
  for (let i = 0; i < N_STATES; i++) {
    if (cohort[i] <= 0) continue;
    expected += (1 - pSecond) * cohort[i] * Math.max(u[i], uNone);
    for (let j = 0; j < N_STATES; j++) {
      expected += pSecond * cohort[i] * fellowDist[j] * Math.max(u[i], u[j]);
    }
  }
  return expected;
}

/**
 * 1 Markov サイクル分の QALY（半周期補正・割引済）
 * @param {number} utilityStart — 遷移前の期待効用
 * @param {number} utilityEnd — 遷移・死亡・第二眼発症後の期待効用
 * @param {number} cycleLen — サイクル長（年）
 * @param {number} discountFactor — 当該サイクル開始時点の割引係数
 */
export function qalyForCycle(utilityStart, utilityEnd, cycleLen, discountFactor) {
  return ((utilityStart + utilityEnd) / 2) * cycleLen * discountFactor;
}

/** 個別患者 — 較好眼効用（両眼モデル・状態から直接） */
export function patientBetterEyeUtility(treatedState, fellowState, secondEye, qaly) {
  const { utilities: u } = qaly;
  return Math.max(u[treatedState], u[fellowState]);
}

/**
 * 臨床経路（個別患者）から QALY・生存年数を算出
 * — 死亡月で打ち切り、3ヶ月半周期補正・割引（Markov と同一）
 */
export function computeQalyFromClinicalPath(
  path,
  { modelParams, discountRate, cycleLengthYears = 0.25 }
) {
  if (!modelParams?.utilities || modelParams.utilityNone == null) {
    return { totalQALY: null, totalLifeYears: null, annualQaly: [] };
  }

  const qalyParams = {
    utilities: modelParams.utilities,
    utilityNone: modelParams.utilityNone,
  };
  const cycleMonths = Math.round(cycleLengthYears * 12);
  const discPerCycle = discountRate * cycleLengthYears;
  const months =
    path.deathMonth != null ? path.months.slice(0, path.deathMonth + 1) : path.months;

  if (!months.length) {
    return { totalQALY: 0, totalLifeYears: 0, annualQaly: [] };
  }

  let totalQALY = 0;
  let totalLifeYears = 0;
  const annualQalyMap = new Map();

  for (let c = 0; ; c++) {
    const m0 = c * cycleMonths;
    if (m0 >= months.length) break;

    const mEnd = Math.min(m0 + cycleMonths - 1, months.length - 1);
    const actualCycleLen = (mEnd - m0 + 1) / 12;
    const start = months[m0];
    const end = months[mEnd];

    const uStart = patientBetterEyeUtility(
      start.treatedState,
      start.fellowState,
      start.secondEye,
      qalyParams
    );
    const uEnd = patientBetterEyeUtility(
      end.endTreatedState ?? end.treatedState,
      end.endFellowState ?? end.fellowState,
      end.endSecondEye ?? end.secondEye,
      qalyParams
    );

    const df = Math.pow(1 + discPerCycle, -c);
    const cycleQaly = qalyForCycle(uStart, uEnd, actualCycleLen, df);
    totalQALY += cycleQaly;
    totalLifeYears += actualCycleLen;

    const yearKey = Math.floor(mEnd / 12);
    annualQalyMap.set(yearKey, (annualQalyMap.get(yearKey) ?? 0) + cycleQaly);
  }

  let cum = 0;
  const annualQaly = [...annualQalyMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, qaly]) => {
      cum += qaly;
      return { year, qaly, cumQALY: cum };
    });

  return { totalQALY, totalLifeYears, annualQaly };
}
