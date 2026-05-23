import { PAPER1 } from "./paper1-faricimab.js";
import { PAPER2 } from "./paper2-rbz-subtype.js";

export const COST_PAPERS = {
  [PAPER1.id]: PAPER1,
  [PAPER2.id]: PAPER2,
};

export const COST_PAPER_LIST = [PAPER1, PAPER2];

export function getCostPaper(paperId) {
  return COST_PAPERS[paperId] ?? PAPER2;
}
