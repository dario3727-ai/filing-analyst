/**
 * Milestone 3 "done when": 10 hand-written questions return correct, cited
 * answers. Run with `npm run check:questions`; the report goes to
 * docs/checks/milestone-3-questions.md. `lookFor` is what a reviewer checks
 * against the cited passages; it states no figures of its own.
 * Fiscal years use our label (Walmart's "fiscal 2026" is 2025 here).
 */
export interface CheckQuestion {
  id: string;
  ticker: string;
  question: string;
  fromYear: number;
  toYear: number;
  /** What a correct response does: answer from the filing, or say it can't. */
  expect: "answered" | "not_answered";
  lookFor: string;
}

export const MILESTONE3_QUESTIONS: readonly CheckQuestion[] = [
  {
    id: "wmt-gross-margin",
    ticker: "WMT",
    question: "Why did Walmart's gross profit rate change?",
    fromYear: 2025,
    toYear: 2025,
    expect: "answered",
    lookFor: "The basis-point change and the reasons MD&A gives (Walmart U.S. drivers, mix offsets), each cited to Item 7.",
  },
  {
    id: "tgt-buybacks",
    ticker: "TGT",
    question: "How much did Target spend on share repurchases, and how did that change?",
    fromYear: 2024,
    toYear: 2025,
    expect: "answered",
    lookFor: "Repurchase amounts by year as the filing states them, with dollar figures that match XBRL or the text.",
  },
  {
    id: "cost-membership",
    ticker: "COST",
    question: "How much membership fee income did Costco earn, and what drove the change?",
    fromYear: 2025,
    toYear: 2025,
    expect: "answered",
    lookFor: "Membership fee figure and the stated drivers (sign-ups, renewals, fee increase), cited to MD&A.",
  },
  {
    id: "kr-lifo",
    ticker: "KR",
    question: "What was Kroger's LIFO charge in each year, and what drove it?",
    fromYear: 2023,
    toYear: 2025,
    expect: "answered",
    lookFor: "The LIFO charge for each year with the inflation explanation the filing gives, from three different 10-Ks.",
  },
  {
    id: "kr-operating-profit",
    ticker: "KR",
    question: "Why did Kroger's operating profit change in fiscal 2025?",
    fromYear: 2025,
    toYear: 2025,
    expect: "answered",
    lookFor: "The direction of the change and the specific items MD&A names, without invented causes.",
  },
  {
    id: "gap-comps",
    ticker: "GAP",
    question: "How did comparable sales perform for each of Gap Inc.'s brands?",
    fromYear: 2025,
    toYear: 2025,
    expect: "answered",
    lookFor: "Comparable sales by brand (Old Navy, Gap, Banana Republic, Athleta) as in the comp sales table.",
  },
  {
    id: "five-stores",
    ticker: "FIVE",
    question: "How many new stores did Five Below open, and what are its plans for store growth?",
    fromYear: 2025,
    toYear: 2025,
    expect: "answered",
    lookFor: "Net new stores for the year and the growth plans the filing describes.",
  },
  {
    id: "tgt-tariffs",
    ticker: "TGT",
    question: "How could tariffs affect Target's business?",
    fromYear: 2025,
    toYear: 2025,
    expect: "answered",
    lookFor: "Risk Factors content: import exposure, cost and price effects, sourcing changes; cited to Item 1A.",
  },
  {
    id: "cost-forecast",
    ticker: "COST",
    question: "What will Costco's total revenue be next fiscal year?",
    fromYear: 2025,
    toYear: 2025,
    expect: "not_answered",
    lookFor: "Says the filing doesn't forecast revenue; gives no number of its own.",
  },
  {
    id: "wmt-ceo-pay",
    ticker: "WMT",
    question: "How much total compensation did Walmart's CEO receive last year?",
    fromYear: 2025,
    toYear: 2025,
    expect: "not_answered",
    lookFor: "Says the 10-K doesn't state it (executive pay is in the proxy statement); no figure.",
  },
];
