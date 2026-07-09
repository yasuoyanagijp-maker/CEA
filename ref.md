# 参考文献 (References)

本ツール（nAMD 抗VEGF QALY・コスト算出／スイッチ CMA タブ）が依拠する根拠文献を、
将来の論文化に備えて用途別に整理する。DOI は原則 CrossRef 準拠。
実装上の参照箇所をあわせて記載する。

---

## 1. 費用対効果分析の基盤論文（Base CEA papers）

本ツールの臨床遷移・コスト・QALY 構造の直接の出典。柳（Yanagi）らの2論文を核とする。

| ID | 内容 | 出典 | 実装参照 |
|----|------|------|----------|
| `paper2_rbz` | ラニビズマブ BS / nAMD サブタイプ CEA 補足（Table S1–S12：初期分布・遷移・注射回数・社会的費用） | Ophthalmology and Therapy, 13, 2629–2644 | `backend/papers/paper2-rbz-subtype.js`, `backend/config/paper-reference.js` |
| `paper1_faricimab` | ファリシマブ nAMD CEA（薬価・投与コストは補足より） | Journal of Medical Economics, 28, 448–459 | `backend/papers/paper1-faricimab.js` |

- **Yanagi et al.** *Cost-effectiveness of ranibizumab biosimilar for neovascular age-related macular degeneration by subtype.* Ophthalmology and Therapy, 13, 2629–2644.
- **Yanagi et al.** *Cost-effectiveness of faricimab for neovascular age-related macular degeneration in Japan.* Journal of Medical Economics, 28, 448–459.

> 増分値（参照薬アフリベルセプト vs ラニビズマブ BS、サブタイプ別 ΔQALY・Δコスト）は
> `backend/config/paper-reference.js` に格納（社会的視点・患者視点）。

---

## 2. 年間注射回数のエビデンス（Injection burden）

### 2.1 メタ解析・NMA（year1 注射回数の基準値）

`backend/config/injections-2026-meta.js` の year1 注射回数（ファリシマブ 6.45、アフリベルセプト 8mg 5.5、
アフリベルセプト 2mg 7.67、ラニビズマブ 9.85、ブロルシズマブ 6.3）の根拠。

**実装ロジック（2026 meta default）**

- 1年目（`year1`）は上記メタ解析/NMAの薬剤別平均注射回数を使用。
- 2年目以降（`year2`, `year3plus`）は原則 `year1 − 3` 回/年（導入期3回を除いた維持負担の近似）。
- 例外: **アフリベルセプト 8mg** は PULSAR の Q16 到達率（96週時点で Q16 78%）と、臨床的にファリシマブと同程度の注射負担とみなす方針を反映し、2年目以降は **Q16 維持相当 = 52/16 = 3.25 回/年** とする。
- この設定により、ファリシマブ `year2+ = 6.45 − 3 = 3.45 回/年` とアフリベルセプト 8mg `year2+ = 3.25 回/年` が近接し、臨床感覚とRCT到達率の両方に整合する。Q12（4.33回/年）はスイッチ実臨床の保守的下限として扱い、default 長期維持値には採用しない。

- **Wojciechowski P, et al.** (2025). Efficacy, Safety, and Injection Frequency with Novel Aflibercept 8 mg in Neovascular Age-Related Macular Degeneration: A Comparison with Existing Anti-VEGF Regimens Using a Bayesian Network Meta-Analysis. *Ophthalmology and Therapy, 14, 733–753.* https://doi.org/10.1007/s40123-025-01098-y
- **Butler E, et al.** (2025). Comparative efficacy of intravitreal anti-VEGF therapy for neovascular age-related macular degeneration: A systematic review with network meta-analysis. *Acta Ophthalmologica, 103, 741–763.* https://doi.org/10.1111/aos.17506
- **Friedman S, et al.** (2025). Aflibercept 8 mg versus Faricimab Treat-and-Extend for Diabetic Macular Edema or Neovascular Age-Related Macular Degeneration: A Bayesian Fixed-Effect Network Meta-analysis of Clinical Trials. *Ophthalmology and Therapy, 14, 2919–2936.* https://doi.org/10.1007/s40123-025-01247-3
- **Li G, Zhu N, Ji A.** (2023). Comparative efficacy and safety of Faricimab and other anti-VEGF therapy for AMD and DME: A systematic review and meta-analysis of RCTs. *Medicine, 102.* https://doi.org/10.1097/md.0000000000036370
- **Samacá-Samacá D, et al.** (2024). Efficacy and safety of faricimab for neovascular AMD: a systematic review and network meta-analysis. *BMJ Open Ophthalmology, 9.* https://doi.org/10.1136/bmjophth-2024-001702
- **Kaliaperumal R, et al.** (2025). Comparative efficacy and safety of Faricimab with other intravitreal anti-VEGF in nAMD — A Systematic review and meta-analysis. *Asian Journal of Medical Sciences.* https://doi.org/10.71152/ajms.v16i5.4487
- **Matonti F, et al.** (2022). Comparative Effectiveness of Intravitreal Anti-VEGF Therapies for Managing Neovascular AMD: A Meta-Analysis. *Journal of Clinical Medicine, 11.* https://doi.org/10.3390/jcm11071834
- **Sun H, et al.** (2024). Two-year efficacy and safety of different anti-VEGF regimens for neovascular AMD: a network meta-analysis of RCTs. *Eye, 38, 3473–3480.* https://doi.org/10.1038/s41433-024-03327-3

