"use client";

/**
 * Ask the filings: a question box for the company and years on the page,
 * the answer with a book button after each cited part, and a panel on the
 * right showing the whole 10-K section a citation comes from, scrolled to
 * and highlighting the cited passage (decisions 2026-11-24).
 * Talks only to our own routes: POST /api/ask and GET /api/section.
 */
import { useEffect, useRef, useState } from "react";
import type { AskResponse, AskSource } from "@/lib/qa/ask";
import { splitBold } from "@/lib/web/inline";
import type { SectionView } from "@/lib/web/section";

interface Props {
  ticker: string;
  companyName: string;
  fromYear: number;
  toYear: number;
  passageCount: number;
}

const STATUS_NOTE: Record<AskResponse["status"], string | null> = {
  answered: null,
  partly_answered: "Partly answered: the filing covers only part of this question.",
  not_answered: "Not answered: the filings don't contain this.",
  declined: "This question was declined. Try rephrasing it.",
  truncated: "The answer was cut off before it finished.",
};

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
      <path d="M6.5 17A2.5 2.5 0 0 0 4 19.5 2.5 2.5 0 0 0 6.5 22H20v-5" />
    </svg>
  );
}

function Rich({ text }: { text: string }) {
  return (
    <>
      {splitBold(text).map((run, i) => (run.bold ? <strong key={i}>{run.text}</strong> : <span key={i}>{run.text}</span>))}
    </>
  );
}

/** Reported XBRL figures are sources too (qa/xbrl-passages.ts): no 10-K section to open. */
const isXbrl = (s: AskSource) => s.item === "XBRL";

function sourceLabel(s: AskSource): string {
  if (isXbrl(s)) return `FY${s.fiscalYear} reported financial data (XBRL) · ${s.heading ?? "figure"}`;
  const pages = s.pageStart === s.pageEnd ? `p. ${s.pageStart}` : `pp. ${s.pageStart}–${s.pageEnd}`;
  return `FY${s.fiscalYear} 10-K · Item ${s.item}${s.heading ? ` · ${s.heading}` : ""} · ${pages}`;
}

