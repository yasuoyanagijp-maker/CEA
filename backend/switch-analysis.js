import { DEFAULT_HORIZON } from "./constants.js";
import { DRUG_CATALOG } from "./drugs.js";
import { getCostPaper } from "./papers/index.js";
import { runMarkov } from "./markov.js";
import {
  TREATMENT_INTERVAL_OPTIONS,
  REFERENCE_INTERVAL_WEEKS,
  annualInjectionsFromIntervalWeeks,
  injectionScaleForIntervalWeeks,
  formatIntervalLabel,
} from "./config/treatment-intervals.js";

function perInjectionCost(drugId, paper) {
  const price = paper.drugPrices[drugId];
  if (price == null) return null;
  if (paper.administrationBundled) {
    return price + (paper.administrationPerInjection ?? 0);
  }
  return price + (paper.injectionFee ?? 0);
}

/**
 * 薬剤＋投与費のみの年間コスト（定常 T&E 近似）
 */
export function annualDrugAdminCost(drugId, intervalWeeks, costPaperId) {
  const paper = getCostPaper(costPaperId);
  const perInj = perInjectionCost(drugId, paper);
  if (perInj == null) return null;
  const annualInj = annualInjectionsFromIntervalWeeks(intervalWeeks);
  return {
    perInjection: perInj,
    annualInjections: annualInj,
    annualTotal: perInj * annualInj,
  };
}

/**
 * 薬剤＋投与費のコストパリティに必要なスイッチ先間隔（週）— 解析的解
 */
export function analyticBreakEvenIntervalWeeks(
  currentDrugId,
  currentIntervalWeeks,
  targetDrugId,
  costPaperId
) {
  const current = annualDrugAdminCost(currentDrugId, currentIntervalWeeks, costPaperId);
  const targetPerInj = perInjectionCost(targetDrugId, getCostPaper(costPaperId));
  if (!current || targetPerInj == null || targetPerInj <= 0) return null;

  const breakEvenAnnualInj = (current.annualTotal / targetPerInj);
  if (breakEvenAnnualInj <= 0) return null;
  const weeks = 52 / breakEvenAnnualInj;
  return {
    weeks,
    annualInjections: breakEvenAnnualInj,
    label: formatIntervalLabel(Math.round(weeks)),
  };
}

/**
 * QALY 中立コスト最小化（CMA）の許容 QALY 差の目安
 * @param {number} deltaCost — スイッチ先 − 現行（負 = スイッチで削減）
 * @param {number} wtpPerQaly — 支払意思額（¥/QALY）
 */
export function cmaQalyTolerance(deltaCost, wtpPerQaly) {
  if (wtpPerQaly == null || wtpPerQaly <= 0) return null;
  if (deltaCost < 0) {
    return {
      kind: "max_acceptable_loss",
      qaly: Math.abs(deltaCost) / wtpPerQaly,
      description:
        "現行より安い場合、ICER が WTP 以内に収まる許容 QALY 低下（最大）",
    };
  }
  if (deltaCost > 0) {
    return {
      kind: "min_required_gain",
      qaly: deltaCost / wtpPerQaly,
      description:
        "現行より高い場合、ICER が WTP 以内に収まるために必要な QALY 増加（最小）",
    };
  }
  return {
    kind: "neutral",
    qaly: 0,
    description: "総コスト同等 — QALY 差 0 なら CMA 上はどちらでも可",
  };
}

/**
 * @param {object} input — runAnalysis と同様 + switch 固有
 * @param {string} input.currentDrugId
 * @param {number} input.currentIntervalWeeks
 * @param {string} input.targetDrugId
 * @param {number} [input.wtpPerQaly]
 */