### 2.2 経済モデル（長期注射負担の外挿）

- **Baljoon A, et al.** (2026). Cost-Utility Analysis of Faricimab Versus Aflibercept in Treating nAMD in the United States. *PharmacoEconomics - Open.* https://doi.org/10.1007/s41669-026-00643-0
- **Alili E, et al.** (2026). Budget Impact of Faricimab in Neovascular AMD in the Netherlands: A Systematic Review and Meta-Analysis of Injection Count. *Ophthalmology and Therapy, 15, 591–639.* https://doi.org/10.1007/s40123-025-01301-0

---

## 3. スイッチ／間隔延長エビデンス（Switch-interval evidence）

`backend/config/switch-interval-evidence.js` の `realisticExtensionWeeks`・`trialReach`・
`trialEvidenceTier` の根拠。到達可能性の段階判定に直接使用。

### 3.1 ファリシマブ（trialReach: ≥Q12W 77.8% / Q16W 63.1%、tier = direct）

- **Khanani AM, et al.** (2024). TENAYA/LUCERNE — faricimab T&E, PTI 到達率（week112 pooled global）.
- **Koizumi H, et al.** (2024). TENAYA/LUCERNE 日本亜群解析.
- **London N, et al.** (2025). Faricimab 長期アウトカム.
- **Mori R, et al.** (2023). Faricimab 実臨床.
- **Alili E, et al.** (2026). スイッチ後注射回数 9.70→7.05/年（Δ ≈ −2.65）. https://doi.org/10.1007/s40123-025-01301-0
- **Jin E, Chan A, Thomas G.** (2025). Efficacy of faricimab secondary to anti-VEGF agents in nAMD: a systematic review and meta-analysis. *Eye, 39, 2738–2751.* https://doi.org/10.1038/s41433-025-03943-7
- **Khodor A, et al.** (2025). Functional and Anatomical Outcomes of Faricimab in Previously Treated Wet AMD: Systematic Review and Pooled Analysis. *Ophthalmology and Therapy, 14, 1965–1984.* https://doi.org/10.1007/s40123-025-01181-4
- **Zhang C, et al.** (2025). Clinical Efficacy of Switching to Faricimab in Treatment Resistant Neovascular AMD: Systematic Review and Meta-analysis. *American Journal of Ophthalmology.* https://doi.org/10.1016/j.ajo.2025.08.034

### 3.2 ブロルシズマブ（trialReach: ≥Q12W 77% / Q16W 54%、tier = modeled）

