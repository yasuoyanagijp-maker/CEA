/**
 * コスト論文間の共通値の一致を担保する。
 * (薬価・モニタリング表は出典が同一のため、論文モジュール間でズレたら誤り)
 */
import { describe, it, expect } from "vitest";
import { PAPER1 } from "../backend/papers/paper1-faricimab.js";
import { PAPER2 } from "../backend/papers/paper2-rbz-subtype.js";
import { DRUG_IDS } from "../backend/drugs.js";
import { DEFAULT_TRANSPORT } from "../backend/config/transport.js";

describe("論文1・論文2 の共通コスト定数", () => {
  it("薬価テーブルが一致し、全薬剤をカバーする", () => {
    expect(PAPER1.drugPrices).toEqual(PAPER2.drugPrices);
    for (const id of DRUG_IDS) {
      expect(PAPER2.drugPrices[id], `薬価未設定: ${id}`).toBeTypeOf("number");
    }
  });

  it("モニタリング表(回数・単価)が一致する", () => {
    expect(PAPER1.monitoring).toEqual(PAPER2.monitoring);
  });

  it("論文2の交通費は共通デフォルトと一致する", () => {
    expect(PAPER2.societal.transport).toEqual(DEFAULT_TRANSPORT);
  });
});
