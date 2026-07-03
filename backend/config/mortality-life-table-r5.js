/**
 * 令和5年（2023）簡易生命表 — 年齢別年間死亡確率 nqx
 * 出典: 死亡率.pdf（厚生労働省 令和5年簡易生命表・男/女）
 * インデックス = 年齢 x（0–105）
 */

export const LIFE_TABLE_SOURCE =
  "令和5年（2023）簡易生命表 nqx — 厚生労働省（死亡率.pdf）";

export const R5_MALE_NQX = [
  0.00184, 0.00027, 0.00020, 0.00014, 0.00011, 0.00009, 0.00008, 0.00007,
  0.00007, 0.00006, 0.00006, 0.00007, 0.00009, 0.00012, 0.00015, 0.00018,
  0.00022, 0.00027, 0.00032, 0.00038, 0.00043, 0.00046, 0.00047, 0.00048,
  0.00049, 0.00050, 0.00051, 0.00051, 0.00052, 0.00054, 0.00055, 0.00056,
  0.00058, 0.00062, 0.00068, 0.00073, 0.00077, 0.00082, 0.00089, 0.00096,
  0.00102, 0.00108, 0.00113, 0.00121, 0.00132, 0.00147, 0.00162, 0.00179,
  0.00198, 0.00220, 0.00243, 0.00269, 0.00299, 0.00329, 0.00363, 0.00399,
  0.00440, 0.00484, 0.00530, 0.00579, 0.00633, 0.00700, 0.00780, 0.00867,
  0.00957, 0.01049, 0.01148, 0.01263, 0.01397, 0.01550, 0.01724, 0.01913,
  0.02125, 0.02361, 0.02601, 0.02839, 0.03109, 0.03432, 0.03820, 0.04270,
  0.04773, 0.05294, 0.05891, 0.06605, 0.07449, 0.08414, 0.09494, 0.10708,
  0.12056, 0.13556, 0.15182, 0.16762, 0.18601, 0.20610, 0.22798, 0.25176,
  0.27750, 0.30524, 0.33502, 0.36683, 0.40062, 0.43630, 0.47370, 0.51261,
  0.55275, 1.00000,
];

export const R5_FEMALE_NQX = [
  0.00175, 0.00024, 0.00018, 0.00013, 0.00010, 0.00008, 0.00007, 0.00006,
  0.00006, 0.00006, 0.00006, 0.00007, 0.00008, 0.00010, 0.00012, 0.00015,
  0.00018, 0.00021, 0.00023, 0.00026, 0.00027, 0.00028, 0.00028, 0.00029,
  0.00028, 0.00028, 0.00027, 0.00026, 0.00026, 0.00027, 0.00028, 0.00030,
  0.00032, 0.00035, 0.00038, 0.00041, 0.00043, 0.00046, 0.00049, 0.00054,
  0.00059, 0.00065, 0.00070, 0.00075, 0.00081, 0.00088, 0.00095, 0.00105,
  0.00116, 0.00130, 0.00146, 0.00160, 0.00175, 0.00188, 0.00200, 0.00211,
  0.00222, 0.00237, 0.00256, 0.00278, 0.00300, 0.00322, 0.00346, 0.00372,
  0.00402, 0.00437, 0.00474, 0.00519, 0.00572, 0.00633, 0.00703, 0.00781,
  0.00872, 0.00978, 0.01093, 0.01215, 0.01357, 0.01532, 0.01742, 0.01988,
  0.02269, 0.02581, 0.02965, 0.03438, 0.04004, 0.04654, 0.05374, 0.06202,
  0.07170, 0.08305, 0.09579, 0.10970, 0.12427, 0.14063, 0.16060, 0.18687,
  0.21209, 0.23876, 0.26690, 0.29647, 0.32744, 0.35974, 0.39328, 0.42794,
  0.46358, 1.00000,
];

/** Table S1 — 男性比率 61.4%（論文2 補足） */
export const DEFAULT_MALE_RATIO = 0.614;

function buildLxFromNqx(nqx) {
  const lx = new Array(nqx.length);
  lx[0] = 1;
  for (let x = 0; x < nqx.length - 1; x++) {
    lx[x + 1] = lx[x] * (1 - nqx[x]);
  }
  return lx;
}