- **Dugel PU, et al.** (2019/2020). HAWK / HARRIER — brolucizumab q12w/q8w 固定割付（q12w 到達率実測）.
- **Singer M, et al.** (2022). HAWK/HARRIER post hoc（≥Q12W 76–78% / Q16W 52–56%）— trialReach modeled 層の根拠.
- **Regillo C, et al.** (2025). TALON — brolucizumab T&E.
- **Inoda S, et al.** (2024). One-year outcome of brolucizumab for nAMD in Japanese patients（naïve 6.2 / switch 5.2 回/年）. *Scientific Reports, 14.* https://doi.org/10.1038/s41598-024-52747-4
- **Finger R, et al.** (2022). Comparative Efficacy of Brolucizumab in nAMD: Systematic Literature Review and NMA（年2時点 ≈5.7 回/年）. *Advances in Therapy, 39, 3425–3448.* https://doi.org/10.1007/s12325-022-02193-3
- **Abdin A, et al.** (2022). First Year Real Life Experience With Intravitreal Brolucizumab for Refractory nAMD（抵抗例 9.6→6.4 回/年）. *Frontiers in Pharmacology, 13.* https://doi.org/10.3389/fphar.2022.860784
- **Matsumoto H, et al.** (2022). One-year results of T&E with intravitreal brolucizumab for treatment-naïve nAMD (type1 MNV; 6.4 回/年). *Scientific Reports, 12.* https://doi.org/10.1038/s41598-022-10578-1
- **Kim D, et al.** (2024). Long-term efficacy and safety of brolucizumab in nAMD: a multicentre retrospective real-world study. *Acta Ophthalmologica, 102, e1018–e1028.* https://doi.org/10.1111/aos.16699
- **Rossi S, et al.** (2025). Treatment of nAMD: one year real-life results with intravitreal Brolucizumab. *Frontiers in Medicine, 11.* https://doi.org/10.3389/fmed.2024.1467160
- **Scupola A, et al.** (2025). Brolucizumab for Wet AMD in Switch Patients: Long-Term Real-World Experience (1年 4.7 → 2年 3.9 → 3年 3.6 回/年). *Ophthalmologica, 248, 367–377.* https://doi.org/10.1159/000547471

### 3.3 アフリベルセプト 8mg（trialReach: 16週78% / 20週53% / 24週31%、tier = direct; スイッチ到達 Q12W 20.2%）

- **Korobelnik JF, et al.** (2025). PULSAR — aflibercept 8 mg（96週 8q16 群の最終割付間隔・絶対到達率、trialReach direct 層の根拠）.
- **Kitay ... et al.** (2026). 実臨床スイッチ集団：平均 7.1→9.4 週、12週以上到達 20.2%（`switchReach` の根拠）.
- **Lee ... et al.** (2026). 8mg スイッチ 実臨床（6.0→7.8 週）.
- **Musadiq ... et al.** (2025). 8mg スイッチ 実臨床（7.7→8.7 週）.
- **Emfietzoglou ... et al.** (2026). 8mg スイッチ 実臨床（中央値 10→12 週）.

> 上記5件は本ツールの `aflibercept_8mg.sources` に記載。原著の巻号・DOI は論文化の際に一次資料で確定すること（本ツール内では著者・年で管理）。

### 3.4 アフリベルセプト 2mg（trialReach: ≥Q12W 57% / ≥Q16W 44%、tier = t&e-derived）

T&E 運用下の到達率であり、スイッチ集団の直接到達ではない点に注意（naïve T&E の上限参照）。

- **Ohji M, et al.** (2020). ALTAIR — aflibercept 2mg T&E（96週 ≥12週 56.9/60.2%・≥16週 42–46%、PCV 51.1%）.
- **Mitchell P, et al.** (2021). ARIES — aflibercept 2mg T&E（104週 ≥12週 47.2/51.9%）. *Retina, 41, 1911–1920.* https://doi.org/10.1097/iae.0000000000003128
- **Chaikitmongkol V, et al.** (2021). Treat-and-Extend Regimens for nAMD and PCV: Consensus and Recommendations From the Asia-Pacific Vitreo-retina Society（ALTAIR 由来 16週到達 46%、96.3% が week96 まで維持）. *Asia-Pacific Journal of Ophthalmology, 10, 507–518.* https://doi.org/10.1097/apo.0000000000000445
- **Kodjikian L, et al.** (2024). AZURE — aflibercept for nAMD Beyond One Year: RCT of Treat-and-Extend vs. Fixed Dosing（既治療集団 week76 で ≥12週 37.0%、表ベース 53.3%、≥16週 16.4%）. *Advances in Therapy, 41, 1010–1024.* https://doi.org/10.1007/s12325-023-02719-3
- **Okada M, et al.** (2022). Aflibercept T&E 到達率補助文献.

### 3.5 アフリベルセプト BS（trialReach 借用: ≥Q12W 57% / ≥Q16W 44%、tier = reference-derived）

