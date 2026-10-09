export function pct(v) {
  return v / 100;
}

export function tp(imp2, imp1, remain, wors1, wors2) {
  return normalizeTransitionProbs({
    imp2: pct(imp2),
    imp1: pct(imp1),
    remain: pct(remain),
    wors1: pct(wors1),
    wors2: pct(wors2),
  });
}

/** 補足表の丸めで合計≠1のとき質量が増殖するのを防ぐ */
export function normalizeTransitionProbs(probs) {
  const sum =
    probs.imp2 + probs.imp1 + probs.remain + probs.wors1 + probs.wors2;
  if (!sum || Math.abs(sum - 1) < 1e-9) return probs;
  return {
    imp2: probs.imp2 / sum,
    imp1: probs.imp1 / sum,
    remain: probs.remain / sum,
    wors1: probs.wors1 / sum,
    wors2: probs.wors2 / sum,
  };
}

export function cyclesPerYear(cycleLengthYears) {
  return 1 / cycleLengthYears;
}

/** 導入期3ヶ月 → year1 → year2 → year3+ */
export function phaseForCycle(cycleIndex, cycleLengthYears) {
  const cpy = cyclesPerYear(cycleLengthYears);
  const inductionCycles = Math.max(1, Math.round((3 / 12) * cpy));
  if (cycleIndex < inductionCycles) return "induction";
  const maint = cycleIndex - inductionCycles;
  const y = Math.floor(maint / cpy);
  if (y === 0) return "year1";
  if (y === 1) return "year2";
  return "year3plus";
}

/** @param {number|null} treatmentDurationYears — null なら生涯治療 */
export function isOnTreatment(cycleIndex, cycleLengthYears, treatmentDurationYears) {
  if (treatmentDurationYears == null) return true;
  return cycleIndex * cycleLengthYears < treatmentDurationYears;
}

export function fmtJpy(n) {
  return new Intl.NumberFormat("ja-JP").format(Math.round(n));
}
