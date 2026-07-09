import { useState, useMemo, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  ReferenceLine,
} from "recharts";
import {
  runAnalysisCached,
  runMortalitySensitivity,
  runSwitchCostMinimization,
  computeBreakEvenTable,
  buildAnnualCostCurve,
  runPatientDrugComparison,
  runPatientMidSwitchComparison,
  buildInjectionYearReference,
  getInjectionPhaseReference,
  DRUG_CATALOG,
  DRUG_IDS,
  PATIENT_DRUG_IDS,
  SUBTYPES,
  COST_PAPER_LIST,
  DEFAULT_COST_PAPER_ID,
  DEFAULT_HORIZON,
  DEFAULT_MODEL_PARAMS,
  DEFAULT_UTILITIES,
  DEFAULT_UTILITY_NONE,
  TREATMENT_DURATION_OPTIONS,
  TREATMENT_INTERVAL_OPTIONS,
  CLINICAL_CASE_OPTIONS,
  EVIDENCE_TIER_LABELS,
  INCOME_BRACKET_LIST,
  getCopayRate,
  describeMonthlyLimit,
  NHI_SOURCE_NOTE,
  listInjections2026MetaSummary,
  INJECTIONS_2026_META_SOURCE,
  getMarkovBaselineBcva,
} from "../backend/engine.js";
import { TREATMENT_DURATION_MODES } from "../backend/constants.js";
import { PAPER_INCREMENTAL_RBZ_VS_AFL, buildS12ModelParams, PAPER_S12_ENTRY_AGE } from "../backend/config/paper-reference.js";
import {
  MORTALITY_DEFAULTS,
  entryMortalityForSubtype,
  LIFE_TABLE_SOURCE,
  remainingLifeExpectancy,
} from "../backend/config/mortality.js";
import { fmtJpy } from "../backend/utils.js";
import { STATE_LABELS } from "../backend/constants.js";

const CYCLE_OPTIONS = [
  { value: 0.25, label: "3ヶ月（四半期）" },
  { value: 0.5, label: "6ヶ月" },
  { value: 1, label: "1年" },
];

const NARROW_QUERY = "(max-width: 760px)";

const SHAREABLE_TABS = ["summary", "patient", "switch", "vision"];

/** URL クエリから初期状態を読む（システム境界 — 不正値は無視して既定値に落とす） */
function readUrlState() {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const s = {};
  const tab = p.get("tab");
  if (SHAREABLE_TABS.includes(tab)) s.tab = tab;
  const age = parseInt(p.get("age") ?? "", 10);
  if (age >= 40 && age <= 100) s.age = String(age);
  const sex = p.get("sex");
  if (sex === "male" || sex === "female") s.sex = sex;
  const income = p.get("income");
  if (INCOME_BRACKET_LIST.some((b) => b.id === income)) s.income = income;
  const seed = parseInt(p.get("seed") ?? "", 10);
  if (Number.isFinite(seed)) s.seed = String(seed);
  const subtype = p.get("subtype");
  if (SUBTYPES[subtype]) s.subtype = subtype;
  const drug = p.get("drug");
  if (DRUG_CATALOG[drug]) s.drug = drug;
  const target = p.get("target");
  if (DRUG_CATALOG[target]) s.target = target;
  const interval = parseFloat(p.get("interval") ?? "");
  if (interval >= 2 && interval <= 32) s.interval = String(interval);
  if (p.get("explain") === "1") s.explain = true;
  return s;
}

const URL_INIT = readUrlState();

