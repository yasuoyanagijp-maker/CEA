/** GitHub Pages 本番のページビュー計測。入力値・所得区分は送らない。 */

export const DEFAULT_GOATCOUNTER_SITE = "yanagi-cea";
export const ANALYTICS_TABS = Object.freeze([
  "summary",
  "patient",
  "switch",
  "vision",
]);

const SITE_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i;

export function resolveGoatcounterSite(raw) {
  const site = String(raw ?? "").trim();
  return SITE_RE.test(site) ? site : "";
}

/** 初期タブだけをパスにする。age / income / seed などは付けない。 */
export function analyticsPath(search = "", pathname = "/") {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const tab = new URLSearchParams(query).get("tab");
  const base = String(pathname || "/").replace(/\/+$/, "");
  const safeTab = ANALYTICS_TABS.includes(tab) ? tab : "summary";
  return `${base}/${safeTab}`;
}

export function initAnalytics({
  prod = import.meta.env.PROD,
  site = import.meta.env.VITE_GOATCOUNTER_SITE || DEFAULT_GOATCOUNTER_SITE,
  doc = typeof document !== "undefined" ? document : null,
  loc = typeof window !== "undefined" ? window.location : null,
  win = typeof window !== "undefined" ? window : null,
} = {}) {
  const resolved = resolveGoatcounterSite(site);
  if (!prod || !doc?.createElement || !loc || !win || !resolved) return false;
  if (doc.querySelector("script[data-goatcounter]")) return false;

  win.goatcounter = {
    no_onload: true,
    allow_local: false,
    path: () => analyticsPath(loc.search || "", loc.pathname || "/"),
  };

  const script = doc.createElement("script");
  script.async = true;
  script.src = "https://gc.zgo.at/count.js";
  script.dataset.goatcounter = `https://${resolved}.goatcounter.com/count`;
  script.onload = () => {
    if (typeof win.goatcounter?.count === "function") win.goatcounter.count();
  };
  (doc.head || doc.body || doc.documentElement).appendChild(script);
  return true;
}
