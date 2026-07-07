/**
 * App の SSR スモークテスト — 各タブが例外なくレンダリングされることを確認する。
 * URL クエリ初期化（tab/age/income など）も同時に検証する。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToString } from "react-dom/server";

function shimWindow(search) {
  const mql = {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.window = {
    location: { search, origin: "http://localhost", pathname: "/" },
    matchMedia: () => mql,
  };
}

async function renderAppWithSearch(search) {
  vi.resetModules();
  shimWindow(search);
  const { default: App } = await import("../frontend/App.jsx");
  return renderToString(<App />);
}

describe("App SSR スモーク（タブ別レンダリング）", () => {
  beforeEach(() => {
    delete globalThis.window;
  });

  it("summary タブ（既定）", async () => {
    const html = await renderAppWithSearch("");
    expect(html).toContain("結果 — "); // summary パネルのタイトル
  });

  it("patient タブ — URL クエリで年齢・所得区分・タブを初期化", async () => {
    const html = await renderAppWithSearch(
      "?tab=patient&age=68&sex=female&income=general&seed=7"
    );
    expect(html).toContain("治療シミュレーション");
    expect(html).toContain("女性 68歳");
    expect(html).toContain("患者説明モード（簡易表示）");
    expect(html).toContain("途中スイッチ試算");
  });

  it("switch タブ — 患者負担列と現行間隔を URL から復元", async () => {
    const html = await renderAppWithSearch(
      "?tab=switch&drug=aflibercept_bs&target=aflibercept_8mg&interval=10&age=75&income=standard"
    );
    expect(html).toContain("スイッチングシミュレーション");
    expect(html).toContain("同一間隔 Δ患者負担/年");
    expect(html).toContain("患者自己負担");
  });

  it("vision タブ", async () => {
    const html = await renderAppWithSearch("?tab=vision");
    expect(html).toContain("視力推移 — 期待 BCVA");
  });

  it("不正な URL クエリは無視して既定値で描画", async () => {
    const html = await renderAppWithSearch(
      "?tab=nonsense&age=999&sex=other&income=zzz&drug=unknown&interval=99"
    );
    expect(html).toContain("結果 — "); // 既定の summary パネルに帰着
    expect(html).not.toContain("治療シミュレーション —");
  });
});
