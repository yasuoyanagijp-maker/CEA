/** GitHub Pages 本番のページビュー計測。入力値・所得区分・URL クエリは送らない。 */

export const DEFAULT_GOATCOUNTER_SITE = "yanagi-cea";
export const ANALYTICS_TABS = Object.freeze([
  "summary",
  "patient",
  "switch",
  "vision",
]);

const SITE_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i;
const SENT_ATTR = "data-cea-analytics";
const LOCAL_HOST =
  /(localhost$|^127\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\.|^0\.0\.0\.0$)/;
const LEAK_RE = /(?:^|[?&])(?:q|age|sex|income|seed|subtype|drug|target|interval)=/i;

export function resolveGoatcounterSite(raw) {
  const site = String(raw ?? "").trim();
  return SITE_RE.test(site) ? site : "";
}

export function analyticsEndpoint(site) {
  const resolved = resolveGoatcounterSite(site);
  return resolved ? `https://${resolved}.goatcounter.com/count` : "";
}

/** 初期タブだけをパスにする。age / income / seed などは付けない。 */
export function analyticsPath(search = "", pathname = "/") {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const tab = new URLSearchParams(query).get("tab");
  const base = String(pathname || "/").replace(/\/+$/, "");
  const safeTab = ANALYTICS_TABS.includes(tab) ? tab : "summary";
  return `${base}/${safeTab}`;
}

export function isLocalHost(hostname = "", protocol = "") {
  if (protocol === "file:") return true;
  return LOCAL_HOST.test(String(hostname));
}

/** 参照元は origin のみ。共有 URL のクエリを引き継がない。 */
export function safeReferrer(raw = "") {
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

export function buildCountUrl(
  endpoint,
  { path, title, referrer, screenWidth, rnd } = {}
) {
  const u = new URL(endpoint);
  u.search = "";
  u.searchParams.set("p", path);
  if (title) u.searchParams.set("t", title);
  const origin = safeReferrer(referrer);
  if (origin) u.searchParams.set("r", origin);
  if (Number.isFinite(screenWidth)) u.searchParams.set("s", String(screenWidth));
  u.searchParams.set("rnd", rnd || "1");
  return u.toString();
}

export function initAnalytics({
  prod = import.meta.env.PROD,
  site = import.meta.env.VITE_GOATCOUNTER_SITE || DEFAULT_GOATCOUNTER_SITE,
  doc = typeof document !== "undefined" ? document : null,
  loc = typeof window !== "undefined" ? window.location : null,
  win = typeof window !== "undefined" ? window : null,
} = {}) {
  const endpoint = analyticsEndpoint(site);
  if (!prod || !doc?.createElement || !loc || !win || !endpoint) return false;
  if (doc.documentElement?.getAttribute?.(SENT_ATTR) === "1") return false;
  if (isLocalHost(loc.hostname || "", loc.protocol || "")) return false;

  const url = buildCountUrl(endpoint, {
    path: analyticsPath(loc.search || "", loc.pathname || "/"),
    title: doc.title || "",
    referrer: doc.referrer || "",
    screenWidth: win.screen?.width,
    rnd: Math.random().toString(36).slice(2, 7),
  });
  if (LEAK_RE.test(url)) return false;

  doc.documentElement?.setAttribute?.(SENT_ATTR, "1");

  const beacon = win.navigator?.sendBeacon;
  if (typeof beacon === "function" && beacon.call(win.navigator, url)) return true;

  const img = doc.createElement("img");
  img.src = url;
  img.alt = "";
  img.setAttribute("aria-hidden", "true");
  (doc.body || doc.documentElement || doc.head).appendChild(img);
  return true;
}