**重要な限界**: アフリベルセプト BS の非劣性エビデンスは、ほぼすべて **3回ローディング後 q8 週固定** で得られており、
**延長耐久性（T&E での長間隔到達）そのものは直接検証されていない**。したがって本ツールは BS の到達率を
先行品 2mg（ARIES/ALTAIR）から**借用（reference-derived）**として扱い、「BS で実証」ではなく
「**先行品 2mg 由来の推定**」であることを明示する。BS に「Q13.0 到達可能」を BS 固有の確定判定として表示しない。

- **Woo SJ, et al.** (2023). Efficacy and Safety of the Aflibercept Biosimilar SB15 in Neovascular AMD（q8 固定で先行品に非劣性）. *JAMA Ophthalmology, 141, 668–676.* https://doi.org/10.1001/jamaophthalmol.2023.2260
- **Karkhaneh R, et al.** (2024). Evaluating the Efficacy and Safety of Aflibercept Biosimilar (P041) Compared to Originator in nAMD（q8 固定）. *Ophthalmology Retina.* https://doi.org/10.1016/j.oret.2024.02.012
- **Friedman S, et al.** (2025). Randomized Trial of Biosimilar ABP 938 Compared with Reference Aflibercept in nAMD（week16 切替でも有効性・安全性・免疫原性が同様、延長耐久性ではない）. *Ophthalmology Retina.* https://doi.org/10.1016/j.oret.2025.07.015
- **Zhang C, et al.** (2026). Clinical efficacy and safety of aflibercept biosimilars in nAMD: a systematic review and meta-analysis of RCTs（延長耐久性は未検証と明言）. *British Journal of Ophthalmology.* https://doi.org/10.1136/bjo-2025-328196
- **Sawires K, Nithianandan H, Somani S.** (2025). Comparative outcomes of aflibercept biosimilars and reference aflibercept in nAMD: a systematic review and meta-analysis（追跡最大52–56週、延長運用は今後の課題）. *BMJ Open Ophthalmology, 10.* https://doi.org/10.1136/bmjophth-2025-002509
- **Aljuhani H, et al.** (2025). Efficacy and Safety of Aflibercept Biosimilars Relative to Reference Aflibercept Therapy for nAMD: A Systematic Review and Meta-Analysis. *Clinical Ophthalmology, 19, 1911–1918.* https://doi.org/10.2147/opth.s524395
- **Rashid M, et al.** (2025). Efficacy and safety of aflibercept biosimilars compared to reference aflibercept for retinal diseases: A systematic review and meta-analysis. *Survey of Ophthalmology.* https://doi.org/10.1016/j.survophthal.2025.11.007
- **Al-Shammari YM, et al.** (2026). Clinical efficacy and safety of anti-VEGF biosimilars compared to reference anti-VEGF agents for nAMD: a systematic review, meta-analysis, and meta-regression. *International Ophthalmology, 46(1).* https://doi.org/10.1007/s10792-026-04043-5

> 借用元は第3.4節 ARIES/ALTAIR。tier は `t&e-derived`（先行品自体の T&E 由来）ではなく `reference-derived`（BS が先行品から借用）として区別する。

### 3.6 ラニビズマブ / ラニビズマブ BS（trialReach 未収載 = unknown）

ARIES/ALTAIR に相当する ≥Q12/16W T&E 到達率が本エビデンスセットに未収載。一般に他剤より間隔が短く、延長による損益分岐到達は限定的。

- **Wojciechowski P, et al.** (2025). 前掲（Q4〜PRN/T&E 7.6〜12.1 回/年）. https://doi.org/10.1007/s40123-025-01098-y
- **Butler E, et al.** (2025). 前掲. https://doi.org/10.1111/aos.17506

> ラニビズマブ BS は先行 RBZ と同一分子とみなし、スイッチで間隔不変（薬価差のみ）。

---

## 4. BCVA（視力）非劣性・同等性のエビデンス（CMA の QALY 中立仮定の根拠）

スイッチ CMA タブは「QALY ≈ 一定」を前提とする。この仮定は各剤間で BCVA 変化に有意差がない
という以下のメタ解析に依拠する。

