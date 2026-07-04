import { DEFAULT_HORIZON } from "./constants.js";
import { DRUG_CATALOG, DRUG_IDS } from "./drugs.js";
import { getEffectiveAnnualInjectionRate } from "./clinical.js";
import { DEFAULT_COST_PAPER_ID, getCostPaper } from "./papers/index.js";
import { runMarkov } from "./markov.js";
import {
  TREATMENT_INTERVAL_OPTIONS,
  REFERENCE_INTERVAL_WEEKS,
  formatIntervalLabel,
} from "./config/treatment-intervals.js";
import {
  getSwitchEvidence,
  trialReachFractionAt,
  EVIDENCE_TIER_LABELS,
} from "./config/switch-interval-evidence.js";

function perInjectionCost(drugId, paper) {
  const price = paper.drugPrices[drugId];
  if (price == null) return null;
  if (paper.administrationBundled) {
    return price + (paper.administrationPerInjection ?? 0);
  }
  return price + (paper.injectionFee ?? 0);
}

/**
 * Markov と同一ロジックの薬剤＋投与費（year1 年間）
 */
export function annualDrugAdminCostFromModel({
  drugId,
  intervalWeeks,
  costPaperId,
  clinicalCase,
  subtypeId,
}) {
  const paper = getCostPaper(costPaperId);
  const perInj = perInjectionCost(drugId, paper);
  const annualInj = getEffectiveAnnualInjectionRate({
    clinicalCase,
    subtypeId,
    drugId,
    intervalWeeks,
    phase: "year1",
  });
  if (perInj == null || annualInj == null) return null;
  return {
    perInjection: perInj,
    annualInjections: annualInj,
    annualTotal: perInj * annualInj,
  };
}

/**
 * 薬剤＋投与費のコストパリティに必要なスイッチ先間隔（週）— Markov 注射ロジック準拠
 */
export function analyticBreakEvenIntervalWeeks(
  currentDrugId,
  currentIntervalWeeks,
  targetDrugId,
  costPaperId,
  { clinicalCase = "base", subtypeId = "typical" } = {}
) {
  const current = annualDrugAdminCostFromModel({
    drugId: currentDrugId,
    intervalWeeks: currentIntervalWeeks,
    costPaperId,
    clinicalCase,
    subtypeId,
  });
  const targetPerInj = perInjectionCost(targetDrugId, getCostPaper(costPaperId));
  if (!current || targetPerInj == null || targetPerInj <= 0) return null;

  const breakEvenAnnualInj = current.annualTotal / targetPerInj;
  if (breakEvenAnnualInj <= 0) return null;
  const weeks = 52 / breakEvenAnnualInj;
  return {
    weeks,
    annualInjections: breakEvenAnnualInj,
    label: formatIntervalLabel(Math.round(weeks)),
  };
}

/** 実臨床スイッチ集団で「12週以上到達」が現実的とみなせる下限割合 */
const SWITCH_REACH_FLOOR = 0.15;

/**
 * 損益分岐間隔に対する到達可能性を段階分類する。
 * 二層エビデンス（実臨床の平均延長／RCT の絶対到達率）を組み合わせ、
 * cheaper / reachable / borderline / difficult / unknown を返す。
 */
function classifyReachability({
  priceRatio,
  breakEvenWeeks,
  currentIntervalWeeks,
  requiredExtensionWeeks,
  evidence,
}) {
  if (priceRatio <= 1) {
    return {
      kind: "cheaper",
      label: "同一間隔でも削減",
      detail: `間隔が Q${breakEvenWeeks.toFixed(1)} まで短縮しても現行と同等以下`,
    };
  }

  const realistic = evidence?.realisticExtensionWeeks ?? null;
  const trialReach = evidence?.trialReach ?? null;
  const req = requiredExtensionWeeks;

  // 現実到達（実臨床平均延長）で損益分岐に届くか
  if (realistic) {
    const maxExt = realistic[1];
    if (currentIntervalWeeks + maxExt >= breakEvenWeeks) {
      return {
        kind: "reachable",
        label: "実臨床の延長で到達可能",
        detail: `必要 +${req.toFixed(1)}週 ≤ 実臨床平均 +${realistic[0]}〜${maxExt}週`,
      };
    }
  }

  // 実臨床では届かないが、RCT/延長期の到達率で境界〜困難を段階化
  if (trialReach) {
    const tier = evidence?.trialEvidenceTier ?? null;
    const tierLabel = tier ? EVIDENCE_TIER_LABELS[tier] ?? tier : null;
    const tierSuffix = tierLabel ? `（${tierLabel}）` : "";
    const maxTrialWeeks = Math.max(...trialReach.map((t) => t.weeks));
    // 試験で観測された最長間隔を超える損益分岐は外挿せず「到達困難」
    if (breakEvenWeeks > maxTrialWeeks) {
      return {
        kind: "difficult",
        label: "到達困難",
        detail: `必要 Q${breakEvenWeeks.toFixed(1)} は延長試験の観測上限（Q${maxTrialWeeks}）を超える`,
        evidenceTier: tier,
      };
    }
    const frac = trialReachFractionAt(trialReach, breakEvenWeeks);
    if (frac != null) {
      if (frac >= 0.5) {
        return {
          kind: "reachable",
          label: "延長試験では過半数が到達",
          detail: `Q${breakEvenWeeks.toFixed(1)} 到達率 ≈ ${Math.round(frac * 100)}%${tierSuffix}。実臨床平均は下回るため要経過観察`,
          evidenceTier: tier,
        };
      }
      if (frac >= SWITCH_REACH_FLOOR) {
        return {
          kind: "borderline",
          label: "境界（一部症例で到達）",
          detail: `Q${breakEvenWeeks.toFixed(1)} 到達率 ≈ ${Math.round(frac * 100)}%${tierSuffix}。乾燥・前治療歴で反応差が大きい`,
          evidenceTier: tier,
        };
      }
      return {
        kind: "difficult",
        label: "到達困難",
        detail: `必要 +${req.toFixed(1)}週。Q${breakEvenWeeks.toFixed(1)} 到達率 ≈ ${Math.round(frac * 100)}% にとどまる${tierSuffix}`,
        evidenceTier: tier,
      };
    }
  }

  // 実臨床データはあるが延長量が不足（RCT 到達率なし）
  if (realistic) {
    return {
      kind: "difficult",
      label: "到達困難",
      detail: `必要 +${req.toFixed(1)}週 > 実臨床平均 +${realistic[1]}週`,
    };
  }

  return {
    kind: "unknown",
    label: `+${req.toFixed(1)}週の延長が必要`,
    detail: "スイッチ集団の間隔延長エビデンス未登録 — 個別判断",
  };
}

