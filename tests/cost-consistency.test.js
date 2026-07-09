/**
 * コスト論文ごとの値を担保する。
 * 薬剤費はユーザー確認済みの現行値を両論文で共有し、非薬剤コストは論文別に保持する。
 */
import { describe, it, expect } from "vitest";
import {
  ADMINISTRATION_COSTS_JPY,
  ADVERSE_EVENTS_INTEGRATED_NAMD,
  ADVERSE_EVENTS_JME_2025_NAMD,
  ADVERSE_EVENTS_OT_2024_NAMD,
} from "../backend/config/cost-common.js";
import { COST_PAPERS, DEFAULT_COST_PAPER_ID } from "../backend/papers/index.js";
import { PAPER1 } from "../backend/papers/paper1-faricimab.js";
import { PAPER2 } from "../backend/papers/paper2-rbz-subtype.js";
import { DRUG_IDS } from "../backend/drugs.js";
import { DEFAULT_TRANSPORT } from "../backend/config/transport.js";

describe("論文1・論文2 の共通コスト定数", () => {
  it("薬価はキット製品（瓶不使用）で、アイリーア2mgは99,522円", () => {
    expect(PAPER2.drugPrices.aflibercept).toBe(99_522);
    expect(PAPER2.drugPrices.aflibercept_8mg).toBe(145_718);
    expect(PAPER2.drugPrices.aflibercept_bs).toBe(67_959);
    expect(PAPER2.drugPrices.ranibizumab).toBe(92_753);
    expect(PAPER2.drugPrices.ranibizumab_bs).toBe(72_136);
    expect(PAPER2.drugPrices.brolucizumab).toBe(103_163);
    expect(PAPER2.drugPrices.faricimab).toBe(141_784);
  });

  it("薬価テーブルが一致し、全薬剤をカバーする", () => {
    expect(PAPER1.drugPrices).toEqual(PAPER2.drugPrices);
    for (const id of DRUG_IDS) {
      expect(PAPER2.drugPrices[id], `薬価未設定: ${id}`).toBeTypeOf("number");
    }
  });

  it("JME の投与・モニタリング・AE コストを保持する", () => {
    expect(PAPER1.administrationPerInjection).toBe(12_730);
    expect(PAPER1.monitoring.unitCosts.physician).toBe(5_930);
    expect(PAPER1.adverseEvents).toEqual(ADVERSE_EVENTS_JME_2025_NAMD);
    expect(PAPER1.societal.kind).toBe("jme2025");
    expect(PAPER1.societal.informalCareOnTreatmentDay).toBe(11_136);
  });

  it("O&T の投与・モニタリング・AE・社会的費用を保持する", () => {
    expect(PAPER2.injectionFee).toBe(6_000);
    expect(PAPER2.monitoring.kind).toBe("visitBundle");
    expect(PAPER2.monitoring.unitCosts).toEqual({
      initialConsultation: 2_910,
      revisit: 760,
      examSet: 3_730,
      oct: 1_900,
      octa: 4_000,
      fa: 4_000,
    });
    expect(PAPER2.monitoring.octaEveryVisits).toBe(3);
    expect(PAPER2.monitoring.initialFluorescenceAngiographyVisits).toBe(1);
    expect(PAPER2.adverseEvents).toEqual(ADVERSE_EVENTS_OT_2024_NAMD);
    expect(PAPER2.societal.dailyWage).toBe(15_759);
  });

  it("論文2の交通費は共通デフォルトと一致する", () => {
    expect(PAPER2.societal.transport).toEqual(DEFAULT_TRANSPORT);
  });

  it("default コストは平均投与コストを使わず O&T 分解構造を採用する", () => {
    const integrated = COST_PAPERS[DEFAULT_COST_PAPER_ID];
    expect(integrated.injectionFee).toBe(ADMINISTRATION_COSTS_JPY.paper2Rbz);
    expect(integrated.injectionFee).not.toBe(
      Math.round((PAPER1.administrationPerInjection + PAPER2.injectionFee) / 2)
    );
    expect(integrated.drugPrices).toEqual(PAPER2.drugPrices);
    expect(integrated.adverseEvents).toEqual(ADVERSE_EVENTS_INTEGRATED_NAMD);
    expect(
      integrated.adverseEvents.find((ae) => ae.id === "retinalArteryOcclusion")
        ?.unitCost
    ).toBe(8_820);
    expect(integrated.monitoring).toEqual(PAPER2.monitoring);
    expect(integrated.societal).toEqual(PAPER2.societal);
  });
});
