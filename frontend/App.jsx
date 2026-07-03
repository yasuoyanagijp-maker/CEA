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
  DRUG_CATALOG,
  DRUG_IDS,
  SUBTYPES,
  COST_PAPER_LIST,
  DEFAULT_HORIZON,
  DEFAULT_MODEL_PARAMS,
  DEFAULT_UTILITIES,
  DEFAULT_UTILITY_NONE,
  TREATMENT_DURATION_OPTIONS,
  TREATMENT_INTERVAL_OPTIONS,
  CLINICAL_CASE_OPTIONS,
  EVIDENCE_TIER_LABELS,
  listInjections2026MetaSummary,
  INJECTIONS_2026_META_SOURCE,
} from "../backend/engine.js";
import { TREATMENT_DURATION_MODES } from "../backend/constants.js";
import { PAPER_INCREMENTAL_RBZ_VS_AFL } from "../backend/config/paper-reference.js";
import {
  MORTALITY_DEFAULTS,
  entryMortalityForSubtype,
  LIFE_TABLE_SOURCE,
} from "../backend/config/mortality.js";
import { fmtJpy } from "../backend/utils.js";
import { STATE_LABELS } from "../backend/constants.js";

const CYCLE_OPTIONS = [
  { value: 0.25, label: "3ヶ月（四半期）" },
  { value: 0.5, label: "6ヶ月" },
  { value: 1, label: "1年" },
];