/**
 * 損益分岐間隔テーブル — 現行レジメン（薬剤＋間隔）に対し、全スイッチ先候補の
 * コスト同等となる治療間隔を解析的に算出する（CMA の中核）。
 *
 * 損益分岐間隔 w_be = 現行間隔 × (スイッチ先1回コスト ÷ 現行1回コスト)
 * 年間薬剤費 = 1回コスト × 52 ÷ 間隔（週）なので、w_be で年間薬剤費が一致する。
 *
 * @param {object} p
 * @param {string} p.currentDrugId
 * @param {number} p.currentIntervalWeeks — 任意の週数（プリセットに限らない）
 * @param {string} p.costPaperId
 * @param {number} [p.wtpPerQaly]
 */
export function computeBreakEvenTable({
  currentDrugId,
  currentIntervalWeeks,
  costPaperId,
  wtpPerQaly = DEFAULT_HORIZON.wtpPerQaly,
}) {
  const paper = getCostPaper(costPaperId);
  const curPerInj = perInjectionCost(currentDrugId, paper);
  if (curPerInj == null || !(currentIntervalWeeks > 0)) return null;

  const annualInjections = 52 / currentIntervalWeeks;
  const annualDrugAdmin = curPerInj * annualInjections;

  const rows = DRUG_IDS.filter((id) => id !== currentDrugId).map((drugId) => {
    const perInj = perInjectionCost(drugId, paper);
    const evidence = getSwitchEvidence(drugId);
    if (perInj == null) {
      return { drugId, drug: DRUG_CATALOG[drugId], missingPrice: true, evidence };
    }
    const priceRatio = perInj / curPerInj;
    const breakEvenWeeks = currentIntervalWeeks * priceRatio;
    const requiredExtensionWeeks = breakEvenWeeks - currentIntervalWeeks;
    const sameIntervalAnnualDelta = (perInj - curPerInj) * annualInjections;
    // 同一間隔でスイッチした場合、WTP 内に収まる年あたり QALY 差の目安
    const qalyPerYear = Math.abs(sameIntervalAnnualDelta) / wtpPerQaly;

    const verdict = classifyReachability({
      priceRatio,
      breakEvenWeeks,
      currentIntervalWeeks,
      requiredExtensionWeeks,
      evidence,
    });

    return {
      drugId,
      drug: DRUG_CATALOG[drugId],
      perInjection: perInj,
      priceRatio,
      breakEvenWeeks,
      requiredExtensionWeeks,
      sameIntervalAnnualDelta,
      qalyPerYear,
      qalyPerYearKind:
        sameIntervalAnnualDelta > 0 ? "min_required_gain" : "max_acceptable_loss",
      evidence,
      verdict,
    };
  });

  return {
    currentDrugId,
    currentDrug: DRUG_CATALOG[currentDrugId],
    currentIntervalWeeks,
    perInjection: curPerInj,
    annualInjections,
    annualDrugAdmin,
    wtpPerQaly,
    rows,
  };
}

/**
 * 年間薬剤+投与費 vs 治療間隔の曲線データ（チャート用）
 * @returns {Array<{weeks:number, [drugId]:number}>}
 */