/** スマホ縦画面などの狭幅判定（リサイズ・回転に追従） */
function useIsNarrow() {
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches
  );
  useEffect(() => {
    const mql = window.matchMedia(NARROW_QUERY);
    const onChange = (e) => setIsNarrow(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isNarrow;
}

/** 幅の広いテーブルを画面外にはみ出させず横スクロールさせる */
function ScrollTable({ children }) {
  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      {children}
    </div>
  );
}

export default function App() {
  const isNarrow = useIsNarrow();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subtypeId, setSubtypeId] = useState(URL_INIT.subtype ?? "typical");
  const [costPaperId, setCostPaperId] = useState(DEFAULT_COST_PAPER_ID);
  const [clinicalCase, setClinicalCase] = useState("2026_meta");
  const [selectedDrugIds, setSelectedDrugIds] = useState(() => [...DRUG_IDS]);
  const [referenceDrugId, setReferenceDrugId] = useState("aflibercept_bs");
  const [treatmentDurationMode, setTreatmentDurationMode] = useState("years_5");
  const [timeHorizonYears, setTimeHorizonYears] = useState(
    DEFAULT_HORIZON.timeHorizonYears
  );
  const [cycleLengthYears, setCycleLengthYears] = useState(0.25);
  const [discountRate, setDiscountRate] = useState(2);
  const [activeTab, setActiveTab] = useState(URL_INIT.tab ?? "summary");
  const [utilityInputs, setUtilityInputs] = useState(
    DEFAULT_UTILITIES.map(String)
  );
  const [utilityNone, setUtilityNone] = useState(String(DEFAULT_UTILITY_NONE));
  const [annualMortality, setAnnualMortality] = useState(
    String(DEFAULT_MODEL_PARAMS.annualMortality ?? "")
  );
  const [blindMortalityHr, setBlindMortalityHr] = useState(
    String(DEFAULT_MODEL_PARAMS.blindMortalityHr ?? "")
  );
  const [secondEyeMonthly, setSecondEyeMonthly] = useState(
    String(DEFAULT_MODEL_PARAMS.secondEyeMonthlyIncidence ?? "")
  );
  const [includeScenarioAe, setIncludeScenarioAe] = useState(false);
  const [switchCurrentDrugId, setSwitchCurrentDrugId] = useState(
    URL_INIT.drug ?? "aflibercept_bs"
  );
  const [switchTargetDrugId, setSwitchTargetDrugId] = useState(
    URL_INIT.target ?? "aflibercept_8mg"
  );
  const [switchIntervalInput, setSwitchIntervalInput] = useState(
    URL_INIT.interval ?? "8"
  );
  const switchCurrentIntervalWeeks = parseFloat(switchIntervalInput);
  const switchIntervalValid =
    Number.isFinite(switchCurrentIntervalWeeks) && switchCurrentIntervalWeeks >= 2;
  const [patientAge, setPatientAge] = useState(URL_INIT.age ?? "75");
  const [patientSex, setPatientSex] = useState(URL_INIT.sex ?? "male");
  const [incomeBracket, setIncomeBracket] = useState(URL_INIT.income ?? "standard");
  const [patientSeed, setPatientSeed] = useState(URL_INIT.seed ?? "42");
  const markovBcvaTypical = getMarkovBaselineBcva("typical");
  const [patientBaselineBcvaAffected, setPatientBaselineBcvaAffected] = useState(
    () => String(markovBcvaTypical.baselineBcvaAffected)
  );
  const [patientBaselineBcvaFellow, setPatientBaselineBcvaFellow] = useState(
    () => String(markovBcvaTypical.baselineBcvaFellow)
  );
  const [patientDetailDrugId, setPatientDetailDrugId] = useState("ranibizumab_bs");
  const [patientExplainMode, setPatientExplainMode] = useState(URL_INIT.explain ?? false);
  const [midSwitchToDrugId, setMidSwitchToDrugId] = useState("aflibercept_bs");
  const [midSwitchYearInput, setMidSwitchYearInput] = useState("2");
  const [shareLinkCopied, setShareLinkCopied] = useState(false);

  const copyShareLink = () => {
    const p = new URLSearchParams({
      tab: activeTab,
      age: patientAge,
      sex: patientSex,
      income: incomeBracket,
      seed: patientSeed,
      subtype: subtypeId,
      drug: switchCurrentDrugId,
      target: switchTargetDrugId,
      interval: switchIntervalInput,
    });
    if (patientExplainMode) p.set("explain", "1");
    const url = `${window.location.origin}${window.location.pathname}?${p.toString()}`;
    navigator.clipboard?.writeText(url).then(() => {
      setShareLinkCopied(true);
      setTimeout(() => setShareLinkCopied(false), 2000);
    });
  };

  useEffect(() => {
    const bcva = getMarkovBaselineBcva(subtypeId);
    setPatientBaselineBcvaAffected(String(bcva.baselineBcvaAffected));
    setPatientBaselineBcvaFellow(String(bcva.baselineBcvaFellow));
  }, [subtypeId]);

  useEffect(() => {
    if (activeTab === "costs" || activeTab === "qaly") setActiveTab("summary");
  }, [activeTab]);

  const modelParams = useMemo(() => {
    const utilities = utilityInputs.map((v) => parseFloat(v));
    const validUtil =
      utilities.length === 5 && utilities.every((n) => !Number.isNaN(n));
    const uNone = parseFloat(utilityNone);
    const mort = parseFloat(annualMortality);
    const hr = parseFloat(blindMortalityHr);
    const inc = parseFloat(secondEyeMonthly);
    return {
      utilities: validUtil ? utilities : null,
      utilityNone: Number.isNaN(uNone) ? null : uNone,
      annualMortality:
        annualMortality.trim() === "" || Number.isNaN(mort) ? null : mort,
      useAgeSpecificMortality:
        annualMortality.trim() === "" || Number.isNaN(mort),
      maleRatio: DEFAULT_MODEL_PARAMS.maleRatio,
      blindMortalityHr: Number.isNaN(hr) ? null : hr,
      secondEyeMonthlyIncidence: Number.isNaN(inc) ? null : inc,
      adverseEvents: DEFAULT_MODEL_PARAMS.adverseEvents,
      includeScenarioAe,
    };
  }, [
    utilityInputs,
    utilityNone,
    annualMortality,
    blindMortalityHr,
    secondEyeMonthly,
    includeScenarioAe,
  ]);

  const patientRemainingLife = useMemo(() => {
    const age = parseFloat(patientAge);
    if (Number.isNaN(age)) return null;
    return remainingLifeExpectancy(age, { sex: patientSex });
  }, [patientAge, patientSex]);

  const treatmentDurationYears = TREATMENT_DURATION_MODES[treatmentDurationMode];

  const horizon = useMemo(
    () => ({
      timeHorizonYears: Number(timeHorizonYears),
      cycleLengthYears: Number(cycleLengthYears),
      discountRate: Number(discountRate) / 100,
    }),
    [timeHorizonYears, cycleLengthYears, discountRate]
  );

  const injections2026Meta = useMemo(
    () => listInjections2026MetaSummary(DRUG_CATALOG),
    []
  );

  const clinicalCaseHint =
    CLINICAL_CASE_OPTIONS.find((o) => o.id === clinicalCase)?.hint ?? "";

  const analysis = useMemo(
    () =>
      runAnalysisCached({
        selectedDrugIds,
        referenceDrugId,
        subtypeId,
        costPaperId,
        clinicalCase,
        horizon,
        treatmentDurationYears,
        modelParams,
      }),
    [
      selectedDrugIds,
      referenceDrugId,
      subtypeId,
      costPaperId,
      clinicalCase,
      horizon,
      treatmentDurationYears,
      modelParams,
    ]
  );

  const mortalitySensitivity = useMemo(() => {
    if (costPaperId !== "paper2_rbz" || activeTab !== "validate") return null;
    return runMortalitySensitivity({
      subtypeId,
      costPaperId: "paper2_rbz",
      horizon,
      modelParams,
      selectedDrugIds: ["ranibizumab_bs", "aflibercept"],
    });
  }, [subtypeId, costPaperId, horizon, modelParams, activeTab]);

  /** Table S12 照合行 — validate タブ表示時のみ計算(結果はエンジン側でキャッシュ) */
  const s12ValidationRows = useMemo(() => {
    if (costPaperId !== "paper2_rbz" || activeTab !== "validate") return null;
    const refS12 = SUBTYPES[subtypeId].referenceS12;
    return ["ranibizumab_bs", "aflibercept"]
      .map((id) => {
        const refv = refS12?.[id === "ranibizumab_bs" ? "rbz_bs" : "aflibercept"];
        if (!refv) return null;
        const scen = runAnalysisCached({
          selectedDrugIds: [id],
          subtypeId,
          costPaperId: "paper2_rbz",
          clinicalCase: "scenario",
          horizon,
          modelParams,
        }).results[id];
        return { id, refv, scen };
      })
      .filter(Boolean);
  }, [costPaperId, activeTab, subtypeId, horizon, modelParams]);

  /** 全サブタイプ — RBZ BS vs AFL（論文本文の増分と照合） */
  const paperIncrementalRows = useMemo(() => {
    if (costPaperId !== "paper2_rbz" || clinicalCase !== "base") return null;
    return (["typical", "pcv", "rap"]).map((sid) => {
      const a = runAnalysisCached({
        selectedDrugIds: ["ranibizumab_bs", "aflibercept"],
        referenceDrugId: "aflibercept",
        subtypeId: sid,
        costPaperId: "paper2_rbz",
        clinicalCase: "base",
        horizon,
        treatmentDurationYears,
        modelParams,
      });
      const ic = a.icerRows.find((r) => r.drugId === "ranibizumab_bs");
      const paper = PAPER_INCREMENTAL_RBZ_VS_AFL[sid];
      const rbz = a.results.ranibizumab_bs;
      const afl = a.results.aflibercept;
      return {
        subtypeId: sid,
        label: SUBTYPES[sid].label,
        rbzQaly: rbz?.totalQALY,
        aflQaly: afl?.totalQALY,
        rbzCost: rbz?.totalCost,
        aflCost: afl?.totalCost,
        toolDq: ic?.deltaQaly,
        toolDc: ic?.deltaCost,
        paperDq: paper?.deltaQaly,
        paperDc: paper?.deltaCost,
      };
    });
  }, [costPaperId, clinicalCase, horizon, treatmentDurationYears, modelParams]);

  const switchBreakEven = useMemo(() => {
    if (!switchIntervalValid) return null;
    const age = parseInt(patientAge, 10);
    return computeBreakEvenTable({
      currentDrugId: switchCurrentDrugId,
      currentIntervalWeeks: switchCurrentIntervalWeeks,
      costPaperId,
      wtpPerQaly: DEFAULT_HORIZON.wtpPerQaly,
      patient:
        age >= 40 && age <= 100 ? { age, incomeBracket } : null,
    });
  }, [
    switchIntervalValid,
    switchCurrentDrugId,
    switchCurrentIntervalWeeks,
    costPaperId,
    patientAge,
    incomeBracket,
  ]);

  const switchCostCurve = useMemo(
    () =>
      buildAnnualCostCurve({
        drugIds: DRUG_IDS,
        costPaperId,
        minWeeks: 4,
        maxWeeks: 24,
        stepWeeks: 1,
      }),
    [costPaperId]
  );

  const switchAnalysis = useMemo(() => {
    if (!switchIntervalValid) return null;
    return runSwitchCostMinimization({
      currentDrugId: switchCurrentDrugId,
      targetDrugId: switchTargetDrugId,
      currentIntervalWeeks: switchCurrentIntervalWeeks,
      subtypeId,
      costPaperId,
      clinicalCase,
      horizon,
      treatmentDurationYears,
      modelParams,
      wtpPerQaly: DEFAULT_HORIZON.wtpPerQaly,
    });
  }, [
      switchIntervalValid,
      switchCurrentDrugId,
      switchTargetDrugId,
      switchCurrentIntervalWeeks,
      subtypeId,
      costPaperId,
      clinicalCase,
      horizon,
      treatmentDurationYears,
      modelParams,
    ]);

  const { results, icerRows, missingParams } = analysis;
  const subtype = SUBTYPES[subtypeId];
  const costPaper = COST_PAPER_LIST.find((p) => p.id === costPaperId);

  const patientCompareDrugIds = DRUG_IDS;

  const patientAnalysis = useMemo(() => {
    const age = parseInt(patientAge, 10);
    const seed = parseInt(patientSeed, 10);
    if (Number.isNaN(age) || age < 40 || age > 100) return null;
    const bcvaAffected = parseFloat(patientBaselineBcvaAffected);
    const bcvaFellow = parseFloat(patientBaselineBcvaFellow);
    const patientBaseline = {};
    if (Number.isFinite(bcvaAffected)) patientBaseline.baselineBcvaAffected = bcvaAffected;
    if (Number.isFinite(bcvaFellow)) patientBaseline.baselineBcvaFellow = bcvaFellow;
    return runPatientDrugComparison({
      entryAge: age,
      sex: patientSex,
      subtypeId,
      costPaperId,
      clinicalCase,
      timeHorizonYears: Number(timeHorizonYears),
      treatmentDurationYears,
      discountRate: Number(discountRate) / 100,
      cycleLengthYears: Number(cycleLengthYears),
      incomeBracket,
      seed: Number.isNaN(seed) ? 42 : seed,
      modelParams,
      patientBaseline,
      selectedDrugIds: patientCompareDrugIds,
      includeTrajectory: true,
    });
  }, [
    patientAge,
    patientSex,
    subtypeId,
    costPaperId,
    clinicalCase,
    timeHorizonYears,
    treatmentDurationYears,
    discountRate,
    cycleLengthYears,
    incomeBracket,
    patientSeed,
    patientBaselineBcvaAffected,
    patientBaselineBcvaFellow,
    modelParams,
  ]);

  const patientDetailDrug =
    patientAnalysis?.results[patientDetailDrugId] ??
    patientAnalysis?.results[selectedDrugIds[0]];

  const patientSummaryRows = useMemo(
    () =>
      [...(patientAnalysis?.summary ?? [])].sort(
        (a, b) => (a.totalPatientOop ?? Infinity) - (b.totalPatientOop ?? Infinity)
      ),
    [patientAnalysis]
  );

  const patientAnnualData =
    patientDetailDrug?.annualTrajectory?.map((row) => ({
      year: row.year,
      age: row.age,
      patientOop: Math.round(row.patientOop / 1000),
      directMedical: Math.round(row.directMedical / 1000),
      cumPatientOop: Math.round(row.cumPatientOop / 1000),
    })) ?? [];

  const midSwitchYear = parseFloat(midSwitchYearInput);
  const midSwitchValid =
    Number.isFinite(midSwitchYear) && midSwitchYear >= 0.5 && midSwitchYear <= 30;
  const effectiveMidSwitchToDrugId =
    midSwitchToDrugId !== patientDetailDrugId
      ? midSwitchToDrugId
      : DRUG_IDS.find((id) => id !== patientDetailDrugId);

  const patientMidSwitch = useMemo(() => {
    const age = parseInt(patientAge, 10);
    const seed = parseInt(patientSeed, 10);
    if (Number.isNaN(age) || age < 40 || age > 100 || !midSwitchValid) return null;
    const bcvaAffected = parseFloat(patientBaselineBcvaAffected);
    const bcvaFellow = parseFloat(patientBaselineBcvaFellow);
    const patientBaseline = {};
    if (Number.isFinite(bcvaAffected)) patientBaseline.baselineBcvaAffected = bcvaAffected;
    if (Number.isFinite(bcvaFellow)) patientBaseline.baselineBcvaFellow = bcvaFellow;
    return runPatientMidSwitchComparison({
      entryAge: age,
      sex: patientSex,
      subtypeId,
      currentDrugId: patientDetailDrugId,
      switchToDrugId: effectiveMidSwitchToDrugId,
      switchAtYear: midSwitchYear,
      costPaperId,
      clinicalCase,
      timeHorizonYears: Number(timeHorizonYears),
      treatmentDurationYears,
      incomeBracket,
      seed: Number.isNaN(seed) ? 42 : seed,
      modelParams,
      patientBaseline,
    });
  }, [
    patientAge,
    patientSex,
    subtypeId,
    patientDetailDrugId,
    effectiveMidSwitchToDrugId,
    midSwitchYear,
    midSwitchValid,
    costPaperId,
    clinicalCase,
    timeHorizonYears,
    treatmentDurationYears,
    incomeBracket,
    patientSeed,
    patientBaselineBcvaAffected,
    patientBaselineBcvaFellow,
    modelParams,
  ]);

  const midSwitchChartData = useMemo(
    () =>
      patientMidSwitch?.monthly?.map((m) => ({
        month: m.month,
        year: Math.round((m.month / 12) * 10) / 10,
        cumOopContinue: Math.round(m.cumOopContinue / 1000),
        cumOopSwitch: Math.round(m.cumOopSwitch / 1000),
      })) ?? [],
    [patientMidSwitch]
  );

  /** 患者説明モード用 — 選択薬剤の負担サマリー（既算出の軌跡から抽出） */
  const explainSummary = useMemo(() => {
    if (!patientDetailDrug?.annualTrajectory?.length) return null;
    const y0 = patientDetailDrug.annualTrajectory[0];
    const injMonths = (patientDetailDrug.monthlyTrajectory ?? []).filter(
      (m) => m.year === 0 && m.injections > 0
    );
    const y5 = patientDetailDrug.annualTrajectory.filter((r) => r.year <= 4).at(-1);
    return {
      year1Oop: y0.patientOop,
      year1Inj: y0.injections,
      injMonthOop: injMonths.length
        ? Math.max(...injMonths.map((m) => m.patientOop))
        : null,
      fiveYearCum: y5?.cumPatientOop ?? null,
      totalOop: patientDetailDrug.totalPatientOop,
    };
  }, [patientDetailDrug]);

  const explainCompareRows = useMemo(
    () =>
      patientSummaryRows.map((row) => {
        const res = patientAnalysis?.results[row.drugId];
        const y0 = res?.annualTrajectory?.[0];
        const y5 = res?.annualTrajectory?.filter((r) => r.year <= 4).at(-1);
        return {
          drugId: row.drugId,
          name: row.name,
          year1: y0?.patientOop ?? null,
          fiveYear: y5?.cumPatientOop ?? null,
          total: row.totalPatientOop,
        };
      }),
    [patientSummaryRows, patientAnalysis]
  );

  const injectionReference = useMemo(() => {
    if (!patientDetailDrugId) return null;
    return buildInjectionYearReference({
      subtypeId,
      drugId: patientDetailDrugId,
      clinicalCase,
      timeHorizonYears: Number(timeHorizonYears),
      treatmentDurationYears,
      drugCatalog: DRUG_CATALOG,
    });
  }, [
    patientDetailDrugId,
    subtypeId,
    clinicalCase,
    timeHorizonYears,
    treatmentDurationYears,
  ]);

  const injectionPhaseRef = useMemo(() => {
    if (!patientDetailDrugId) return null;
    return getInjectionPhaseReference(
      clinicalCase,
      subtypeId,
      patientDetailDrugId,
      DRUG_CATALOG
    );
  }, [patientDetailDrugId, subtypeId, clinicalCase]);

  const toggleDrug = (id) => {
    setSelectedDrugIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const costBreakdownData = selectedDrugIds
    .filter((id) => results[id]?.totalCost != null)
    .map((id) => {
      const bd = results[id].costBreakdown ?? {};
      const drugAdmin = bd.drugAdmin ?? 0;
      const monitoring = bd.monitoring ?? 0;
      const adverseEvents = bd.adverseEvents ?? 0;
      const societalCare = bd.societalCare ?? 0;
      const physicianVisit = bd.physicianVisit ?? 0;
      const societal = societalCare + physicianVisit;
      const total = results[id].totalCost;
      const toM = (v) => Math.round(v / 1_000_000);
      return {
        drugId: id,
        name: DRUG_CATALOG[id].name,
        color: DRUG_CATALOG[id].color,
        total,
        drugAdmin,
        monitoring,
        adverseEvents,
        societalCare,
        physicianVisit,
        societal,
        drugM: toM(drugAdmin),
        monitoringM: toM(monitoring),
        adverseEventsM: toM(adverseEvents),
        societalM: toM(societal),
        societalCareM: toM(societalCare),
        physicianVisitM: toM(physicianVisit),
        totalM: toM(total),
        chartStackM: toM(drugAdmin + societal),
      };
    });

  const costChartData = costBreakdownData.map(
    ({ name, drugM, societalM, color }) => ({
      name,
      drug: drugM,
      societal: societalM,
      color,
    })
  );

  const trajectoryDrugs = selectedDrugIds.filter((id) =>
    results[id]?.trajectory?.some((t) => t.cumQALY != null)
  );

  const hasQalyTrajectory = trajectoryDrugs.length > 0;

  const trajectoryLength = Math.max(
    0,
    ...trajectoryDrugs.map((id) => results[id].trajectory.length)
  );

  const trajectoryData = Array.from({ length: trajectoryLength }, (_, i) => {
    const row = {
      year:
        trajectoryDrugs
          .map((id) => results[id]?.trajectory?.[i]?.year)
          .find((y) => y != null) ?? i,
    };
    trajectoryDrugs.forEach((id) => {
      const t = results[id]?.trajectory?.[i];
      if (t?.cumQALY != null) row[id] = parseFloat(t.cumQALY);
    });
    return row;
  });

  const visionTrajectoryDrugs = selectedDrugIds.filter(
    (id) => results[id]?.trajectory?.some((t) => t.meanBcva != null)
  );

  const hasVisionTrajectory = visionTrajectoryDrugs.length > 0;

  const visionTrajectoryLength = Math.max(
    0,
    ...visionTrajectoryDrugs.map((id) => results[id].trajectory.length)
  );

  const visionTrajectoryData = Array.from({ length: visionTrajectoryLength }, (_, i) => {
    const row = {
      year:
        visionTrajectoryDrugs
          .map((id) => results[id]?.trajectory?.[i]?.year)
          .find((y) => y != null) ?? i,
    };
    visionTrajectoryDrugs.forEach((id) => {
      const t = results[id]?.trajectory?.[i];
      if (t?.meanBcva != null) row[id] = parseFloat(t.meanBcva);
    });
    return row;
  });

  const hasIncompleteResults = selectedDrugIds.some((id) => results[id]?.incomplete);
  const showIssuesTab = missingParams.length > 0 || hasIncompleteResults;

  const formatIcer = (row) => {
    if (typeof row.icer === "number") return `¥${fmtJpy(row.icer)}/QALY`;
    return row.icer;
  };

  return (
    <div
      className="app-root"
      style={{ fontFamily: "'Noto Sans JP', sans-serif", background: "#F1F5F9", minHeight: "100vh" }}
    >
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .app-grid { display: block !important; }
          .app-root { background: #fff !important; }
        }
      `}</style>
      <header
        className="no-print"
        style={{
          background: "linear-gradient(135deg, #0F172A 0%, #1E40AF 100%)",
          color: "#fff",
          padding: isNarrow ? "14px 16px" : "20px 28px",
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.75 }}>
          nAMD CEA • 5状態 Markov • 両眼モデル
        </div>
        <h1 style={{ margin: "6px 0 4px", fontSize: isNarrow ? 17 : 22 }}>抗VEGF 薬剤 費用対効果計算機</h1>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.85 }}>
          QALY・Cost — ラニビズマブ / アフリベルセプト / ファリシマブ / ブロルシズマブ / BS 製剤
        </p>
        <button
          type="button"
          onClick={copyShareLink}
          style={{
            marginTop: 10,
            padding: "5px 12px",
            fontSize: 11,
            fontWeight: 600,
            border: "1px solid rgba(255,255,255,0.4)",
            borderRadius: 6,
            background: "rgba(255,255,255,0.12)",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          {shareLinkCopied ? "コピーしました ✓" : "設定リンクをコピー（患者条件を URL で共有）"}
        </button>
      </header>

      <div
        className="app-grid"
        style={{
          display: "grid",
          gridTemplateColumns: isNarrow ? "1fr" : "minmax(300px, 340px) 1fr",
          gap: 0,
          maxWidth: 1280,
          margin: "0 auto",
        }}
      >
        <aside
          className="no-print"
          style={{
            background: "#fff",
            borderRight: isNarrow ? "none" : "1px solid #E2E8F0",
            borderBottom: isNarrow ? "1px solid #E2E8F0" : "none",
            padding: isNarrow ? "12px 16px" : 20,
            fontSize: 13,
          }}
        >
          {isNarrow && (
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              style={{
                width: "100%",
                padding: "10px 14px",
                fontSize: 13,
                fontWeight: 600,
                border: "1px solid #CBD5E1",
                borderRadius: 8,
                background: settingsOpen ? "#1E40AF" : "#fff",
                color: settingsOpen ? "#fff" : "#1E293B",
                cursor: "pointer",
                marginBottom: settingsOpen ? 16 : 0,
              }}
            >
              モデル設定（薬剤・パラメータ）{settingsOpen ? "を閉じる ▲" : "を開く ▼"}
            </button>
          )}
          <div style={{ display: isNarrow && !settingsOpen ? "none" : "block" }}>
          <Section title="コストの出典（論文）">
            <select
              value={costPaperId}
              onChange={(e) => setCostPaperId(e.target.value)}
              style={selectStyle}
            >
              {COST_PAPER_LIST.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <p style={hintStyle}>{costPaper?.description}</p>
          </Section>

          <Section title="治療期間・割引">
            <label style={labelStyle}>
              抗VEGF治療期間
              <select
                value={treatmentDurationMode}
                onChange={(e) => setTreatmentDurationMode(e.target.value)}
                style={selectStyle}
              >
                {TREATMENT_DURATION_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {treatmentDurationYears != null && (
              <p style={hintStyle}>
                {treatmentDurationYears}年後は BSC（自然経過・BSCモニタリング）に切替。QALY・コストとも治療中止後は BSC 経路で算出します。
              </p>
            )}
            <label style={labelStyle}>
              解析期間（年）
              <input
                type="number"
                min={1}
                max={40}
                value={timeHorizonYears}
                onChange={(e) => setTimeHorizonYears(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              サイクル長
              <select
                value={cycleLengthYears}
                onChange={(e) => setCycleLengthYears(Number(e.target.value))}
                style={selectStyle}
              >
                {CYCLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              割引率（% / 年）
              <input
                type="number"
                step={0.5}
                min={0}
                max={10}
                value={discountRate}
                onChange={(e) => setDiscountRate(e.target.value)}
                style={inputStyle}
              />
            </label>
          </Section>

          <Section title="臨床入力（5状態・両眼）">
            <label style={labelStyle}>
              nAMD サブタイプ
              <select
                value={subtypeId}
                onChange={(e) => setSubtypeId(e.target.value)}
                style={selectStyle}
              >
                {Object.entries(SUBTYPES).map(([k, s]) => (
                  <option key={k} value={k}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              遷移・注射回数
              <select
                value={clinicalCase}
                onChange={(e) => setClinicalCase(e.target.value)}
                style={selectStyle}
              >
                {CLINICAL_CASE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ fontSize: 11, color: "#64748B", lineHeight: 1.5 }}>
              ベースライン（{subtype.baselineSource ?? "—"}）
              <br />
              初期分布: {subtype.initialDistributionSource ?? "Table S2"}
              <br />
              {clinicalCaseHint}
              <br />
              両眼罹患 {subtype.bothEyesBaseline * 100}% • 年齢 {subtype.meanAge}歳
              <br />
              平均 BCVA 患眼 {subtype.baselineBcvaAffected} • 対側眼{" "}
              {subtype.baselineBcvaFellow}
            </div>
            {clinicalCase === "2026_meta" && (
              <div
                style={{
                  fontSize: 11,
                  color: "#475569",
                  marginTop: 8,
                  padding: 8,
                  background: "#F1F5F9",
                  borderRadius: 6,
                  lineHeight: 1.5,
                }}
              >
                <strong>{INJECTIONS_2026_META_SOURCE}</strong>
                <table style={{ width: "100%", marginTop: 6, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #CBD5E1" }}>
                      <th style={{ padding: "2px 4px" }}>薬剤</th>
                      <th style={{ padding: "2px 4px" }}>1年目</th>
                      <th style={{ padding: "2px 4px" }}>2年目以降</th>
                    </tr>
                  </thead>
                  <tbody>
                    {injections2026Meta.map((row) => (
                      <tr key={row.drugId}>
                        <td style={{ padding: "2px 4px" }}>{row.name}</td>
                        <td style={{ padding: "2px 4px" }}>{row.year1}</td>
                        <td style={{ padding: "2px 4px" }}>{row.year2plus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ margin: "6px 0 0", color: "#64748B" }}>
                  サブタイプ共通。導入期（最初3か月）は 3.0 回。2年目以降は原則 year1 − 3。
                  AFL 8 mg は Q16 維持相当（52/16=3.25回/年）を使用。
                </p>
              </div>
            )}
          </Section>

          <Section title="QALY パラメータ">
            <p style={hintStyle}>
              Markov 5状態（BCVA）の遷移から較好眼効用を算出。3ヶ月サイクル・半周期補正・2%割引（論文準拠）。
            </p>
            {STATE_LABELS.map((lbl, i) => (
              <label key={lbl} style={labelStyle}>
                効用 — {lbl}
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={1}
                  value={utilityInputs[i]}
                  onChange={(e) => {
                    const next = [...utilityInputs];
                    next[i] = e.target.value;
                    setUtilityInputs(next);
                  }}
                  placeholder="0.00–1.00"
                  style={inputStyle}
                />
              </label>
            ))}
            <label style={labelStyle}>
              効用 — 非罹患時
              <input
                type="number"
                step={0.01}
                value={utilityNone}
                onChange={(e) => setUtilityNone(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              年間死亡率 qx（空欄＝年齢別生命表）
              <input
                type="number"
                step={0.0001}
                placeholder={entryMortalityForSubtype(SUBTYPES[subtypeId].meanAge).toFixed(4)}
                value={annualMortality}
                onChange={(e) => setAnnualMortality(e.target.value)}
                style={inputStyle}
              />
            </label>
            <p style={{ fontSize: 11, color: "#64748B", margin: "4px 0 0" }}>
              {LIFE_TABLE_SOURCE}。空欄時は lx 比から区間生存率を算出（余命表準拠）。男性比率{" "}
              {((DEFAULT_MODEL_PARAMS.maleRatio ?? 0.614) * 100).toFixed(1)}%。
              平均年齢 {SUBTYPES[subtypeId].meanAge} 歳: qx ≈{" "}
              {entryMortalityForSubtype(SUBTYPES[subtypeId].meanAge).toFixed(4)}、余命 ≈{" "}
              {remainingLifeExpectancy(SUBTYPES[subtypeId].meanAge).toFixed(1)} 年。
              感度分析では固定 qx 0.02–0.04 を上書き。
            </p>
            <label style={labelStyle}>
              失明時死亡 HR（文献目安 1.3–1.5、既定 {MORTALITY_DEFAULTS.blindMortalityHr}）
              <input
                type="number"
                step={0.01}
                value={blindMortalityHr}
                onChange={(e) => setBlindMortalityHr(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              他眼発症率 (/月 : 年率~10%、既定 {MORTALITY_DEFAULTS.secondEyeMonthlyIncidence})
              <input
                type="number"
                step={0.0001}
                value={secondEyeMonthly}
                onChange={(e) => setSecondEyeMonthly(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={includeScenarioAe}
                onChange={(e) => setIncludeScenarioAe(e.target.checked)}
              />
              網膜動脈閉塞（シナリオ AE 0.072%）を含める
            </label>
          </Section>

          <Section title="個別患者（保険負担）">
            <label style={labelStyle}>
              参入年齢
              <input
                type="number"
                min={40}
                max={100}
                value={patientAge}
                onChange={(e) => setPatientAge(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              性別
              <select
                value={patientSex}
                onChange={(e) => setPatientSex(e.target.value)}
                style={selectStyle}
              >
                <option value="male">男性</option>
                <option value="female">女性</option>
              </select>
            </label>
            <label style={labelStyle}>
              所得区分（高額療養費）
              <select
                value={incomeBracket}
                onChange={(e) => setIncomeBracket(e.target.value)}
                style={selectStyle}
              >
                {INCOME_BRACKET_LIST.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              ベースライン視力 — 患眼 BCVA（Markov ベースケース既定: {subtype.baselineBcvaAffected}）
              <input
                type="number"
                step={0.01}
                min={0}
                max={2}
                value={patientBaselineBcvaAffected}
                onChange={(e) => setPatientBaselineBcvaAffected(e.target.value)}
                style={inputStyle}
                placeholder={String(subtype.baselineBcvaAffected)}
              />
            </label>
            <label style={labelStyle}>
              ベースライン視力 — 対側眼 BCVA（Markov 既定: {subtype.baselineBcvaFellow}）
              <input
                type="number"
                step={0.01}
                min={0}
                max={2}
                value={patientBaselineBcvaFellow}
                onChange={(e) => setPatientBaselineBcvaFellow(e.target.value)}
                style={inputStyle}
                placeholder={String(subtype.baselineBcvaFellow)}
              />
            </label>
            <p style={{ ...hintStyle, marginTop: -4 }}>
              病型切替で Markov ベースケース（Yoneda [1]）の BCVA に自動リセット。
              既定値のとき初期分布は Table S2（Markov と同一）、変更時は BCVA から導出。
            </p>
            <label style={labelStyle}>
              乱数シード（仮想患者 ID）
              <input
                type="number"
                value={patientSeed}
                onChange={(e) => setPatientSeed(e.target.value)}
                style={inputStyle}
              />
            </label>
            <p style={hintStyle}>
              月次で直接医療費・高額療養費上限を適用。解析期間は min(設定, 余命)。
              個別患者タブは全7薬剤を表示。各薬剤は clinicalKey=drugId で独立し、
              注射回数は病型（typical/PCV/RAP）× 薬剤別 Table S6 実臨床データ、
              視力遷移は transitionKey（rbz_bs / aflibercept）を使用。
              <br />
              <strong>乱数シード</strong>（現在: {patientSeed || "42"}）は、フォロー期間（最長生存タイムライン）の
              視力遷移・両眼発症に使う乱数列の番号です。同じ seed なら結果を再現でき、変えると別の経路になります。
              注射回数・薬価は薬剤ごとに異なります。
              {patientRemainingLife != null && (
                <>
                  {" "}
                  余命（生命表）≈ {patientRemainingLife.toFixed(1)} 年。
                </>
              )}
            </p>
          </Section>

          <Section title="薬剤選択（比較）">
            {DRUG_IDS.map((id) => {
              const d = DRUG_CATALOG[id];
              const price = costPaper?.drugPrices[id];
              return (
                <label
                  key={id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    marginBottom: 8,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedDrugIds.includes(id)}
                    onChange={() => toggleDrug(id)}
                    style={{ marginTop: 3, accentColor: d.color }}
                  />
                  <span>
                    <span style={{ fontWeight: 600, color: d.color }}>{d.name}</span>
                    <br />
                    <span style={{ fontSize: 10, color: "#94A3B8" }}>
                      {price != null ? `¥${fmtJpy(price)}` : "薬価未設定"}
                    </span>
                  </span>
                </label>
              );
            })}
            <label style={{ ...labelStyle, marginTop: 8 }}>
              ICER 参照薬
              <select
                value={referenceDrugId}
                onChange={(e) => setReferenceDrugId(e.target.value)}
                style={selectStyle}
              >
                {selectedDrugIds.map((id) => (
                  <option key={id} value={id}>
                    {DRUG_CATALOG[id].name}
                  </option>
                ))}
              </select>
            </label>
          </Section>
          </div>
        </aside>

        <main style={{ padding: isNarrow ? 12 : 20 }}>
          <nav
            className="no-print"
            style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}
          >
            {[
              ["summary", "CEA Summary"],
              ["patient", "Pt Simulation"],
              ["switch", "スイッチ CMA"],
              ["vision", "視力推移"],
              ...(showIssuesTab
                ? [["missing", `要確認 (${missingParams.length + (hasIncompleteResults ? 1 : 0)})`]]
                : []),
              ...(costPaperId === "paper2_rbz"
                ? [["validate", "Table S12 照合"]]
                : []),
            ].map(([tab, label]) => (
              <TabButton
                key={tab}
                active={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                label={label}
              />
            ))}
          </nav>

          <SimulationDisclaimer />

          {activeTab === "summary" && (
            <Panel
              title={`結果 — ${subtype.label} • ${costPaper?.label} • 治療 ${
                TREATMENT_DURATION_OPTIONS.find((o) => o.id === treatmentDurationMode)
                  ?.label ?? ""
              }`}
            >
              <ScrollTable>
              <table style={{ ...tableStyle, minWidth: 560 }}>
                <thead>
                  <tr style={{ background: "#0F172A", color: "#fff" }}>
                    <th style={thStyle}>薬剤</th>
                    <th style={thStyle}>QALY</th>
                    <th style={thStyle}>総コスト</th>
                    <th style={thStyle}>注射回数</th>
                    <th style={thStyle}>ΔQALY</th>
                    <th style={thStyle}>Δコスト</th>
                    <th style={thStyle}>ICER</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDrugIds.map((id, i) => {
                    const r = results[id];
                    const ic = icerRows.find((x) => x.drugId === id);
                    return (
                      <tr key={id} style={{ background: i % 2 ? "#fff" : "#F8FAFC" }}>
                        <td style={tdStyle}>
                          <span style={{ fontWeight: 600, color: DRUG_CATALOG[id].color }}>
                            {DRUG_CATALOG[id].name}
                          </span>
                          {r?.warnings?.map((w) => (
                            <div key={w} style={{ fontSize: 10, color: "#B45309" }}>
                              {w}
                            </div>
                          ))}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {r?.totalQALY != null ? r.totalQALY.toFixed(3) : "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {r?.totalCost != null ? `¥${fmtJpy(r.totalCost)}` : "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {r?.totalInjections != null ? `${r.totalInjections.toFixed(1)}回` : "—"}
                          {r?.tableExpectedInjections != null &&
                            Math.abs(r.totalInjections - r.tableExpectedInjections) > 0.05 && (
                              <div style={{ fontSize: 10, color: "#64748B" }}>
                                (Table {r.tableExpectedInjections.toFixed(1)})
                              </div>
                            )}
                          {DRUG_CATALOG[id].injectionReference && (
                            <div style={{ fontSize: 10, color: "#B45309" }}>参考(S6暫定)</div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {ic?.deltaQaly != null
                            ? (ic.deltaQaly > 0 ? "+" : "") + ic.deltaQaly.toFixed(3)
                            : "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {ic?.deltaCost != null ? `¥${fmtJpy(ic.deltaCost)}` : "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
                          {formatIcer(ic)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </ScrollTable>

              <div style={{ marginTop: 28 }}>
                <h3 style={{ fontSize: 15, margin: "0 0 8px", color: "#0F172A" }}>
                  累積 QALY 推移
                </h3>
                {!hasQalyTrajectory ? (
                  <p style={{ color: "#B45309", fontSize: 13 }}>
                    効用パラメータが未設定のため QALY 曲線を表示できません。左サイドバー「QALY
                    パラメータ」を確認してください。
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={trajectoryData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="year" label={{ value: "年", position: "insideBottom", offset: -4 }} />
                      <YAxis label={{ value: "累積 QALY", angle: -90, position: "insideLeft" }} />
                      <Tooltip />
                      <Legend />
                      {trajectoryDrugs.map((id) => (
                        <Line
                          key={id}
                          type="monotone"
                          dataKey={id}
                          name={DRUG_CATALOG[id].name}
                          stroke={DRUG_CATALOG[id].color}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {costBreakdownData.length > 0 && (
                <div style={{ marginTop: 28 }}>
                  <h3 style={{ fontSize: 15, margin: "0 0 8px", color: "#0F172A" }}>
                    コスト内訳
                  </h3>
                  <p style={{ fontSize: 12, color: "#64748B", marginBottom: 12, lineHeight: 1.6 }}>
                    積み上げ棒グラフは薬剤+投与（青）と社会的費用＝介護+通院（灰）を百万円単位で表示。
                    下表にグラフの元データ（円・百万円）とモニタリング・有害事象を併記。
                  </p>
                  <ResponsiveContainer width="100%" height={360}>
                    <BarChart data={costChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis label={{ value: "百万円", angle: -90, position: "insideLeft" }} />
                      <Tooltip formatter={(v) => `${v} 百万円`} />
                      <Legend />
                      <Bar dataKey="drug" name="薬剤+投与" stackId="a" fill="#3B82F6" />
                      <Bar dataKey="societal" name="社会的費用" stackId="a" fill="#94A3B8" />
                    </BarChart>
                  </ResponsiveContainer>
                  <table style={{ ...tableStyle, marginTop: 16 }}>
                    <thead>
                      <tr style={{ background: "#334155", color: "#fff" }}>
                        <th style={thStyle}>薬剤</th>
                        <th style={thStyle}>薬剤+投与</th>
                        <th style={thStyle}>社会的費用</th>
                        <th style={thStyle}>グラフ合計</th>
                        <th style={thStyle}>モニタリング</th>
                        <th style={thStyle}>有害事象</th>
                        <th style={thStyle}>総コスト</th>
                      </tr>
                      <tr style={{ background: "#475569", color: "#fff", fontSize: 10 }}>
                        <th style={thStyle} />
                        <th style={thStyle} colSpan={6}>
                          上段＝円 / 下段＝百万円（グラフは薬剤+投与・社会的費用のみ積上げ）
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {costBreakdownData.map((row, i) => (
                        <tr key={row.drugId} style={{ background: i % 2 ? "#fff" : "#F8FAFC" }}>
                          <td style={tdStyle}>
                            <span style={{ fontWeight: 600, color: row.color }}>{row.name}</span>
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            ¥{fmtJpy(row.drugAdmin)}
                            <div style={{ fontSize: 10, color: "#64748B" }}>{row.drugM} M¥</div>
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            ¥{fmtJpy(row.societal)}
                            <div style={{ fontSize: 10, color: "#64748B" }}>{row.societalM} M¥</div>
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
                            {row.chartStackM} M¥
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            ¥{fmtJpy(row.monitoring)}
                            <div style={{ fontSize: 10, color: "#64748B" }}>{row.monitoringM} M¥</div>
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            ¥{fmtJpy(row.adverseEvents)}
                            <div style={{ fontSize: 10, color: "#64748B" }}>{row.adverseEventsM} M¥</div>
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
                            ¥{fmtJpy(row.total)}
                            <div style={{ fontSize: 10, color: "#64748B" }}>{row.totalM} M¥</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {paperIncrementalRows && (
                <div style={{ marginTop: 20 }}>
                  <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>
                    論文本文との照合（RBZ BS vs アフリベルセプト・全サブタイプ）
                  </h3>
                  <p style={{ fontSize: 11, color: "#64748B", marginBottom: 10, lineHeight: 1.5 }}>
                    論文: 社会的視点のサブタイプ解析における増分（Δ = RBZ BS − AFL）。
                    患者視点・BSC 比較・先製 RBZ 比較はコスト構造が異なるため未実装です。
                  </p>
                  <ScrollTable>
                  <table style={{ ...tableStyle, minWidth: 640 }}>
                    <thead>
                      <tr style={{ background: "#1E3A5F", color: "#fff" }}>
                        <th style={thStyle}>サブタイプ</th>
                        <th style={thStyle}>RBZ QALY</th>
                        <th style={thStyle}>AFL QALY</th>
                        <th style={thStyle}>ΔQALY（ツール）</th>
                        <th style={thStyle}>ΔQALY（論文）</th>
                        <th style={thStyle}>Δコスト（ツール）</th>
                        <th style={thStyle}>Δコスト（論文）</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paperIncrementalRows.map((row, i) => (
                        <tr
                          key={row.subtypeId}
                          style={{
                            background:
                              row.subtypeId === subtypeId
                                ? "#EFF6FF"
                                : i % 2
                                  ? "#fff"
                                  : "#F8FAFC",
                            fontWeight: row.subtypeId === subtypeId ? 600 : 400,
                          }}
                        >
                          <td style={tdStyle}>{row.label}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            {row.rbzQaly?.toFixed(3) ?? "—"}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            {row.aflQaly?.toFixed(3) ?? "—"}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            {row.toolDq != null
                              ? (row.toolDq > 0 ? "+" : "") + row.toolDq.toFixed(3)
                              : "—"}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            {row.paperDq != null
                              ? (row.paperDq > 0 ? "+" : "") + row.paperDq.toFixed(3)
                              : "—"}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            {row.toolDc != null ? `¥${fmtJpy(row.toolDc)}` : "—"}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            {row.paperDc != null ? `¥${fmtJpy(row.paperDc)}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </ScrollTable>
                  <p style={{ fontSize: 11, color: "#B45309", marginTop: 8 }}>
                    本ツールの QALY 水準は Table S12（7–8 QALY）より高く、絶対値の一致より増分の方向性を確認してください。
                  </p>
                </div>
              )}
            </Panel>
          )}

          {activeTab === "patient" && (
            <Panel
              title={`治療シミュレーション — ${patientSex === "male" ? "男性" : "女性"} ${patientAge}歳 • ${subtype.label} • 高額療養費（月次）`}
            >
              {!patientAnalysis ? (
                <p style={{ color: "#B45309" }}>参入年齢（40–100）を入力してください。</p>
              ) : (
                <>
                  <div
                    className="no-print"
                    style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}
                  >
                    <button
                      type="button"
                      onClick={() => setPatientExplainMode((v) => !v)}
                      style={{
                        padding: "8px 14px",
                        fontSize: 12,
                        fontWeight: 600,
                        border: "1px solid #CBD5E1",
                        borderRadius: 6,
                        cursor: "pointer",
                        background: patientExplainMode ? "#1E40AF" : "#fff",
                        color: patientExplainMode ? "#fff" : "#1E293B",
                      }}
                    >
                      {patientExplainMode
                        ? "詳細表示に戻る"
                        : "患者説明モード（簡易表示）"}
                    </button>
                    {patientExplainMode && (
                      <button
                        type="button"
                        onClick={() => window.print()}
                        style={{
                          padding: "8px 14px",
                          fontSize: 12,
                          fontWeight: 600,
                          border: "1px solid #CBD5E1",
                          borderRadius: 6,
                          cursor: "pointer",
                          background: "#fff",
                          color: "#1E293B",
                        }}
                      >
                        印刷 / PDF 保存
                      </button>
                    )}
                  </div>

                  {patientExplainMode && explainSummary ? (
                    <div>
                      <div style={{ fontSize: 14, color: "#334155", marginBottom: 8, lineHeight: 1.7 }}>
                        <strong style={{ fontSize: 16, color: DRUG_CATALOG[patientDetailDrugId].color }}>
                          {DRUG_CATALOG[patientDetailDrugId].name}
                        </strong>
                        {" "}で治療した場合の窓口負担のめやす（
                        {patientSex === "male" ? "男性" : "女性"} {patientAge}歳 ・{" "}
                        {INCOME_BRACKET_LIST.find((b) => b.id === incomeBracket)?.label}）
                      </div>
                      <div className="no-print" style={{ marginBottom: 16 }}>
                        <label style={{ ...labelStyle, display: "inline-flex", alignItems: "center", gap: 8 }}>
                          薬剤を変える
                          <select
                            value={patientDetailDrugId}
                            onChange={(e) => setPatientDetailDrugId(e.target.value)}
                            style={{ ...selectStyle, width: 220, marginTop: 0 }}
                          >
                            {patientCompareDrugIds.map((id) => (
                              <option key={id} value={id}>
                                {DRUG_CATALOG[id].name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                          gap: 12,
                          marginBottom: 20,
                        }}
                      >
                        <ExplainMetric
                          label="注射がある月の負担"
                          value={
                            explainSummary.injMonthOop != null
                              ? `約 ¥${fmtJpy(explainSummary.injMonthOop)}`
                              : "—"
                          }
                          sub="高額療養費の月上限を適用"
                        />
                        <ExplainMetric
                          label="最初の1年間の合計"
                          value={`約 ¥${fmtJpy(explainSummary.year1Oop)}`}
                          sub={`注射 ${explainSummary.year1Inj} 回`}
                        />
                        <ExplainMetric
                          label="5年間の合計"
                          value={
                            explainSummary.fiveYearCum != null
                              ? `約 ¥${fmtJpy(explainSummary.fiveYearCum)}`
                              : "—"
                          }
                        />
                        <ExplainMetric
                          label="通院期間全体の合計"
                          value={`約 ¥${fmtJpy(explainSummary.totalOop)}`}
                          sub="生涯のめやす"
                        />
                      </div>

                      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>自己負担の積み上がり（万円）</h3>
                      <ResponsiveContainer width="100%" height={240}>
                        <LineChart
                          data={
                            patientDetailDrug?.annualTrajectory?.map((r) => ({
                              year: r.year + 1,
                              cum: Math.round(r.cumPatientOop / 10000),
                            })) ?? []
                          }
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="year" label={{ value: "経過年", position: "insideBottom", offset: -4 }} />
                          <YAxis />
                          <Tooltip formatter={(v) => [`約 ${v} 万円`, "累積自己負担"]} labelFormatter={(y) => `${y}年目まで`} />
                          <Line type="monotone" dataKey="cum" stroke="#1E40AF" strokeWidth={3} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>

                      <h3 style={{ fontSize: 14, margin: "20px 0 8px" }}>他の薬剤とのくらべ（自己負担）</h3>
                      <ScrollTable>
                        <table style={tableStyle}>
                          <thead>
                            <tr style={{ background: "#0F172A", color: "#fff" }}>
                              <th style={thStyle}>薬剤</th>
                              <th style={{ ...thStyle, textAlign: "right" }}>最初の1年</th>
                              <th style={{ ...thStyle, textAlign: "right" }}>5年間</th>
                              <th style={{ ...thStyle, textAlign: "right" }}>通院期間全体</th>
                            </tr>
                          </thead>
                          <tbody>
                            {explainCompareRows.map((row, i) => (
                              <tr
                                key={row.drugId}
                                style={{
                                  background:
                                    row.drugId === patientDetailDrugId
                                      ? "#EFF6FF"
                                      : i % 2
                                        ? "#fff"
                                        : "#F8FAFC",
                                }}
                              >
                                <td style={{ ...tdStyle, fontWeight: row.drugId === patientDetailDrugId ? 700 : 400 }}>
                                  {row.name}
                                  {row.drugId === patientDetailDrugId && " ←いま見ている薬"}
                                </td>
                                <td style={{ ...tdStyle, textAlign: "right" }}>
                                  {row.year1 != null ? `¥${fmtJpy(row.year1)}` : "—"}
                                </td>
                                <td style={{ ...tdStyle, textAlign: "right" }}>
                                  {row.fiveYear != null ? `¥${fmtJpy(row.fiveYear)}` : "—"}
                                </td>
                                <td style={{ ...tdStyle, textAlign: "right" }}>
                                  {row.total != null ? `¥${fmtJpy(row.total)}` : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </ScrollTable>
                      <h3 style={{ fontSize: 14, margin: "20px 0 8px" }}>
                        高額療養費制度 — 1か月の自己負担上限（外来・{patientAge}歳の場合）
                      </h3>
                      <ScrollTable>
                        <table style={tableStyle}>
                          <thead>
                            <tr style={{ background: "#0F172A", color: "#fff" }}>
                              <th style={thStyle}>所得区分</th>
                              <th style={{ ...thStyle, textAlign: "right" }}>窓口負担割合</th>
                              <th style={{ ...thStyle, textAlign: "right" }}>1か月の上限額</th>
                            </tr>
                          </thead>
                          <tbody>
                            {INCOME_BRACKET_LIST.map((b, i) => {
                              const explainAge = parseInt(patientAge, 10);
                              const isMine = b.id === incomeBracket;
                              return (
                                <tr
                                  key={b.id}
                                  style={{
                                    background: isMine ? "#EFF6FF" : i % 2 ? "#fff" : "#F8FAFC",
                                  }}
                                >
                                  <td style={{ ...tdStyle, fontWeight: isMine ? 700 : 400 }}>
                                    {b.label}
                                    {isMine && " ←あなたの区分"}
                                  </td>
                                  <td style={{ ...tdStyle, textAlign: "right" }}>
                                    {Math.round(getCopayRate(explainAge, null, b.id) * 10)}割
                                  </td>
                                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: isMine ? 700 : 400 }}>
                                    {describeMonthlyLimit(explainAge, b.id)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </ScrollTable>
                      <p style={{ fontSize: 11, color: "#64748B", marginTop: 8, lineHeight: 1.6 }}>
                        {NHI_SOURCE_NOTE}。
                        {parseInt(patientAge, 10) >= 70
                          ? "70歳以上の「一般」「住民税非課税」には外来だけの上限（外来特例）が適用されます。現役並み所得の方は外来特例の対象外です。"
                          : "70歳未満には外来だけの特例上限はなく、高額療養費の月単位の限度額が適用されます。"}
                      </p>
                      <p style={{ fontSize: 11, color: "#64748B", marginTop: 12, lineHeight: 1.6 }}>
                        高額療養費制度の月ごとの上限を適用しためやすです。上限は「その金額ちょうど請求される」のではなく
                        天井（これ以上は払わない）です。定率負担（1割・2割・3割）が上限未満なら、上限ぴったりではなく
                        定率負担額のまま表示されます（例: 上限16,000円でも1割が15,000円なら15,000円）。
                        実際の窓口負担は受診内容・検査の有無・保険の適用状況により変わります。金額は選択中の薬価・
                        診療報酬に基づく試算であり、将来の改定は反映していません。多数回該当（4回目以降の軽減）・
                        外来年間上限（14.4万円）は考慮していないため、実際の負担はこの試算より少なくなる場合があります。
                      </p>
                    </div>
                  ) : (
                  <>
                  <p style={{ fontSize: 12, color: "#64748B", marginBottom: 12, lineHeight: 1.6 }}>
                    直接医療費に年齢別自己負担・月次高額療養費を適用。
                    余命（生命表）≈ {patientAnalysis.patientProfile.remainingLifeExpectancy?.toFixed(1)} 年 /
                    解析上限 {patientAnalysis.patientProfile.effectiveHorizonYears?.toFixed(1)} 年。
                    注射・コストは薬剤×病型別。フォロー期間は全 transitionKey 中最長生存タイムライン（同一 seed）。
                  </p>
                  <div
                    style={{
                      marginBottom: 12,
                      padding: "10px 12px",
                      background: "#EFF6FF",
                      border: "1px solid #BFDBFE",
                      borderRadius: 8,
                      fontSize: 12,
                      lineHeight: 1.6,
                      color: "#1E3A5F",
                    }}
                  >
                    <strong>乱数シード {patientAnalysis.patientProfile.seed}</strong>
                    {" · "}
                    患眼 BCVA {patientAnalysis.patientProfile.baselineBcvaAffected} /
                    対側眼 {patientAnalysis.patientProfile.baselineBcvaFellow}
                    {patientAnalysis.patientProfile.initialDistributionSource && (
                      <> — 初期分布: {patientAnalysis.patientProfile.initialDistributionSource}</>
                    )}
                    <br />
                    フォロー期間（{patientAnalysis.patientProfile.costTimelineMonths} か月）を決める乱数列です。
                    QALY は transitionKey 別、コスト・注射は最長生存タイムライン共通。
                  </div>
                  <p style={{ fontSize: 12, color: "#64748B", marginBottom: 10, lineHeight: 1.6 }}>
                    全7薬剤（ラニビズマブ先発・BS、アフリベルセプト 2 mg/BS/8 mg、ファリ、ブロル）を表示。
                    RBZ 先発と RBZ BS は注射回数同一、患者負担は薬価差。
                  </p>
                  <ScrollTable>
                  <table style={isNarrow ? { ...tableStyle, minWidth: 680 } : compactTableStyle}>
                    <thead>
                      <tr style={{ background: "#0F172A", color: "#fff" }}>
                        <th style={{ ...compactThStyle, width: "22%" }}>薬剤</th>
                        <th style={{ ...compactThStyle, textAlign: "right" }}>直接医療費</th>
                        <th style={{ ...compactThStyle, textAlign: "right" }}>患者負担</th>
                        <th style={{ ...compactThStyle, textAlign: "right" }}>薬剤+投与</th>
                        <th style={{ ...compactThStyle, textAlign: "right" }}>モニタリング</th>
                        <th style={{ ...compactThStyle, textAlign: "right" }}>注射</th>
                        <th style={{ ...compactThStyle, textAlign: "right" }}>QALY</th>
                      </tr>
                    </thead>
                    <tbody>
                      {patientSummaryRows.map((row, i) => (
                        <tr key={row.drugId} style={{ background: i % 2 ? "#fff" : "#F8FAFC" }}>
                          <td style={compactTdStyle}>
                            <span style={{ fontWeight: 600, color: DRUG_CATALOG[row.drugId].color }}>
                              {row.name}
                            </span>
                            {DRUG_CATALOG[row.drugId].clinicalNote && (
                              <div style={{ fontSize: 10, color: "#64748B", marginTop: 2 }}>
                                {DRUG_CATALOG[row.drugId].clinicalNote}
                              </div>
                            )}
                          </td>
                          <td style={{ ...compactTdStyle, textAlign: "right" }}>
                            ¥{fmtJpy(row.totalDirectMedical)}
                          </td>
                          <td style={{ ...compactTdStyle, textAlign: "right", fontWeight: 600 }}>
                            ¥{fmtJpy(row.totalPatientOop)}
                          </td>
                          <td style={{ ...compactTdStyle, textAlign: "right" }}>
                            ¥{fmtJpy(row.costBreakdown.drugAdmin)}
                          </td>
                          <td style={{ ...compactTdStyle, textAlign: "right" }}>
                            ¥{fmtJpy(row.costBreakdown.monitoring)}
                          </td>
                          <td style={{ ...compactTdStyle, textAlign: "right" }}>
                            {row.totalInjections ?? "—"}回
                            {row.injectionReference && (
                              <div style={{ fontSize: 10, color: "#B45309" }}>参考(S6暫定)</div>
                            )}
                          </td>
                          <td style={{ ...compactTdStyle, textAlign: "right" }}>
                            {row.totalQALY != null ? row.totalQALY.toFixed(3) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </ScrollTable>

                  <div style={{ marginTop: 20 }}>
                    <label style={{ ...labelStyle, display: "inline-flex", alignItems: "center", gap: 8 }}>
                      年度別詳細 — 薬剤
                      <select
                        value={patientDetailDrugId}
                        onChange={(e) => setPatientDetailDrugId(e.target.value)}
                        style={{ ...selectStyle, width: 220 }}
                      >
                        {patientCompareDrugIds.map((id) => (
                          <option key={id} value={id}>
                            {DRUG_CATALOG[id].name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {injectionPhaseRef?.phases && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: 12,
                        background: "#F8FAFC",
                        borderRadius: 8,
                        fontSize: 12,
                        lineHeight: 1.6,
                      }}
                    >
                      <strong>注射回数パラメータ（{injectionPhaseRef.source}）</strong>
                      <br />
                      clinicalKey: {injectionPhaseRef.clinicalKey} — {injectionPhaseRef.note}
                      {injectionPhaseRef.isInjectionReference && (
                        <div
                          style={{
                            marginTop: 8,
                            padding: "8px 10px",
                            background: "#FEF3C7",
                            border: "1px solid #FCD34D",
                            borderRadius: 6,
                            color: "#92400E",
                          }}
                        >
                          {injectionPhaseRef.injectionReferenceNote}
                        </div>
                      )}
                      <table style={{ ...tableStyle, marginTop: 8, fontSize: 11 }}>
                        <thead>
                          <tr style={{ background: "#64748B", color: "#fff" }}>
                            <th style={thStyle}>フェーズ</th>
                            <th style={thStyle}>Table 値</th>
                            <th style={thStyle}>意味</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ["induction", "最初3か月の合計回数"],
                            ["year1", "2年目の年間回数（導入後1年目）"],
                            ["year2", "3年目の年間回数"],
                            ["year3plus", "4年目以降の年間回数"],
                          ].map(([phase, meaning]) => (
                            <tr key={phase}>
                              <td style={tdStyle}>{phase}</td>
                              <td style={{ ...tdStyle, textAlign: "right" }}>
                                {injectionPhaseRef.phases[phase] ?? "—"}
                              </td>
                              <td style={tdStyle}>{meaning}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {injectionReference && (
                        <p style={{ margin: "8px 0 0", color: "#64748B" }}>
                          カレンダー年換算の期待注射（生涯 {injectionReference.lifetime} 回）—
                          下表「Table期待」と照合
                        </p>
                      )}
                    </div>
                  )}

                  {patientDetailDrug?.annualTrajectory?.length > 0 && (
                    <>
                      <table style={{ ...tableStyle, marginTop: 12 }}>
                        <thead>
                          <tr style={{ background: "#1E3A5F", color: "#fff" }}>
                            <th style={thStyle}>年</th>
                            <th style={thStyle}>年齢</th>
                            <th style={thStyle}>注射回数</th>
                            <th style={thStyle}>Table期待</th>
                            <th style={thStyle}>累積注射</th>
                            <th style={thStyle}>直接医療費</th>
                            <th style={thStyle}>患者負担</th>
                            <th style={thStyle}>累積患者負担</th>
                          </tr>
                        </thead>
                        <tbody>
                          {patientDetailDrug.annualTrajectory.map((row, i) => (
                            <tr key={row.year} style={{ background: i % 2 ? "#fff" : "#F8FAFC" }}>
                              <td style={tdStyle}>{row.year}</td>
                              <td style={tdStyle}>{row.age}</td>
                              <td style={{ ...tdStyle, textAlign: "right" }}>
                                {row.injections ?? 0}回
                              </td>
                              <td style={{ ...tdStyle, textAlign: "right", color: "#64748B" }}>
                                {injectionReference?.rows[row.year]?.expected ?? "—"}
                              </td>
                              <td style={{ ...tdStyle, textAlign: "right" }}>
                                {row.cumInjections ?? 0}回
                              </td>
                              <td style={{ ...tdStyle, textAlign: "right" }}>
                                ¥{fmtJpy(row.directMedical)}
                              </td>
                              <td style={{ ...tdStyle, textAlign: "right" }}>
                                ¥{fmtJpy(row.patientOop)}
                              </td>
                              <td style={{ ...tdStyle, textAlign: "right" }}>
                                ¥{fmtJpy(row.cumPatientOop)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <div style={{ marginTop: 20 }}>
                        <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>患者負担の年次推移（千円）</h3>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={patientAnnualData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="year" label={{ value: "経過年", position: "insideBottom", offset: -4 }} />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Line
                              type="monotone"
                              dataKey="patientOop"
                              name="年間患者負担"
                              stroke="#DC2626"
                              strokeWidth={2}
                              dot={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="cumPatientOop"
                              name="累積患者負担"
                              stroke="#1E40AF"
                              strokeWidth={2}
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </>
                  )}

                  <div style={{ marginTop: 28, paddingTop: 16, borderTop: "1px solid #E2E8F0" }}>
                    <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>
                      途中スイッチ試算 — {DRUG_CATALOG[patientDetailDrugId].name} からの切替（累積患者負担）
                    </h3>
                    <p style={{ fontSize: 12, color: "#64748B", lineHeight: 1.6, marginTop: 0 }}>
                      視力経路は両アーム共通（CMA 前提）で、スイッチ月以降のコスト・注射スケジュールのみ差し替え。
                      スイッチ後の注射フェーズは導入期から再起算（再導入）します。
                      現行薬は上の「年度別詳細 — 薬剤」の選択に連動。
                    </p>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                        gap: 12,
                        marginBottom: 12,
                        padding: 12,
                        background: "#F8FAFC",
                        borderRadius: 8,
                      }}
                    >
                      <label style={labelStyle}>
                        スイッチ先
                        <select
                          value={effectiveMidSwitchToDrugId}
                          onChange={(e) => setMidSwitchToDrugId(e.target.value)}
                          style={selectStyle}
                        >
                          {DRUG_IDS.filter((id) => id !== patientDetailDrugId).map((id) => (
                            <option key={id} value={id}>
                              {DRUG_CATALOG[id].name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={labelStyle}>
                        スイッチ時期（参入から年・0.5〜30）
                        <input
                          type="number"
                          min={0.5}
                          max={30}
                          step={0.5}
                          value={midSwitchYearInput}
                          onChange={(e) => setMidSwitchYearInput(e.target.value)}
                          style={inputStyle}
                        />
                      </label>
                    </div>
                    {!patientMidSwitch ? (
                      <p style={{ color: "#B45309", fontSize: 13 }}>
                        スイッチ時期（0.5〜30年）を入力してください。
                      </p>
                    ) : (
                      <>
                        <div
                          style={{
                            padding: 12,
                            background:
                              patientMidSwitch.deltaPatientOop <= 0 ? "#ECFDF5" : "#FEF3C7",
                            borderRadius: 8,
                            marginBottom: 12,
                            fontSize: 13,
                            lineHeight: 1.6,
                          }}
                        >
                          継続（{DRUG_CATALOG[patientDetailDrugId].name}）の累積患者負担 ¥
                          {fmtJpy(patientMidSwitch.continueArm.totalPatientOop)} に対し、
                          {patientMidSwitch.switchAtYear}年目に{" "}
                          {DRUG_CATALOG[effectiveMidSwitchToDrugId].name} へスイッチすると ¥
                          {fmtJpy(patientMidSwitch.switchArm.totalPatientOop)}（Δ{" "}
                          {patientMidSwitch.deltaPatientOop > 0 ? "+" : ""}¥
                          {fmtJpy(patientMidSwitch.deltaPatientOop)}）。
                          {!patientMidSwitch.switchApplied ? (
                            <> スイッチ時期がフォロー期間より後のため、切替は発生していません。</>
                          ) : patientMidSwitch.crossoverMonth != null ? (
                            <>
                              {" "}
                              累積負担はスイッチから{" "}
                              {patientMidSwitch.crossoverMonth - patientMidSwitch.switchAtMonth}
                              か月（通算 {patientMidSwitch.crossoverMonth} か月目）で継続を下回ります。
                            </>
                          ) : (
                            <> フォロー期間内では累積負担が継続を下回りません。</>
                          )}
                        </div>
                        <ResponsiveContainer width="100%" height={280}>
                          <LineChart data={midSwitchChartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                              dataKey="year"
                              type="number"
                              domain={[0, "dataMax"]}
                              label={{ value: "経過年", position: "insideBottom", offset: -4 }}
                            />
                            <YAxis
                              label={{ value: "累積患者負担（千円）", angle: -90, position: "insideLeft" }}
                            />
                            <Tooltip
                              formatter={(v, name) => [
                                `${fmtJpy(v)} 千円`,
                                name === "cumOopContinue"
                                  ? `継続: ${DRUG_CATALOG[patientDetailDrugId].name}`
                                  : `スイッチ: ${DRUG_CATALOG[effectiveMidSwitchToDrugId].name}`,
                              ]}
                              labelFormatter={(y) => `${y}年`}
                            />
                            <Legend
                              formatter={(name) =>
                                name === "cumOopContinue"
                                  ? `継続（${DRUG_CATALOG[patientDetailDrugId].name}）`
                                  : `スイッチ（${DRUG_CATALOG[effectiveMidSwitchToDrugId].name}）`
                              }
                            />
                            <ReferenceLine
                              x={Math.round((patientMidSwitch.switchAtMonth / 12) * 10) / 10}
                              stroke="#0F172A"
                              strokeDasharray="6 3"
                              label={{ value: "スイッチ", position: "top", fontSize: 11 }}
                            />
                            {patientMidSwitch.crossoverMonth != null && (
                              <ReferenceLine
                                x={Math.round((patientMidSwitch.crossoverMonth / 12) * 10) / 10}
                                stroke="#059669"
                                strokeDasharray="4 2"
                                label={{ value: "逆転", position: "top", fontSize: 11, fill: "#059669" }}
                              />
                            )}
                            <Line
                              type="monotone"
                              dataKey="cumOopContinue"
                              stroke={DRUG_CATALOG[patientDetailDrugId].color}
                              strokeWidth={2}
                              dot={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="cumOopSwitch"
                              stroke={DRUG_CATALOG[effectiveMidSwitchToDrugId].color}
                              strokeWidth={2}
                              strokeDasharray="5 3"
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </>
                    )}
                  </div>
                  </>
                  )}
                </>
              )}
            </Panel>
          )}

          {activeTab === "switch" && (
            <Panel title="スイッチングシミュレーション">
              <p style={{ fontSize: 12, color: "#64748B", lineHeight: 1.6, marginTop: 0 }}>
                <strong>損益分岐間隔 = 現行間隔 × 価格比（スイッチ先1回コスト ÷ 現行1回コスト）</strong>。
                年間薬剤費 = 1回コスト × 52 ÷ 間隔（週）なので、この間隔で年間薬剤費が現行と一致します。
                QALY 不変（CMA）の前提では、スイッチ先がこの間隔以上に延長できるかが判断基準です。
                1回コスト = 薬価 + 注射手技料（選択コスト出典）。
                Δ患者負担/年は左サイドバー「個別患者」の年齢・所得区分に月次高額療養費上限を適用しためやす
                （モニタリング来院分は含まない）。
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 12,
                  marginBottom: 16,
                  padding: 14,
                  background: "#F8FAFC",
                  borderRadius: 8,
                }}
              >
                <label style={labelStyle}>
                  現行薬剤
                  <select
                    value={switchCurrentDrugId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSwitchCurrentDrugId(id);
                      if (id === switchTargetDrugId) {
                        const alt = DRUG_IDS.find((d) => d !== id);
                        if (alt) setSwitchTargetDrugId(alt);
                      }
                    }}
                    style={selectStyle}
                  >
                    {DRUG_IDS.map((id) => (
                      <option key={id} value={id}>
                        {DRUG_CATALOG[id].name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={labelStyle}>
                  現行治療間隔（週・任意入力可）
                  <input
                    type="number"
                    min={2}
                    max={32}
                    step={0.5}
                    value={switchIntervalInput}
                    onChange={(e) => setSwitchIntervalInput(e.target.value)}
                    style={inputStyle}
                  />
                  <span style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                    {TREATMENT_INTERVAL_OPTIONS.map((o) => (
                      <button
                        key={o.weeks}
                        type="button"
                        onClick={() => setSwitchIntervalInput(String(o.weeks))}
                        style={{
                          padding: "2px 8px",
                          fontSize: 11,
                          border: "1px solid #CBD5E1",
                          borderRadius: 4,
                          cursor: "pointer",
                          background:
                            switchCurrentIntervalWeeks === o.weeks ? "#1E40AF" : "#fff",
                          color:
                            switchCurrentIntervalWeeks === o.weeks ? "#fff" : "#475569",
                        }}
                      >
                        Q{o.weeks}
                      </button>
                    ))}
                  </span>
                </label>
              </div>

              {!switchIntervalValid || !switchBreakEven ? (
                <p style={{ color: "#B45309", fontSize: 13 }}>
                  現行治療間隔（2〜32週）を入力してください。
                </p>
              ) : (
                <>
                  <div
                    style={{
                      padding: 12,
                      background: "#EFF6FF",
                      borderRadius: 8,
                      marginBottom: 16,
                      fontSize: 13,
                      lineHeight: 1.6,
                    }}
                  >
                    現行: <strong>{switchBreakEven.currentDrug?.name}</strong> Q
                    {switchBreakEven.currentIntervalWeeks} —{" "}
                    {switchBreakEven.annualInjections.toFixed(1)} 回/年 × ¥
                    {fmtJpy(switchBreakEven.perInjection)}/回 ={" "}
                    <strong>¥{fmtJpy(Math.round(switchBreakEven.annualDrugAdmin))}/年</strong>
                    （薬剤+手技）
                    {switchBreakEven.currentPatientOop && (
                      <>
                        <br />
                        患者自己負担（{patientAge}歳・
                        {INCOME_BRACKET_LIST.find((b) => b.id === incomeBracket)?.label}
                        ・高額療養費適用）: 注射月 ¥
                        {fmtJpy(Math.round(switchBreakEven.currentPatientOop.perInjectionOop))} ×{" "}
                        {switchBreakEven.currentPatientOop.annualInjections.toFixed(1)} 回/年 ={" "}
                        <strong>
                          ¥{fmtJpy(Math.round(switchBreakEven.currentPatientOop.annualOop))}/年
                        </strong>
                        {switchBreakEven.currentPatientOop.capped && "（月上限適用）"}
                      </>
                    )}
                  </div>

                  <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>
                    全スイッチ先 — 損益分岐間隔と文献エビデンス
                  </h3>
                  <ScrollTable>
                    <table style={tableStyle}>
                      <thead>
                        <tr style={{ background: "#0F172A", color: "#fff" }}>
                          <th style={thStyle}>スイッチ先</th>
                          <th style={thStyle}>1回コスト</th>
                          <th style={thStyle}>価格比</th>
                          <th style={thStyle}>損益分岐間隔</th>
                          <th style={thStyle}>必要延長</th>
                          <th style={thStyle}>同一間隔 Δ薬剤費/年</th>
                          <th style={thStyle}>同一間隔 Δ患者負担/年</th>
                          <th style={thStyle}>必要効果（QALY/年）</th>
                          <th style={thStyle}>文献（スイッチ後間隔）</th>
                          <th style={thStyle}>判定</th>
                        </tr>
                      </thead>
                      <tbody>
                        {switchBreakEven.rows.map((row, i) => {
                          if (row.missingPrice) {
                            return (
                              <tr key={row.drugId} style={{ background: i % 2 ? "#fff" : "#F8FAFC" }}>
                                <td style={tdStyle}>{row.drug?.name}</td>
                                <td style={tdStyle} colSpan={9}>
                                  薬価未掲載（コスト出典を確認）
                                </td>
                              </tr>
                            );
                          }
                          const verdictColor =
                            {
                              cheaper: "#059669",
                              reachable: "#0369A1",
                              borderline: "#B45309",
                              difficult: "#DC2626",
                              unreachable: "#DC2626",
                            }[row.verdict.kind] ?? "#64748B";
                          return (
                            <tr
                              key={row.drugId}
                              style={{
                                background:
                                  row.verdict.kind === "cheaper"
                                    ? "#ECFDF5"
                                    : i % 2
                                      ? "#fff"
                                      : "#F8FAFC",
                              }}
                            >
                              <td style={{ ...tdStyle, fontWeight: 600, color: row.drug?.color }}>
                                {row.drug?.name}
                              </td>
                              <td style={{ ...tdStyle, textAlign: "right" }}>
                                ¥{fmtJpy(row.perInjection)}
                              </td>
                              <td style={{ ...tdStyle, textAlign: "right" }}>
                                ×{row.priceRatio.toFixed(2)}
                              </td>
                              <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                                Q{row.breakEvenWeeks.toFixed(1)}
                              </td>
                              <td style={{ ...tdStyle, textAlign: "right" }}>
                                {row.requiredExtensionWeeks > 0
                                  ? `+${row.requiredExtensionWeeks.toFixed(1)}週`
                                  : `短縮許容 ${row.requiredExtensionWeeks.toFixed(1)}週`}
                              </td>
                              <td
                                style={{
                                  ...tdStyle,
                                  textAlign: "right",
                                  color: row.sameIntervalAnnualDelta <= 0 ? "#059669" : "#B45309",
                                }}
                              >
                                {row.sameIntervalAnnualDelta > 0 ? "+" : ""}¥
                                {fmtJpy(Math.round(row.sameIntervalAnnualDelta))}
                              </td>
                              <td
                                style={{
                                  ...tdStyle,
                                  textAlign: "right",
                                  color:
                                    row.patientOopAnnualDelta == null
                                      ? "#94A3B8"
                                      : row.patientOopAnnualDelta <= 0
                                        ? "#059669"
                                        : "#B45309",
                                }}
                              >
                                {row.patientOopAnnualDelta != null ? (
                                  <>
                                    {Math.round(row.patientOopAnnualDelta) === 0
                                      ? "±¥0"
                                      : `${row.patientOopAnnualDelta > 0 ? "+" : ""}¥${fmtJpy(Math.round(row.patientOopAnnualDelta))}`}
                                    <div style={{ fontSize: 10, color: "#94A3B8" }}>
                                      年 ¥{fmtJpy(Math.round(row.patientOop.annualOop))}
                                      {row.patientOop.capped && "・上限"}
                                    </div>
                                  </>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td style={{ ...tdStyle, textAlign: "right", fontSize: 11 }}>
                                {row.qalyPerYearKind === "min_required_gain"
                                  ? `+${row.qalyPerYear.toFixed(3)} 必要`
                                  : `↓${row.qalyPerYear.toFixed(3)} まで許容`}
                              </td>
                              <td style={{ ...tdStyle, fontSize: 11, maxWidth: 240 }}>
                                {row.evidence?.realisticExtensionWeeks
                                  ? `実臨床 +${row.evidence.realisticExtensionWeeks[0]}〜${row.evidence.realisticExtensionWeeks[1]}週`
                                  : "実臨床データ未登録"}
                                {row.evidence?.trialReach && (
                                  <div style={{ color: "#0369A1", marginTop: 2 }}>
                                    試験上限:{" "}
                                    {row.evidence.trialReach
                                      .map((t) => `Q${t.weeks}≥${Math.round(t.fraction * 100)}%`)
                                      .join(" / ")}
                                    {row.evidence.trialEvidenceTier && (
                                      <span
                                        style={{
                                          marginLeft: 4,
                                          padding: "0 5px",
                                          borderRadius: 3,
                                          fontSize: 10,
                                          background:
                                            row.evidence.trialEvidenceTier === "direct"
                                              ? "#DBEAFE"
                                              : row.evidence.trialEvidenceTier === "modeled"
                                                ? "#FEF3C7"
                                                : row.evidence.trialEvidenceTier ===
                                                    "reference-derived"
                                                  ? "#FCE7F3"
                                                  : "#E2E8F0",
                                          color: "#334155",
                                        }}
                                      >
                                        {EVIDENCE_TIER_LABELS[row.evidence.trialEvidenceTier] ??
                                          row.evidence.trialEvidenceTier}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {row.evidence?.note && (
                                  <div style={{ color: "#94A3B8", marginTop: 2 }}>
                                    {row.evidence.note}（{row.evidence.sources}）
                                  </div>
                                )}
                              </td>
                              <td style={{ ...tdStyle, fontSize: 11 }}>
                                <span style={{ color: verdictColor, fontWeight: 600 }}>
                                  {row.verdict.label}
                                </span>
                                <div style={{ color: "#94A3B8", marginTop: 2 }}>
                                  {row.verdict.detail}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </ScrollTable>

                  <h3 style={{ fontSize: 14, margin: "20px 0 8px" }}>
                    年間薬剤費 × 治療間隔（交点 = 損益分岐）
                  </h3>
                  <ResponsiveContainer width="100%" height={340}>
                    <LineChart data={switchCostCurve}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="weeks"
                        type="number"
                        domain={[4, 24]}
                        tickCount={11}
                        label={{ value: "治療間隔（週）", position: "insideBottom", offset: -4 }}
                      />
                      <YAxis
                        tickFormatter={(v) => `${Math.round(v / 10000)}万`}
                        label={{ value: "薬剤+手技 ¥/年", angle: -90, position: "insideLeft" }}
                      />
                      <Tooltip
                        formatter={(v, name) => [`¥${fmtJpy(v)}/年`, DRUG_CATALOG[name]?.name ?? name]}
                        labelFormatter={(w) => `Q${w}`}
                      />
                      <Legend formatter={(id) => DRUG_CATALOG[id]?.name ?? id} />
                      <ReferenceLine
                        y={switchBreakEven.annualDrugAdmin}
                        stroke="#0F172A"
                        strokeDasharray="6 3"
                        label={{
                          value: `現行 ¥${fmtJpy(Math.round(switchBreakEven.annualDrugAdmin))}/年`,
                          position: "insideTopRight",
                          fontSize: 11,
                        }}
                      />
                      {switchBreakEven.currentIntervalWeeks >= 4 &&
                        switchBreakEven.currentIntervalWeeks <= 24 && (
                          <ReferenceLine
                            x={switchBreakEven.currentIntervalWeeks}
                            stroke="#64748B"
                            strokeDasharray="2 2"
                            label={{
                              value: `現在 Q${switchBreakEven.currentIntervalWeeks}`,
                              position: "insideBottomLeft",
                              fontSize: 10,
                              fill: "#64748B",
                            }}
                          />
                        )}
                      {switchBreakEven.rows
                        .filter(
                          (r) =>
                            !r.missingPrice && r.breakEvenWeeks >= 4 && r.breakEvenWeeks <= 24
                        )
                        .map((r) => (
                          <ReferenceLine
                            key={`be-${r.drugId}`}
                            x={r.breakEvenWeeks}
                            stroke={r.drug?.color ?? "#94A3B8"}
                            strokeDasharray="3 3"
                            label={{
                              value: `Q${r.breakEvenWeeks.toFixed(1)}`,
                              position: "top",
                              fontSize: 10,
                              fill: r.drug?.color ?? "#94A3B8",
                            }}
                          />
                        ))}
                      {DRUG_IDS.map((id) => (
                        <Line
                          key={id}
                          type="monotone"
                          dataKey={id}
                          stroke={DRUG_CATALOG[id].color}
                          strokeWidth={id === switchCurrentDrugId ? 3 : 1.5}
                          strokeDasharray={id === switchCurrentDrugId ? undefined : "4 2"}
                          dot={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                  <p style={{ fontSize: 11, color: "#64748B", marginTop: 8, lineHeight: 1.5 }}>
                    各薬剤の曲線が横点線（現行の年間薬剤費）と交わる間隔が損益分岐 —
                    縦点線はその位置（薬剤色）と現在の間隔（グレー）。
                    必要効果（QALY/年）= 同一間隔 Δ薬剤費 ÷ WTP（¥
                    {(DEFAULT_HORIZON.wtpPerQaly / 1e6).toFixed(1)}M/QALY）—
                    現行より高い薬剤は、この分の効用改善が毎年見込めなければ CMA 上は非推奨。
                  </p>

                  {switchAnalysis && (
                    <details style={{ marginTop: 24 }}>
                      <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#475569" }}>
                        詳細検証 — 生涯 Markov 総コスト（モニタリング・社会的費用・割引を含む）
                      </summary>
                      <div style={{ marginTop: 12 }}>
                        <label style={{ ...labelStyle, maxWidth: 320 }}>
                          スイッチ先薬剤
                          <select
                            value={switchTargetDrugId}
                            onChange={(e) => setSwitchTargetDrugId(e.target.value)}
                            style={selectStyle}
                          >
                            {DRUG_IDS.filter((id) => id !== switchCurrentDrugId).map((id) => (
                              <option key={id} value={id}>
                                {DRUG_CATALOG[id].name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div
                          style={{
                            padding: 12,
                            background: switchAnalysis.feasibleCount > 0 ? "#ECFDF5" : "#FEF3C7",
                            borderRadius: 8,
                            margin: "12px 0",
                            fontSize: 13,
                            lineHeight: 1.6,
                          }}
                        >
                          {switchAnalysis.recommendation}
                        </div>
                        <ScrollTable>
                          <table style={tableStyle}>
                            <thead>
                              <tr style={{ background: "#1E3A5F", color: "#fff" }}>
                                <th style={thStyle}>間隔</th>
                                <th style={thStyle}>年間注射</th>
                                <th style={thStyle}>薬剤+投与/年</th>
                                <th style={thStyle}>生涯総コスト</th>
                                <th style={thStyle}>Δコスト</th>
                                <th style={thStyle}>判定</th>
                              </tr>
                            </thead>
                            <tbody>
                              {switchAnalysis.intervalRows.map((row, i) => (
                                <tr
                                  key={row.weeks}
                                  style={{
                                    background: row.costNeutralOrBetter
                                      ? "#ECFDF5"
                                      : i % 2
                                        ? "#fff"
                                        : "#F8FAFC",
                                  }}
                                >
                                  <td style={tdStyle}>{row.label}</td>
                                  <td style={{ ...tdStyle, textAlign: "right" }}>
                                    {row.annualInjections?.toFixed(1) ?? "—"}
                                  </td>
                                  <td style={{ ...tdStyle, textAlign: "right" }}>
                                    {row.annualDrugAdmin != null
                                      ? `¥${fmtJpy(Math.round(row.annualDrugAdmin))}`
                                      : "—"}
                                  </td>
                                  <td style={{ ...tdStyle, textAlign: "right" }}>
                                    {row.totalCost != null ? `¥${fmtJpy(row.totalCost)}` : "—"}
                                  </td>
                                  <td
                                    style={{
                                      ...tdStyle,
                                      textAlign: "right",
                                      color:
                                        row.deltaCost != null && row.deltaCost <= 0
                                          ? "#059669"
                                          : "#B45309",
                                    }}
                                  >
                                    {row.deltaCost != null
                                      ? `${row.deltaCost > 0 ? "+" : ""}¥${fmtJpy(row.deltaCost)}`
                                      : "—"}
                                  </td>
                                  <td style={tdStyle}>
                                    {row.costNeutralOrBetter ? (
                                      <span style={{ color: "#059669", fontWeight: 600 }}>
                                        CMA 推奨
                                      </span>
                                    ) : (
                                      <span style={{ color: "#94A3B8" }}>コスト増</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </ScrollTable>
                        <p style={{ fontSize: 11, color: "#64748B", marginTop: 8 }}>
                          生涯 Markov（左サイドバーの治療期間・割引率・サブタイプを反映）は
                          損益分岐の頑健性確認用。薬剤費以外はスイッチ前後で共通のため、
                          結論は上の解析解とほぼ一致します。
                        </p>
                      </div>
                    </details>
                  )}
                </>
              )}
            </Panel>
          )}

          {activeTab === "vision" && (
            <Panel title="視力推移 — 期待 BCVA（選択薬剤・Markov コホート平均）">
              {!hasVisionTrajectory ? (
                <p style={{ color: "#B45309" }}>
                  解析結果がありません。薬剤を選択し、左サイドバーの設定を確認してください。
                </p>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: "#64748B", marginBottom: 12, lineHeight: 1.6 }}>
                    各薬剤の Markov コホートにおける治療眼の期待 BCVA（5状態中央値の加重平均）。
                    生存者の状態分布（{STATE_LABELS.join(" / ")}）から算出。初期分布は Table S2、遷移は Table S5
                    （typical/PCV: Yoneda Y1 → Jin Y≥2；RAP: Yoneda Y1 → Hoshino Y2 → Kertes Y≥3；導入期は Yanagi 前研究仮定）。
                  </p>
                  <ResponsiveContainer width="100%" height={360}>
                    <LineChart data={visionTrajectoryData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="year"
                        domain={[0, "auto"]}
                        label={{ value: "経過年", position: "insideBottom", offset: -4 }}
                      />
                      <YAxis
                        domain={[0, "auto"]}
                        label={{ value: "期待 BCVA", angle: -90, position: "insideLeft" }}
                      />
                      <Tooltip formatter={(v) => Number(v).toFixed(3)} />
                      <Legend />
                      {visionTrajectoryDrugs.map((id) => (
                        <Line
                          key={id}
                          type="monotone"
                          dataKey={id}
                          name={DRUG_CATALOG[id].name}
                          stroke={DRUG_CATALOG[id].color}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </>
              )}
            </Panel>
          )}

          {activeTab === "validate" && costPaperId === "paper2_rbz" && (
            <Panel title={`Table S12 照合（${subtype.label}・シナリオ）`}>
              <p style={{ fontSize: 12, color: "#64748B", marginBottom: 12 }}>
                臨床=シナリオ（S7–S8）。参入年齢={PAPER_S12_ENTRY_AGE[subtypeId] ?? subtype.meanAge}歳（S12 論文設定）、
                20年・半周期補正・令和5年生命表。
              </p>
              <ScrollTable>
              <table style={{ ...tableStyle, minWidth: 480 }}>
                <thead>
                  <tr style={{ background: "#334155", color: "#fff" }}>
                    <th style={thStyle}>薬剤</th>
                    <th style={thStyle}>指標</th>
                    <th style={thStyle}>論文 S12</th>
                    <th style={thStyle}>本ツール</th>
                    <th style={thStyle}>差</th>
                  </tr>
                </thead>
                <tbody>
                  {["ranibizumab_bs", "aflibercept"].flatMap((id) => {
                    const refv = subtype.referenceS12?.[id === "ranibizumab_bs" ? "rbz_bs" : "aflibercept"];
                    if (!refv) return [];
                    const scen = runAnalysisCached({
                      selectedDrugIds: [id],
                      subtypeId,
                      costPaperId: "paper2_rbz",
                      clinicalCase: "scenario",
                      horizon,
                      modelParams: buildS12ModelParams(subtypeId, modelParams),
                    }).results[id];
                    return ["QALY", "Cost", "注射"].map((metric, idx) => {
                      const toolVal =
                        metric === "QALY"
                          ? scen?.totalQALY
                          : metric === "Cost"
                            ? scen?.totalCost
                            : scen?.totalInjections;
                      const paperVal =
                        metric === "QALY"
                          ? refv.qaly
                          : metric === "Cost"
                            ? refv.cost
                            : null;
                      let delta = "—";
                      if (toolVal != null && paperVal != null) {
                        const d = toolVal - paperVal;
                        delta =
                          metric === "QALY"
                            ? d.toFixed(3)
                            : metric === "Cost"
                              ? `¥${fmtJpy(d)}`
                              : d.toFixed(1);
                      }
                      return (
                      <tr key={`${id}-${metric}`} style={{ background: idx % 2 ? "#fff" : "#F8FAFC" }}>
                        <td style={tdStyle}>{DRUG_CATALOG[id].name}</td>
                        <td style={tdStyle}>{metric}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {metric === "QALY"
                            ? refv.qaly.toFixed(3)
                            : metric === "Cost"
                              ? `¥${fmtJpy(refv.cost)}`
                              : "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {metric === "QALY"
                            ? scen?.totalQALY?.toFixed(3) ?? "—"
                            : metric === "Cost"
                              ? scen?.totalCost != null
                                ? `¥${fmtJpy(scen.totalCost)}`
                                : "—"
                              : scen?.totalInjections != null
                                ? scen.totalInjections.toFixed(1)
                                : "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", color: "#64748B" }}>{delta}</td>
                      </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
              </ScrollTable>
              <p style={{ fontSize: 11, color: "#64748B", marginTop: 8 }}>
                typical の Cost は参入74歳で論文に近接。PCV/RAP は社会的費用（視力経路・余命）の差が大きい。
              </p>

              {mortalitySensitivity?.rows?.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, margin: "20px 0 8px" }}>
                    年間死亡率の感度（QALY・典型/PCV/RAP は左サイドバーのサブタイプ）
                  </h3>
                  <ScrollTable>
                  <table style={{ ...tableStyle, minWidth: 520 }}>
                    <thead>
                      <tr style={{ background: "#475569", color: "#fff" }}>
                        <th style={thStyle}>年間死亡率</th>
                        <th style={thStyle}>薬剤</th>
                        <th style={thStyle}>論文 QALY</th>
                        <th style={thStyle}>本ツール QALY</th>
                        <th style={thStyle}>差</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mortalitySensitivity.rows.map((row, i) => (
                        <tr
                          key={`${row.annualMortality}-${row.drugId}`}
                          style={{ background: i % 2 ? "#fff" : "#F8FAFC" }}
                        >
                          <td style={tdStyle}>{row.annualMortality}</td>
                          <td style={tdStyle}>{DRUG_CATALOG[row.drugId].name}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            {row.paperQaly?.toFixed(3) ?? "—"}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            {row.qaly?.toFixed(3) ?? "—"}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            {row.qaly != null && row.paperQaly != null
                              ? (row.qaly - row.paperQaly).toFixed(3)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </ScrollTable>
                  <p style={{ fontSize: 11, color: "#64748B", marginTop: 8 }}>
                    固定年間死亡率（0.02–0.04）での感度。通常は左欄を空欄にし令和5年簡易生命表（年齢別）を使用します。
                  </p>
                </>
              )}
            </Panel>
          )}

          {activeTab === "missing" && showIssuesTab && (
            <Panel title="要確認の項目">
              {missingParams.length > 0 && (
                <>
                  <p style={{ fontSize: 13, lineHeight: 1.6, color: "#475569" }}>
                    以下の項目が未設定です。左サイドバー「QALY パラメータ」または薬剤選択を確認してください。
                  </p>
                  <ul style={{ marginTop: 12, paddingLeft: 20, lineHeight: 1.8 }}>
                    {missingParams.map((m) => (
                      <li key={m.key} style={{ fontSize: 13 }}>
                        {m.label}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {hasIncompleteResults && (
                <>
                  <p
                    style={{
                      fontSize: 13,
                      lineHeight: 1.6,
                      color: "#475569",
                      marginTop: missingParams.length > 0 ? 16 : 0,
                    }}
                  >
                    一部の薬剤で結果が不完全です。
                  </p>
                  <ul style={{ marginTop: 8, paddingLeft: 20, lineHeight: 1.8 }}>
                    {selectedDrugIds
                      .filter((id) => results[id]?.incomplete)
                      .map((id) => (
                        <li key={id} style={{ fontSize: 13 }}>
                          {DRUG_CATALOG[id].name}: {results[id].reason ?? "未算出"}
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </Panel>
          )}
        </main>
      </div>

      <footer
        style={{
          textAlign: "center",
          padding: 14,
          fontSize: 11,
          color: "#94A3B8",
          borderTop: "1px solid #E2E8F0",
          background: "#fff",
        }}
      >
        臨床=5状態・両眼 Markov / コスト=選択した出典 — educational use only
      </footer>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #E2E8F0" }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#64748B",
          letterSpacing: 1,
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 10,
        padding: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      }}
    >
      <h2 style={{ margin: "0 0 16px", fontSize: 16 }}>{title}</h2>
      {children}
    </div>
  );
}

function TabButton({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 14px",
        fontSize: 12,
        fontWeight: 600,
        border: "none",
        borderRadius: 6,
        cursor: "pointer",
        background: active ? "#1E40AF" : "#E2E8F0",
        color: active ? "#fff" : "#475569",
      }}
    >
      {label}
    </button>
  );
}

/** 全タブ共通 — シミュレーション免責事項（必ず表示） */
function SimulationDisclaimer() {
  return (
    <aside
      role="note"
      aria-label="シミュレーション免責事項"
      style={{
        marginBottom: 16,
        padding: "10px 14px",
        background: "#FFFBEB",
        border: "1px solid #F59E0B",
        borderRadius: 8,
        fontSize: 11,
        lineHeight: 1.65,
        color: "#78350F",
      }}
    >
      <strong style={{ display: "block", marginBottom: 4, fontSize: 12 }}>
        免責事項（本シミュレーションについて）
      </strong>
      本ツールの表示金額・QALY・費用対効果は、公開論文・公定薬価・診療報酬・高額療養費制度に基づく
      <strong>試算・めやす</strong>
      であり、実際の窓口負担・治療方針・保険適用を保証するものではありません。
      薬価・診療報酬・制度は改定されうるため、最新の公定値・医療機関の算定と異なる場合があります。
      高額療養費の月次上限は天井であり、定率負担が上限未満のときは上限ぴったりではなく定率負担額となります。
      多数回該当・外来年間上限・合算・限度額適用認定証の有無などは簡略化しており、
      個別の医療判断・患者説明の最終根拠にはなりません。必要に応じて主治医・医療機関・保険者にご確認ください。
    </aside>
  );
}

/** 患者説明モード用 — 大きめの数字カード */
function ExplainMetric({ label, value, sub }) {
  return (
    <div
      style={{
        padding: 16,
        background: "#F8FAFC",
        border: "1px solid #E2E8F0",
        borderRadius: 10,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 12, color: "#475569", fontWeight: 600, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#0F172A" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#64748B", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function MetricCard({ label, value, sub }) {
  return (
    <div
      style={{
        padding: 12,
        background: "#fff",
        border: "1px solid #E2E8F0",
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 10, color: "#64748B", fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const selectStyle = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  borderRadius: 6,
  border: "1px solid #CBD5E1",
  marginTop: 4,
};
const inputStyle = { ...selectStyle };
const labelStyle = { display: "block", marginBottom: 12, fontSize: 12, fontWeight: 500 };
const hintStyle = { fontSize: 10, color: "#94A3B8", margin: "6px 0 0", lineHeight: 1.4 };
const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const thStyle = { padding: 10, textAlign: "left" };
const tdStyle = { padding: 10, borderBottom: "1px solid #E2E8F0" };
const compactTableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  tableLayout: "fixed",
  fontSize: 11,
};
const compactThStyle = { padding: "6px 5px", textAlign: "left", lineHeight: 1.2 };
const compactTdStyle = {
  padding: "6px 5px",
  borderBottom: "1px solid #E2E8F0",
  lineHeight: 1.25,
  verticalAlign: "top",
  overflowWrap: "anywhere",
};