const NARROW_QUERY = "(max-width: 760px)";

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
  const [subtypeId, setSubtypeId] = useState("typical");
  const [costPaperId, setCostPaperId] = useState("paper2_rbz");
  const [clinicalCase, setClinicalCase] = useState("base");
  const [selectedDrugIds, setSelectedDrugIds] = useState([
    "ranibizumab_bs",
    "aflibercept",
    "faricimab",
  ]);
  const [referenceDrugId, setReferenceDrugId] = useState("aflibercept");
  const [treatmentDurationMode, setTreatmentDurationMode] = useState("years_5");
  const [timeHorizonYears, setTimeHorizonYears] = useState(25);
  const [cycleLengthYears, setCycleLengthYears] = useState(0.25);
  const [discountRate, setDiscountRate] = useState(2);
  const [activeTab, setActiveTab] = useState("summary");
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
  const [switchCurrentDrugId, setSwitchCurrentDrugId] = useState("aflibercept_bs");
  const [switchTargetDrugId, setSwitchTargetDrugId] = useState("aflibercept_8mg");
  const [switchIntervalInput, setSwitchIntervalInput] = useState("8");
  const switchCurrentIntervalWeeks = parseFloat(switchIntervalInput);
  const switchIntervalValid =
    Number.isFinite(switchCurrentIntervalWeeks) && switchCurrentIntervalWeeks >= 2;

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
    return computeBreakEvenTable({
      currentDrugId: switchCurrentDrugId,
      currentIntervalWeeks: switchCurrentIntervalWeeks,
      costPaperId,
      wtpPerQaly: DEFAULT_HORIZON.wtpPerQaly,
    });
  }, [switchIntervalValid, switchCurrentDrugId, switchCurrentIntervalWeeks, costPaperId]);

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

  const toggleDrug = (id) => {
    setSelectedDrugIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const costChartData = selectedDrugIds
    .filter((id) => results[id]?.totalCost != null)
    .map((id) => ({
      name: DRUG_CATALOG[id].name,
      total: Math.round(results[id].totalCost / 1_000_000),
      drug: results[id].costBreakdown?.drugAdmin
        ? Math.round(results[id].costBreakdown.drugAdmin / 1_000_000)
        : 0,
      societal: results[id].costBreakdown
        ? Math.round(
            (results[id].costBreakdown.societalCare +
              results[id].costBreakdown.physicianVisit) /
              1_000_000
          )
        : 0,
      color: DRUG_CATALOG[id].color,
    }));

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

  const hasIncompleteResults = selectedDrugIds.some((id) => results[id]?.incomplete);
  const showIssuesTab = missingParams.length > 0 || hasIncompleteResults;

  const formatIcer = (row) => {
    if (typeof row.icer === "number") return `¥${fmtJpy(row.icer)}/QALY`;
    return row.icer;
  };

  return (
    <div style={{ fontFamily: "'Noto Sans JP', sans-serif", background: "#F1F5F9", minHeight: "100vh" }}>
      <header
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
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isNarrow ? "1fr" : "minmax(300px, 340px) 1fr",
          gap: 0,
          maxWidth: 1280,
          margin: "0 auto",
        }}
      >
        <aside
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
                  サブタイプ共通。導入期（最初3か月）は 3.0 回/年。2年目以降は year1 − 3。
                </p>
              </div>
            )}
          </Section>

          <Section title="QALY パラメータ">
            <p style={hintStyle}>
              補足表に未掲載。出典を確認のうえ入力（空欄のままでは QALY は算出されません）。
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
              {LIFE_TABLE_SOURCE}。男性比率 {((DEFAULT_MODEL_PARAMS.maleRatio ?? 0.614) * 100).toFixed(1)}%。
              本サブタイプ平均年齢 {SUBTYPES[subtypeId].meanAge} 歳の qx ≈{" "}
              {entryMortalityForSubtype(SUBTYPES[subtypeId].meanAge).toFixed(4)}（コホートはサイクルごとに加齢）。
              感度分析では固定値 0.02–0.04 を上書き入力。
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
          <nav style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {[
              ["summary", "サマリー"],
              ["costs", "コスト内訳"],
              ["switch", "スイッチ・CMA"],
              ["qaly", "QALY推移"],
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

          {activeTab === "costs" && (
            <Panel title="コスト内訳（百万円）">
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={costChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="drug" name="薬剤+投与" stackId="a" fill="#3B82F6" />
                  <Bar dataKey="societal" name="社会的費用" stackId="a" fill="#94A3B8" />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          )}

          {activeTab === "switch" && (
            <Panel title="薬剤スイッチ — 損益分岐間隔（QALY 中立 CMA）">
              <p style={{ fontSize: 12, color: "#64748B", lineHeight: 1.6, marginTop: 0 }}>
                <strong>損益分岐間隔 = 現行間隔 × 価格比（スイッチ先1回コスト ÷ 現行1回コスト）</strong>。
                年間薬剤費 = 1回コスト × 52 ÷ 間隔（週）なので、この間隔で年間薬剤費が現行と一致します。
                QALY 不変（CMA）の前提では、スイッチ先がこの間隔以上に延長できるかが判断基準です。
                1回コスト = 薬価 + 注射手技料（選択コスト出典）。
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
                                <td style={tdStyle} colSpan={8}>
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
                    各薬剤の曲線が点線（現行の年間薬剤費）と交わる間隔が損益分岐。
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

          {activeTab === "qaly" && (
            <Panel title="累積 QALY（全選択薬剤）">
              {!hasQalyTrajectory ? (
                <p style={{ color: "#B45309" }}>
                  効用パラメータが未設定のため QALY 曲線を表示できません。左サイドバー「QALY
                  パラメータ」を確認してください。
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={360}>
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
            </Panel>
          )}

          {activeTab === "validate" && costPaperId === "paper2_rbz" && (
            <Panel title={`Table S12 照合（${subtype.label}・シナリオ）`}>
              <p style={{ fontSize: 12, color: "#64748B", marginBottom: 12 }}>
                臨床=シナリオ（S7–S8）で再計算した値と論文記載値の比較。
                遷移確率は合計100%に正規化（PCVシナリオの丸め誤差対策）。
              </p>
              <ScrollTable>
              <table style={{ ...tableStyle, minWidth: 480 }}>
                <thead>
                  <tr style={{ background: "#334155", color: "#fff" }}>
                    <th style={thStyle}>薬剤</th>
                    <th style={thStyle}>指標</th>
                    <th style={thStyle}>論文 S12</th>
                    <th style={thStyle}>本ツール</th>
                  </tr>
                </thead>
                <tbody>
                  {(s12ValidationRows ?? []).flatMap(({ id, refv, scen }) => {
                    return ["QALY", "Cost"].map((metric, idx) => (
                      <tr key={`${id}-${metric}`} style={{ background: idx % 2 ? "#fff" : "#F8FAFC" }}>
                        <td style={tdStyle}>{DRUG_CATALOG[id].name}</td>
                        <td style={tdStyle}>{metric}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {metric === "QALY" ? refv.qaly.toFixed(3) : `¥${fmtJpy(refv.cost)}`}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {metric === "QALY"
                            ? scen?.totalQALY?.toFixed(3) ?? "—"
                            : scen?.totalCost != null
                              ? `¥${fmtJpy(scen.totalCost)}`
                              : "—"}
                        </td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
              </ScrollTable>

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
