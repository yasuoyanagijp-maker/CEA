import { describe, it, expect, vi } from "vitest";
import {
  ANALYTICS_TABS,
  DEFAULT_GOATCOUNTER_SITE,
  analyticsPath,
  initAnalytics,
  resolveGoatcounterSite,
} from "../frontend/analytics.js";

function fakeDocument() {
  const nodes = [];
  const doc = {
    nodes,
    head: {
      appendChild(el) {
        nodes.push(el);
        return el;
      },
    },
    querySelector(sel) {
      if (sel === "script[data-goatcounter]") {
        return nodes.find((n) => n.dataset?.goatcounter) ?? null;
      }
      return null;
    },
    createElement() {
      return {
        async: false,
        src: "",
        dataset: {},
        onload: null,
      };
    },
  };
  return doc;
}

describe("analyticsPath", () => {
  it("既定タブは summary で、クエリの個人設定は付けない", () => {
    expect(analyticsPath("", "/CEA/")).toBe("/CEA/summary");
    expect(
      analyticsPath("?tab=patient&age=68&income=standard&seed=7", "/CEA/")
    ).toBe("/CEA/patient");
    expect(analyticsPath("tab=switch", "/")).toBe("/switch");
  });

  it("未知の tab は summary に落とす", () => {
    expect(analyticsPath("?tab=nonsense", "/CEA/")).toBe("/CEA/summary");
  });

  it("許可タブは4つだけ", () => {
    expect(ANALYTICS_TABS).toEqual(["summary", "patient", "switch", "vision"]);
  });
});

describe("resolveGoatcounterSite", () => {
  it("既定コードを受け入れる", () => {
    expect(resolveGoatcounterSite(DEFAULT_GOATCOUNTER_SITE)).toBe("yanagi-cea");
  });

  it("不正なサイトコードは空文字", () => {
    expect(resolveGoatcounterSite("https://evil.example/x")).toBe("");
    expect(resolveGoatcounterSite("yanagi cea")).toBe("");
  });
});

describe("initAnalytics", () => {
  it("開発時はスクリプトを入れない", () => {
    const doc = fakeDocument();
    const win = {};
    expect(
      initAnalytics({
        prod: false,
        doc,
        loc: { search: "", pathname: "/CEA/" },
        win,
      })
    ).toBe(false);
    expect(doc.nodes).toHaveLength(0);
  });

  it("本番では GoatCounter だけを読み、初期タブだけを path にする", () => {
    const doc = fakeDocument();
    const win = {};
    const loc = {
      search: "?tab=vision&age=75&income=standard",
      pathname: "/CEA/",
    };
    expect(initAnalytics({ prod: true, doc, loc, win })).toBe(true);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0].src).toBe("https://gc.zgo.at/count.js");
    expect(doc.nodes[0].dataset.goatcounter).toBe(
      "https://yanagi-cea.goatcounter.com/count"
    );
    expect(win.goatcounter.allow_local).toBe(false);
    expect(win.goatcounter.path()).toBe("/CEA/vision");
    expect(win.goatcounter.path()).not.toMatch(/age|income|seed/);
  });

  it("二重初期化しない", () => {
    const doc = fakeDocument();
    const loc = { search: "", pathname: "/CEA/" };
    const win = {};
    expect(initAnalytics({ prod: true, doc, loc, win })).toBe(true);
    expect(initAnalytics({ prod: true, doc, loc, win })).toBe(false);
    expect(doc.nodes).toHaveLength(1);
  });

  it("スクリプト読込後に count を1回呼ぶ", () => {
    const doc = fakeDocument();
    const count = vi.fn();
    const win = {};
    initAnalytics({
      prod: true,
      doc,
      loc: { search: "", pathname: "/CEA/" },
      win,
    });
    win.goatcounter.count = count;
    doc.nodes[0].onload();
    expect(count).toHaveBeenCalledTimes(1);
  });
});