- **Yen WT, et al.** (2024). Efficacy and safety of intravitreal faricimab for nAMD: a systematic review and meta-analysis. *Scientific Reports, 14.* https://doi.org/10.1038/s41598-024-52942-3
- **Nichani P, et al.** (2024). Efficacy and Safety of Intravitreal Faricimab in nAMD, DME, and RVO: A Meta-Analysis. *Ophthalmologica, 247, 355–372.* https://doi.org/10.1159/000541662
- **Shibkova P, et al.** (2025). The Role of Anti-VEGF Therapy in the Treatment of AMD: A Comparative Analysis of Drug Efficacy. *Bulletin of Pirogov National Medical & Surgical Center.* https://doi.org/10.25881/20728255_2025_20_3_130
- **Li G, Zhu N, Ji A.** (2023). 前掲. https://doi.org/10.1097/md.0000000000036370
- **Samacá-Samacá D, et al.** (2024). 前掲. https://doi.org/10.1136/bmjophth-2024-001702
- **Sun H, et al.** (2024). 前掲. https://doi.org/10.1038/s41433-024-03327-3
- **Friedman S, et al.** (2025). 前掲（8mg vs faricimab、104週で BCVA 差なし）. https://doi.org/10.1007/s40123-025-01247-3

---

## 5. 薬価・費用パラメータ（Cost parameters）

`backend/config/cost-common.js`。薬価は公定薬価・注射用キット（2026-07 ユーザー確認）。瓶製品は不使用。

| 薬剤 | 薬価（円/キット） |
|------|-------------------|
| アフリベルセプト BS（NIT / バイエル AG） | 67,959 |
| ラニビズマブ BS（センジュ） | 72,136 |
| ラニビズマブ（ルセンティス キット） | 92,753 |
| アフリベルセプト 2 mg（アイリーア キット） | 99,522 |
| ブロルシズマブ（ベオビュ キット） | 103,163 |
| ファリシマブ（バビースモ キット） | 141,784 |
| アフリベルセプト 8 mg（アイリーア キット） | 145,718 |

- 注射手技料: 論文2 = 6,000 円/回（薬価と別建て）／論文1 = 投与コスト包括 12,730 円/回。
- モニタリング（診察・OCT・細隙灯・FA）回数・単価は両論文補足で同一（`MONITORING_STANDARD`）。
- 社会的費用（介護・訪問・交通）は論文2 Table S11（`backend/papers/paper2-rbz-subtype.js`）。

---

## 6. 人口統計・生命表・死亡率（Baseline & mortality）

- **Yoneda et al. [1]** — モデル参入時の年齢（75歳）・両眼罹患率・平均 BCVA・5状態初期分布（Supplementary Table S2）。`backend/config/baseline-characteristics.js`。
- **厚生労働省 令和5年（2023）簡易生命表**（男/女）— 年齢別年間死亡確率 nqx。`backend/config/mortality-life-table-r5.js`（原資料: `死亡率.pdf`）。
- **Lancet Global Health (2021)** — 中等度視力障害の死亡ハザード比 HR ≈ 1.43（既定 1.4）。`backend/config/mortality.js`。
- **VIEW 試験** — 第二眼発症 年率 ≈ 10%（月次換算の目安）。`backend/config/mortality.js`。

---

## 7. モデル構造の出典（Model structure）

Yanagi 論文の Supplementary Table に対応する Markov モデル構成要素。

| Table | 内容 | 実装 |
|-------|------|------|
| Table S2 | 5状態初期分布 | `baseline-characteristics.js` |
| Table S5 | 遷移確率（ベースケース） | `table-s5-transitions.js` |
| Table S6 | 注射回数（ベースケース・年次フェーズ別） | `table-s6-injections.js` |
| Table S7–S8 | シナリオケース | `table-s7-s8-scenario.js` |
| Table S9–S11 | コスト（薬価・手技・社会的費用） | `cost-common.js`, `paper2-rbz-subtype.js` |
| Table S12 | 効用値（health-state utilities） | `default-model-params.js`（0.76 / 0.70 / 0.64 / 0.60 / 0.51） |

---

## 注記

- 本ファイルは実装（`backend/config/*.js`）に埋め込まれた根拠を集約したものであり、
  論文化の際は各文献を一次資料で再確認し、巻・号・ページ・DOI を最終確定すること。
- 特に第3.3節（aflibercept 8mg スイッチ実臨床報告）は本ツール内で著者・年のみ管理しており、
  巻号・DOI が未確定。投稿前に PubMed / CrossRef で照合が必要。
- データ抽出の一部は Consensus（AI 研究検索）由来のメタ要約を経由している（`#injections_meta.txt`）。
  数値・出典は原著で検証すること。