export function runSwitchCostMinimization(input) {
  const horizon = { ...DEFAULT_HORIZON, ...input.horizon };
  const wtpPerQaly = input.wtpPerQaly ?? horizon.wtpPerQaly ?? DEFAULT_HORIZON.wtpPerQaly;
  const treatmentDurationYears =
    input.treatmentDurationYears !== undefined
      ? input.treatmentDurationYears
      : null;
  const modelParams = input.modelParams ?? {};
  const costPaperId = input.costPaperId ?? "paper2_rbz";
  const clinicalCase = input.clinicalCase ?? "base";
  const subtypeId = input.subtypeId ?? "typical";

  const markovBase = {
    subtypeId,
    costPaperId,
    clinicalCase,
    horizon,
    treatmentDurationYears,
    modelParams,
  };

  const current = runMarkov({
    ...markovBase,
    drugId: input.currentDrugId,
    intervalWeeks: input.currentIntervalWeeks,
  });

  const analyticBe = analyticBreakEvenIntervalWeeks(
    input.currentDrugId,
    input.currentIntervalWeeks,
    input.targetDrugId,
    costPaperId
  );

  const currentDrugAdmin = annualDrugAdminCost(
    input.currentDrugId,
    input.currentIntervalWeeks,
    costPaperId
  );
  const targetDrugAdminAtCurrentInterval = annualDrugAdminCost(
    input.targetDrugId,
    input.currentIntervalWeeks,
    costPaperId
  );

  const intervalRows = TREATMENT_INTERVAL_OPTIONS.map(({ weeks, label }) => {
    const target = runMarkov({
      ...markovBase,
      drugId: input.targetDrugId,
      intervalWeeks: weeks,
    });
    const deltaCost =
      target.totalCost != null && current.totalCost != null
        ? target.totalCost - current.totalCost
        : null;
    const deltaQaly =
      target.totalQALY != null && current.totalQALY != null
        ? target.totalQALY - current.totalQALY
        : null;
    const drugAdminAnnual = annualDrugAdminCost(
      input.targetDrugId,
      weeks,
      costPaperId
    );
    const qalyTolerance =
      deltaCost != null ? cmaQalyTolerance(deltaCost, wtpPerQaly) : null;

    return {
      weeks,
      label,
      annualInjections: drugAdminAnnual?.annualInjections ?? null,
      annualDrugAdmin: drugAdminAnnual?.annualTotal ?? null,
      totalCost: target.totalCost ?? null,
      totalQALY: target.totalQALY ?? null,
      deltaCost,
      deltaQaly,
      costNeutralOrBetter: deltaCost != null ? deltaCost <= 0 : null,
      qalyTolerance,
      costBreakdown: target.costBreakdown ?? null,
    };
  });

  const feasibleIntervals = intervalRows.filter((r) => r.costNeutralOrBetter);
  const bestFeasible =
    feasibleIntervals.length > 0
      ? feasibleIntervals.reduce((a, b) =>
          (a.deltaCost ?? 0) < (b.deltaCost ?? 0) ? a : b
        )
      : null;

  const markovBreakEven = intervalRows
    .filter((r) => r.costNeutralOrBetter)
    .sort((a, b) => a.weeks - b.weeks)[0] ?? null;

  const sameIntervalRow = intervalRows.find(
    (r) => r.weeks === input.currentIntervalWeeks
  );

  return {
    currentDrugId: input.currentDrugId,
    targetDrugId: input.targetDrugId,
    currentIntervalWeeks: input.currentIntervalWeeks,
    referenceIntervalWeeks: REFERENCE_INTERVAL_WEEKS,
    wtpPerQaly,
    current: {
      drug: DRUG_CATALOG[input.currentDrugId],
      intervalWeeks: input.currentIntervalWeeks,
      intervalLabel: formatIntervalLabel(input.currentIntervalWeeks),
      totalCost: current.totalCost ?? null,
      totalQALY: current.totalQALY ?? null,
      costBreakdown: current.costBreakdown ?? null,
      annualDrugAdmin: currentDrugAdmin?.annualTotal ?? null,
      annualInjections: currentDrugAdmin?.annualInjections ?? null,
      perInjectionCost: currentDrugAdmin?.perInjection ?? null,
    },
    targetAtSameInterval: sameIntervalRow
      ? {
          totalCost: sameIntervalRow.totalCost,
          totalQALY: sameIntervalRow.totalQALY,
          deltaCost: sameIntervalRow.deltaCost,
          deltaQaly: sameIntervalRow.deltaQaly,
          qalyTolerance: sameIntervalRow.qalyTolerance,
          annualDrugAdmin: targetDrugAdminAtCurrentInterval?.annualTotal ?? null,
        }
      : null,
    analyticBreakEven: analyticBe,
    markovBreakEven: markovBreakEven
      ? {
          weeks: markovBreakEven.weeks,
          label: markovBreakEven.label,
          deltaCost: markovBreakEven.deltaCost,
          totalCost: markovBreakEven.totalCost,
        }
      : null,
    bestFeasible,
    intervalRows,
    feasibleCount: feasibleIntervals.length,
    recommendation: buildRecommendation({
      currentDrugId: input.currentDrugId,
      targetDrugId: input.targetDrugId,
      bestFeasible,
      markovBreakEven,
      analyticBe,
      sameIntervalRow,
      wtpPerQaly,
    }),
  };
}