export function buildAnnualCostCurve({
  drugIds = DRUG_IDS,
  costPaperId,
  minWeeks = 4,
  maxWeeks = 24,
  stepWeeks = 1,
}) {
  const paper = getCostPaper(costPaperId);
  const rows = [];
  for (let w = minWeeks; w <= maxWeeks + 1e-9; w += stepWeeks) {
    const weeks = Math.round(w * 10) / 10;
    const row = { weeks };
    for (const id of drugIds) {
      const perInj = perInjectionCost(id, paper);
      if (perInj != null) row[id] = Math.round((perInj * 52) / weeks);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * QALY 中立コスト最小化（CMA）の許容 QALY 差の目安
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
 */
export function runSwitchCostMinimization(input) {
  const horizon = { ...DEFAULT_HORIZON, ...input.horizon };
  const wtpPerQaly = input.wtpPerQaly ?? horizon.wtpPerQaly ?? DEFAULT_HORIZON.wtpPerQaly;
  const treatmentDurationYears =
    input.treatmentDurationYears !== undefined
      ? input.treatmentDurationYears
      : null;
  const modelParams = input.modelParams ?? {};
  const costPaperId = input.costPaperId ?? DEFAULT_COST_PAPER_ID;
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

  const modelCtx = { clinicalCase, subtypeId, costPaperId };

  const current = runMarkov({
    ...markovBase,
    drugId: input.currentDrugId,
    intervalWeeks: input.currentIntervalWeeks,
  });

  const currentDrugAdmin = annualDrugAdminCostFromModel({
    drugId: input.currentDrugId,
    intervalWeeks: input.currentIntervalWeeks,
    ...modelCtx,
  });

  const analyticBe = analyticBreakEvenIntervalWeeks(
    input.currentDrugId,
    input.currentIntervalWeeks,
    input.targetDrugId,
    costPaperId,
    modelCtx
  );

  const targetDrugAdminAtCurrentInterval = annualDrugAdminCostFromModel({
    drugId: input.targetDrugId,
    intervalWeeks: input.currentIntervalWeeks,
    ...modelCtx,
  });

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
    const drugAdminAnnual = annualDrugAdminCostFromModel({
      drugId: input.targetDrugId,
      intervalWeeks: weeks,
      ...modelCtx,
    });
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
    clinicalCase,
    referenceIntervalWeeks: REFERENCE_INTERVAL_WEEKS,
    wtpPerQaly,
    injectionModelNote: buildInjectionModelNote(clinicalCase),
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
          annualInjections: targetDrugAdminAtCurrentInterval?.annualInjections ?? null,
        }
      : null,
    analyticBreakEven: analyticBe,
    markovBreakEven: markovBreakEven
      ? {
          weeks: markovBreakEven.weeks,
          label: markovBreakEven.label,
          deltaCost: markovBreakEven.deltaCost,
          totalCost: markovBreakEven.totalCost,
          annualInjections: markovBreakEven.annualInjections,
        }
      : null,
    bestFeasible,
    intervalRows,
    feasibleCount: feasibleIntervals.length,
    recommendation: buildRecommendation({
      currentDrugId: input.currentDrugId,
      targetDrugId: input.targetDrugId,
      clinicalCase,
      bestFeasible,
      markovBreakEven,
      analyticBe,
      sameIntervalRow,
      wtpPerQaly,
      currentDrugAdmin,
      targetDrugAdminAtCurrentInterval,
    }),
  };
}

function buildInjectionModelNote(clinicalCase) {
  const metaNote =
    clinicalCase === "2026_meta"
      ? " 左サイドバー「2026 meta」の year1 値（7.67 / 5.5 等）はサマリー Markov 用で、スイッチタブでは使いません。"
      : "";
  return (
    `年間注射 = 52 ÷ 選択間隔（週）。Q8 → 6.5 回/年 — 薬剤に依存せず UI の間隔だけで決まります。` +
    ` コスト差は主に薬価 × 注射回数の積。${metaNote}`
  );
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
      `薬剤＋投与費（Markov 注射ロジック）のみなら ${formatIntervalLabel(w)} 以上の延長で現行と同等以下になります。` +
      ` 視力維持のため許容できる QALY 差は表の WTP 換算を参照してください。`
    );
  }

  if (ctx.sameIntervalRow?.deltaCost != null && ctx.sameIntervalRow.deltaCost > 0) {
    const gain = ctx.sameIntervalRow.qalyTolerance;
    const curInj = ctx.currentDrugAdmin?.annualInjections?.toFixed(1);
    const tgtInj = ctx.targetDrugAdminAtCurrentInterval?.annualInjections?.toFixed(1);
    return (
      `同一間隔では総コストが ¥${Math.round(ctx.sameIntervalRow.deltaCost).toLocaleString("ja-JP")} 増加` +
      (curInj && tgtInj ? `（年1注射: 現行 ${curInj} → スイッチ先 ${tgtInj} 回/年）。` : "。") +
      ` CMA（QALY 中立）ではスイッチ非推奨。` +
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
};