export function AskPanel({ ticker, companyName, fromYear, toYear, passageCount }: Props) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [asked, setAsked] = useState("");

  // Side panel: which source is open, the section it belongs to, and whether the panel is showing.
  const [activeSource, setActiveSource] = useState<AskSource | null>(null);
  const [section, setSection] = useState<SectionView | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  async function ask() {
    const q = question.trim();
    if (q === "" || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setPanelOpen(false);
    setActiveSource(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, question: q, fromYear, toYear }),
      });
      const body = (await res.json()) as AskResponse | { error: string };
      if (!res.ok || "error" in body) setError("error" in body ? body.error : `Request failed (${res.status}).`);
      else {
        setResult(body);
        setAsked(q);
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function openSource(source: AskSource) {
    setActiveSource(source);
    setPanelOpen(true);
    setSectionError(null);
    // A reported XBRL figure is shown as is; nothing to fetch.
    if (isXbrl(source)) return;
    // Same section already loaded: just move the highlight.
    if (section?.passages.some((p) => p.id === source.passageId)) return;
    setSection(null);
    try {
      const res = await fetch(`/api/section?passage=${source.passageId}`);
      const body = (await res.json()) as SectionView | { error: string };
      if (!res.ok || "error" in body) setSectionError("error" in body ? body.error : `Request failed (${res.status}).`);
      else setSection(body);
    } catch {
      setSectionError("Couldn't load this section.");
    }
  }

  // Bring the cited passage into view whenever the highlight or section changes.
  useEffect(() => {
    if (panelOpen && section && highlightRef.current) highlightRef.current.scrollIntoView({ block: "center" });
  }, [panelOpen, section, activeSource]);

  const sourceByN = new Map(result?.sources.map((s) => [s.n, s]) ?? []);
  const unverified = result?.numbers.figures.filter((f) => f.status === "unverified") ?? [];

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <input
          type="text"
          aria-label={`Ask a question about ${companyName}'s 10-Ks`}
          placeholder={`Ask about ${companyName}'s 10-Ks, e.g. "Why did gross margin change?"`}
          maxLength={1000}
          className="flex-1 rounded border border-gray-300 px-3 py-2 outline-none focus:border-gray-500"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" disabled={loading || question.trim() === ""} className="rounded border border-gray-400 px-4 py-2 disabled:opacity-50">
          {loading ? "Asking…" : "Ask"}
        </button>
      </form>
      <p className="text-xs text-gray-500">
        Searches the {passageCount.toLocaleString("en-US")} passages from fiscal {fromYear === toYear ? fromYear : `${fromYear}–${toYear}`}. Answers
        use only the filings, cite each claim, and check every figure against XBRL.
      </p>

      {loading && <p className="text-sm text-gray-600">Searching the filings and writing a cited answer (usually 5–15 seconds)…</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}

      {result && (
        <div className="flex flex-col gap-3 border-t border-gray-200 pt-3">
          <p className="text-sm font-semibold">{asked}</p>
          {STATUS_NOTE[result.status] && <p className="text-sm text-amber-800">{STATUS_NOTE[result.status]}</p>}

          <div className="text-sm leading-6 whitespace-pre-wrap">
            {result.segments.map((seg, i) => (
              <span key={i}>
                <Rich text={seg.text} />
                {seg.sources.map((n) => {
                  const s = sourceByN.get(n);
                  if (!s) return null;
                  const active = panelOpen && activeSource?.passageId === s.passageId;
                  return (
                    <button
                      key={n}
                      type="button"
                      title={`Source ${n}: ${sourceLabel(s)}`}
                      aria-label={`Open source ${n}: ${sourceLabel(s)}`}
                      onClick={() => void openSource(s)}
                      className={`mx-0.5 inline-flex items-center gap-0.5 rounded border px-1 align-baseline text-xs ${active ? "border-black bg-black text-white" : "border-gray-300 text-gray-700 hover:border-gray-500"}`}
                    >
                      <BookIcon />
                      {n}
                    </button>
                  );
                })}
              </span>
            ))}
          </div>

          {result.sources.length > 0 && (
            <div className="text-xs">
              <p className="font-semibold">Sources</p>
              <ol className="flex flex-col gap-1">
                {result.sources.map((s) => (
                  <li key={s.n}>
                    <button type="button" onClick={() => void openSource(s)} className="inline-flex items-center gap-1 text-left underline">
                      <BookIcon />
                      {s.n}. {sourceLabel(s)}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p className="text-xs text-gray-600">
            Numbers: {result.numbers.total} found · {result.numbers.xbrl} match XBRL · {result.numbers.passage} quoted from the filing ·{" "}
            <span className={result.numbers.unverified > 0 ? "font-semibold text-red-700" : undefined}>{result.numbers.unverified} unverified</span>
            {unverified.length > 0 && <> ({unverified.map((f) => f.raw).join(", ")})</>}
          </p>
          <p className="text-xs text-gray-400">
            {result.model}
            {result.cached ? " · reused an earlier answer to the same question" : ""} · answer #{result.answerId}
          </p>
        </div>
      )}

      {/* Collapsed: a tab on the right edge brings the panel back. */}
      {!panelOpen && activeSource && (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          // Phones: low on the right edge, clear of the question box; wider screens: centered.
          className="fixed right-0 bottom-24 z-20 rounded-l border border-r-0 border-gray-400 bg-white px-2 py-3 text-xs [writing-mode:vertical-rl] sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2"
        >
          Show source {activeSource.n}
        </button>
      )}

      {panelOpen && activeSource && (
        <aside
          aria-label="Cited 10-K section"
          className="fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l border-gray-300 bg-white shadow-lg sm:w-[30rem]"
        >
          <div className="flex items-start justify-between gap-2 border-b border-gray-200 p-3">
            <div className="text-xs">
              <p className="font-semibold">
                Source {activeSource.n}: {isXbrl(activeSource) ? sourceLabel(activeSource) : section ? `${section.company.name} FY${section.filing.fiscalYear} ${section.filing.form}` : sourceLabel(activeSource)}
              </p>
              {section && !isXbrl(activeSource) && (
                <>
                  <p>
                    Item {section.section.item}: {section.section.title} (pp. {section.section.pageStart}–{section.section.pageEnd})
                  </p>
                  <a href={section.filing.secUrl} target="_blank" rel="noopener noreferrer" className="underline">
                    Open the filing on sec.gov
                  </a>
                </>
              )}
            </div>
            <button type="button" onClick={() => setPanelOpen(false)} aria-label="Close the source panel" className="px-2 text-lg leading-none">
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 text-sm leading-6">
            {isXbrl(activeSource) && (
              <div className="rounded bg-yellow-100 p-2 outline outline-yellow-300">
                <p className="whitespace-pre-wrap">{activeSource.citedText}</p>
                <p className="mt-2 text-xs text-gray-600">
                  From the company&apos;s XBRL financial data: the tagged figures it files with its 10-K, the same numbers as the financial
                  statements. Stored in financial_facts and shown in Key financials above.
                </p>
              </div>
            )}
            {!isXbrl(activeSource) && sectionError && <p className="text-red-700">{sectionError}</p>}
            {!isXbrl(activeSource) && !section && !sectionError && <p className="text-gray-500">Loading the section…</p>}
            {!isXbrl(activeSource) && section?.passages.map((p) => {
              const cited = p.id === activeSource.passageId;
              return (
                <div
                  key={p.id}
                  ref={cited ? highlightRef : undefined}
                  className={`mb-3 ${cited ? "rounded bg-yellow-100 p-2 outline outline-yellow-300" : ""}`}
                >
                  <p className="text-xs text-gray-400">
                    p. {p.pageStart}
                    {p.pageEnd !== p.pageStart ? `–${p.pageEnd}` : ""}
                    {cited ? ` · cited as source ${activeSource.n}` : ""}
                  </p>
                  <p className={p.kind === "table" ? "font-mono text-xs whitespace-pre-wrap" : "whitespace-pre-wrap"}>{p.content}</p>
                </div>
              );
            })}
          </div>
        </aside>
      )}
    </div>
  );
}
