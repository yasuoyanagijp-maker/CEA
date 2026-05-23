/** 論文2 S11 — 訪問交通費（Assumption） */
export const DEFAULT_TRANSPORT = {
  travelKmPerVisit: 1,
  costPerKmJpy: 500,
  parkingJpy: 100,
};

export function transportationCostPerVisit(t = DEFAULT_TRANSPORT) {
  return t.travelKmPerVisit * t.costPerKmJpy + t.parkingJpy;
}
