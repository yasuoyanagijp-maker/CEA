import { describe, it, expect, vi } from "vitest";
import {
  ANALYTICS_TABS,
  DEFAULT_GOATCOUNTER_SITE,
  analyticsEndpoint,
  analyticsPath,
  buildCountUrl,
  initAnalytics,
  isLocalHost,
  resolveGoatcounterSite,
  safeReferrer,
} from "../frontend/analytics.js";

function fakeDocument({ title = "nAMD CEA", referrer = "" } = {}) {
  const attrs = {};
  const nodes = [];
  const documentElement = {
    getAttribute(name) {
      return attrs[name];
    },
    setAttribute(name, value) {
      attrs[name] = value;
    },
    appendChild(el) {
      nodes.push(el);
      return el;
    },
  };
  return {
    nodes,
    title,
    referrer,
    documentElement,
    createElement() {
      return { src: "", alt: "", setAttribute() {} };
    },
  };
}

const SHARE_SEARCH = "?tab=patient&age=68&sex=female&income=standard&seed=7";

describe("analyticsPath", () => {
  it("既定タブは summary で、クエリの個人設定は付けない", () => {
    expect(analyticsPath("", "/CEA/")).toBe("/CEA/summary");
    expect(analyticsPath(SHARE_SEARCH, "/CEA/")).toBe("/CEA/patient");
    expect(analyticsPath("tab=switch", "/")).toBe("/switch");
  });

  it("未知の tab は summary に落とす", () => {
    expect(analyticsPath("?tab=nonsense", "/CEA/")).toBe("/CEA/summary");
  });

  it("許可タブは4つだけ", () => {
    expect(ANALYTICS_TABS).toEqual(["summary", "patient", "switch", "vision"]);
  });
});

describe("resolveGoatcounterSite / endpoint", () => {
  it("既定コードを受け入れる", () => {
    expect(resolveGoatcounterSite(DEFAULT_GOATCOUNTER_SITE)).toBe("yanagi-cea");
    expect(analyticsEndpoint(DEFAULT_GOATCOUNTER_SITE)).toBe(
      "https://yanagi-cea.goatcounter.com/count"
    );
  });

  it("不正なサイトコードは空文字", () => {
    expect(resolveGoatcounterSite("https://evil.example/x")).toBe("");
    expect(resolveGoatcounterSite("yanagi cea")).toBe("");
    expect(analyticsEndpoint("yanagi cea")).toBe("");
  });
});

describe("buildCountUrl", () => {
  const endpoint = "https://yanagi-cea.goatcounter.com/count";

  it("path / title / screen だけで、q と共有クエリは付けない", () => {
    const url = buildCountUrl(endpoint, {
      path: analyticsPath(SHARE_SEARCH, "/CEA/"),
      title: "nAMD CEA — 抗VEGF 費用対効果",
      referrer: "https://example.com/mail?age=68&income=standard",
      screenWidth: 1400,
      rnd: "abc12",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(endpoint);
    expect(u.searchParams.get("p")).toBe("/CEA/patient");
    expect(u.searchParams.get("t")).toBe("nAMD CEA — 抗VEGF 費用対効果");
    expect(u.searchParams.get("r")).toBe("https://example.com");
    expect(u.searchParams.get("s")).toBe("1400");
    expect(u.searchParams.get("rnd")).toBe("abc12");
    expect(u.searchParams.get("q")).toBeNull();
    expect(url).not.toMatch(/age=|sex=|income=|seed=/);
    expect([...u.searchParams.keys()].sort()).toEqual(["p", "r", "rnd", "s", "t"]);
  });
});

describe("safeReferrer / isLocalHost", () => {
  it("参照元は origin だけ残す", () => {
    expect(safeReferrer("https://mail.example/x?seed=7")).toBe("https://mail.example");
    expect(safeReferrer("not a url")).toBe("");
  });

  it("localhost と file は数えない", () => {
    expect(isLocalHost("127.0.0.1", "http:")).toBe(true);
    expect(isLocalHost("localhost", "http:")).toBe(true);
    expect(isLocalHost("example.com", "file:")).toBe(true);
    expect(isLocalHost("yasuoyanagijp-maker.github.io", "https:")).toBe(false);
  });
});

describe("initAnalytics", () => {
  it("開発時は送らない", () => {
    const sendBeacon = vi.fn();
    const doc = fakeDocument();
    expect(
      initAnalytics({
        prod: false,
        doc,
        loc: { search: "", pathname: "/CEA/", hostname: "example.com", protocol: "https:" },
        win: { navigator: { sendBeacon }, screen: { width: 800 } },
      })
    ).toBe(false);
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(doc.nodes).toHaveLength(0);
  });

  it("localhost では送らない", () => {
    const sendBeacon = vi.fn();
    const doc = fakeDocument();
    expect(
      initAnalytics({
        prod: true,
        doc,
        loc: { search: "", pathname: "/CEA/", hostname: "127.0.0.1", protocol: "http:" },
        win: { navigator: { sendBeacon }, screen: { width: 800 } },
      })
    ).toBe(false);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("本番では自前の count URL だけ送り、共有クエリも count.js も使わない", () => {
    const sendBeacon = vi.fn(() => true);
    const doc = fakeDocument({
      referrer: "https://example.net/share?age=75&income=standard",
    });
    const loc = {
      search: SHARE_SEARCH,
      pathname: "/CEA/",
      hostname: "yasuoyanagijp-maker.github.io",
      protocol: "https:",
    };
    expect(
      initAnalytics({
        prod: true,
        doc,
        loc,
        win: { navigator: { sendBeacon }, screen: { width: 1400 } },
      })
    ).toBe(true);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const url = sendBeacon.mock.calls[0][0];
    expect(url).toMatch(/^https:\/\/yanagi-cea\.goatcounter\.com\/count\?/);
    expect(url).not.toContain("gc.zgo.at");
    expect(url).not.toMatch(/[?&]q=/);
    expect(url).not.toMatch(/age=|sex=|income=|seed=/);
    expect(new URL(url).searchParams.get("p")).toBe("/CEA/patient");
    expect(new URL(url).searchParams.get("r")).toBe("https://example.net");
    expect(doc.nodes).toHaveLength(0);
  });

  it("二重送信しない", () => {
    const sendBeacon = vi.fn(() => true);
    const doc = fakeDocument();
    const loc = {
      search: "",
      pathname: "/CEA/",
      hostname: "yasuoyanagijp-maker.github.io",
      protocol: "https:",
    };
    const win = { navigator: { sendBeacon }, screen: { width: 800 } };
    expect(initAnalytics({ prod: true, doc, loc, win })).toBe(true);
    expect(initAnalytics({ prod: true, doc, loc, win })).toBe(false);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it("sendBeacon が使えないときは 1x1 画像に落とす", () => {
    const doc = fakeDocument();
    expect(
      initAnalytics({
        prod: true,
        doc,
        loc: {
          search: "",
          pathname: "/CEA/",
          hostname: "yasuoyanagijp-maker.github.io",
          protocol: "https:",
        },
        win: { navigator: {}, screen: { width: 800 } },
      })
    ).toBe(true);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0].src).toMatch(/^https:\/\/yanagi-cea\.goatcounter\.com\/count\?/);
    expect(doc.nodes[0].src).not.toMatch(/[?&]q=/);
  });
});
