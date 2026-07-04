import { PAPER_DEFAULT_INTEGRATED } from "./default-integrated.js";
import { PAPER1 } from "./paper1-faricimab.js";
import { PAPER2 } from "./paper2-rbz-subtype.js";

export const COST_PAPERS = {
  [PAPER_DEFAULT_INTEGRATED.id]: PAPER_DEFAULT_INTEGRATED,
  [PAPER1.id]: PAPER1,
  [PAPER2.id]: PAPER2,
};

export const DEFAULT_COST_PAPER_ID = PAPER_DEFAULT_INTEGRATED.id;

export const COST_PAPER_LIST = [PAPER_DEFAULT_INTEGRATED, PAPER1, PAPER2];

export function getCostPaper(paperId) {
  return COST_PAPERS[paperId] ?? PAPER_DEFAULT_INTEGRATED;
}