const R5_MALE_LX = buildLxFromNqx(R5_MALE_NQX);
const R5_FEMALE_LX = buildLxFromNqx(R5_FEMALE_NQX);

function maleRatioFromOpts({ maleRatio = DEFAULT_MALE_RATIO, sex = null } = {}) {
  if (sex === "male") return 1;
  if (sex === "female") return 0;
  return maleRatio;
}

function lxTablesForRatio(maleRatio) {
  if (maleRatio >= 1) return { lx: R5_MALE_LX, nqx: R5_MALE_NQX };
  if (maleRatio <= 0) return { lx: R5_FEMALE_LX, nqx: R5_FEMALE_NQX };
  return null;
}

/** 非整数年齢の lx — 男女別またはブレンド */
export function lxAtAge(age, opts = {}) {
  const maleRatio = maleRatioFromOpts(opts);
  const a = Math.max(0, Math.min(105, age));
  const tables = lxTablesForRatio(maleRatio);
  if (tables) {
    const a0 = Math.floor(a);
    const a1 = Math.min(105, a0 + 1);
    if (a0 === a1) return tables.lx[a0];
    const t = a - a0;
    return tables.lx[a0] * (1 - t) + tables.lx[a1] * t;
  }
  return (
    maleRatio * lxAtAge(a, { maleRatio: 1 }) +
    (1 - maleRatio) * lxAtAge(a, { maleRatio: 0 })
  );
}

/**
 * 区間 [age, age + intervalYears) の生存確率 — 生命表 lx 比
 * 固定死亡率指定時は (1 − q)^t
 */
export function survivalProbability(
  age,
  intervalYears,
  { maleRatio = DEFAULT_MALE_RATIO, sex = null, fixedRate = null } = {}
) {
  if (intervalYears <= 0) return 1;
  const ratio = maleRatioFromOpts({ maleRatio, sex });
  if (fixedRate != null) {
    return Math.pow(1 - fixedRate, intervalYears);
  }
  const lx0 = lxAtAge(age, { maleRatio: ratio });
  const lx1 = lxAtAge(age + intervalYears, { maleRatio: ratio });
  if (lx0 <= 0) return 0;
  return Math.max(0, Math.min(1, lx1 / lx0));
}

/** 年齢 x の平均余命 e_x（年）— 生命表 lx から person-years / lx(age) */
export function remainingLifeExpectancy(
  age,
  { maleRatio = DEFAULT_MALE_RATIO, sex = null } = {}
) {
  const ratio = maleRatioFromOpts({ maleRatio, sex });
  const lxStart = lxAtAge(age, { maleRatio: ratio });
  if (lxStart <= 0) return 0;

  const endAge = 105;
  const span = endAge - age;
  if (span <= 0) return 0;

  let personYears = 0;
  const steps = 200;
  const dt = span / steps;
  for (let i = 0; i < steps; i++) {
    const t0 = age + i * dt;
    const t1 = age + (i + 1) * dt;
    personYears +=
      ((lxAtAge(t0, { maleRatio: ratio }) + lxAtAge(t1, { maleRatio: ratio })) / 2) * dt;
  }
  return personYears / lxStart;
}

/** サイクル死亡確率（生命表または固定 q） */
export function cycleDeathProbability(
  age,
  cycleLenYears,
  { maleRatio = DEFAULT_MALE_RATIO, sex = null, fixedRate = null } = {}
) {
  return 1 - survivalProbability(age, cycleLenYears, { maleRatio, sex, fixedRate });
}

export function nqxAtAge(age, maleRatio = DEFAULT_MALE_RATIO) {
  const a = Math.max(0, Math.min(105, Math.floor(age)));
  const qm = R5_MALE_NQX[a];
  const qf = R5_FEMALE_NQX[a];
  return maleRatio * qm + (1 - maleRatio) * qf;
}

/** 非整数年齢 — 線形補間 */
export function nqxAtAgeInterpolated(age, maleRatio = DEFAULT_MALE_RATIO) {
  const a = Math.max(0, Math.min(105, age));
  const a0 = Math.floor(a);
  const a1 = Math.min(105, a0 + 1);
  if (a0 === a1) return nqxAtAge(a0, maleRatio);
  const t = a - a0;
  return nqxAtAge(a0, maleRatio) * (1 - t) + nqxAtAge(a1, maleRatio) * t;
}