function buildRecommendation(ctx) {
  const currentName = DRUG_CATALOG[ctx.currentDrugId]?.name ?? ctx.currentDrugId;
  const targetName = DRUG_CATALOG[ctx.targetDrugId]?.name ?? ctx.targetDrugId;

  if (ctx.currentDrugId === ctx.targetDrugId) {
    return "現行薬とスイッチ先が同一です。間隔変更のみのコスト影響を確認してください。";
  }

  if (ctx.bestFeasible) {
    const saving = ctx.bestFeasible.deltaCost;
    const tol = ctx.bestFeasible.qalyTolerance;
    const tolText =
      tol?.kind === "max_acceptable_loss"
        ? `QALY が最大 ${tol.qaly.toFixed(3)} 低下しても WTP（¥${(ctx.wtpPerQaly / 1e6).toFixed(1)}M/QALY）内で費用対効果的`
        : tol?.kind === "neutral"
          ? "QALY 差 0 なら CMA 上はスイッチ推奨"
          : "";
    return (
      `${targetName} へスイッチし ${ctx.bestFeasible.label} なら、` +
      `現行（${currentName}）と同等以下の総コスト（Δ ¥${Math.round(Math.abs(saving ?? 0)).toLocaleString("ja-JP")}）。` +
      (tolText ? ` ${tolText}。` : "")
    );
  }

  if (ctx.analyticBe?.weeks) {
    const w = Math.ceil(ctx.analyticBe.weeks);
    return (
      `Markov 総コストではコスト同等の間隔はありませんが、` +
      `薬剤＋投与費のみなら ${formatIntervalLabel(w)} 以上の延長で現行と同等以下になります。` +
      ` 視力維持のため許容できる QALY 差は左表の WTP 換算を参照してください。`
    );
  }

  if (ctx.sameIntervalRow?.deltaCost != null && ctx.sameIntervalRow.deltaCost > 0) {
    const gain = ctx.sameIntervalRow.qalyTolerance;
    return (
      `同一間隔では総コストが ¥${Math.round(ctx.sameIntervalRow.deltaCost).toLocaleString("ja-JP")} 増加。` +
      ` CMA（QALY 中立）の観点ではスイッチ非推奨。` +
      (gain?.kind === "min_required_gain"
        ? ` WTP 内に収めるには QALY が少なくとも +${gain.qaly.toFixed(3)} 必要。`
        : "")
    );
  }

  return "条件を変更するか、コスト出典・臨床ケースを確認してください。";
}

export {
  TREATMENT_INTERVAL_OPTIONS,
  REFERENCE_INTERVAL_WEEKS,
  formatIntervalLabel,
  injectionScaleForIntervalWeeks,
  annualInjectionsFromIntervalWeeks,
};
