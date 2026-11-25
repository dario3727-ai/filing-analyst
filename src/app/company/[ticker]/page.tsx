/**
 * Results page: /company/WMT?from=2023&to=2025. Lists everything the
 * pipeline has stored for one company and year range, unstyled, with each
 * section labeled by the milestone that produces it (milestone 2.5).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { AskPanel } from "@/components/ask-panel";
import { SearchForm } from "@/components/search-form";
import { getProfile } from "@/metrics/profiles";
import { retailProfile } from "@/metrics/profiles/retail";
import { filingDocumentUrl } from "@/lib/sec/urls";
import { formatMoney, formatMonthDay } from "@/lib/web/format";
import { listCompanies, loadReport, toFact, type ReportData } from "@/lib/web/queries";
import { buildInputTable, buildRatioTable, describeRedFlags, Footnotes, profileTags } from "@/lib/web/report";
import { describeYears, yearsInRange } from "@/lib/web/years";

export default function CompanyPage({ params, searchParams }: PageProps<"/company/[ticker]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8">
      <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
        <Report params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Report({ params, searchParams }: Pick<PageProps<"/company/[ticker]">, "params" | "searchParams">) {
  const { ticker } = await params;
  const query = await searchParams;
  const [report, companies] = await Promise.all([loadReport(ticker, query.from, query.to), listCompanies()]);
  if (!report) notFound();

  return (
    <>
      <header className="flex flex-col gap-4">
        <Link href="/" className="text-2xl font-semibold">
          Filer
        </Link>
        <SearchForm
          key={`${report.company.ticker}-${report.range?.from}-${report.range?.to}`}
          companies={companies}
          initialTicker={report.company.ticker}
          initialRange={report.range}
        />
      </header>
      <CompanySection report={report} />
      {report.range ? (
        <YearSections report={report} years={yearsInRange(report.range)} />
      ) : (
        <p>No 10-K has been downloaded for this company yet, so there are no years to show.</p>
      )}
    </>
  );
}

function Section({ title, source, children }: { title: string; source: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-xs text-gray-500">{source}</p>
      </div>
      {children}
    </section>
  );
}

const th = "border border-gray-300 px-2 py-1 text-left font-medium";
const td = "border border-gray-300 px-2 py-1 align-top";

function Sup({ notes }: { notes: number[] }) {
  return notes.length > 0 ? <sup className="text-gray-500">{notes.join(",")}</sup> : null;
}

function NoteList({ notes }: { notes: Footnotes }) {
  const list = notes.list();
  if (list.length === 0) return null;
  return (
    <ol className="list-none text-xs text-gray-600">
      {list.map((n) => (
        <li key={n.n}>
          <sup>{n.n}</sup> {n.text}
        </li>
      ))}
    </ol>
  );
}

function CompanySection({ report }: { report: ReportData }) {
  const { company, filings, selectable, factYears } = report;
  const notSelectable = filings.map((f) => f.fiscal_year).filter((y) => !selectable.includes(y));
  return (
    <Section title={`${company.name} (${company.ticker})`} source="Milestone 1 · SEC submissions API → companies, filings">
      <ul className="text-sm">
        <li>CIK {company.cik} · SIC {company.sic_code ?? "unknown"} · sector profile: {company.sector_profile}</li>
        <li>Fiscal year ends: {company.fiscal_year_end ? formatMonthDay(company.fiscal_year_end) : "unknown"}</li>
        <li>
          Showing fiscal {report.range ? describeYears(yearsInRange(report.range)) : "none"} · slider offers{" "}
          {describeYears(selectable) || "none"}
          {notSelectable.length > 0 && <> · listed but not downloaded: {describeYears(notSelectable)}</>}
        </li>
        <li>
          XBRL facts stored: {report.totalFacts.toLocaleString("en-US")}
          {factYears && (
            <>
              {" "}
              (fiscal {factYears.first}–{factYears.last})
            </>
          )}
        </li>
      </ul>
    </Section>
  );
}

function YearSections({ report, years }: { report: ReportData; years: number[] }) {
  const own = getProfile(report.company.sector_profile);
  const profile = own ?? retailProfile;
  const facts = report.facts.map(toFact);

  const inputNotes = new Footnotes();
  const inputs = buildInputTable(facts, profile, years, inputNotes);
  const ratioNotes = new Footnotes();
  const ratios = buildRatioTable(report.ratios, profile, years, ratioNotes);
  const flags = describeRedFlags(report.redFlags, profile);
  const used = profileTags(profile);
  const latest = years.at(-1)!;
  const latestFacts = report.facts
    .filter((f) => f.fiscal_year === latest)
    .sort((a, b) => a.concept.localeCompare(b.concept) || a.period_end.localeCompare(b.period_end));
  const inRange = report.filings.filter((f) => years.includes(f.fiscal_year));
  const passages = inRange.reduce((sum, f) => sum + (f.passages ?? 0), 0);

  return (
    <>
      {!own && (
        <p className="text-sm">
          No sector profile for &quot;{report.company.sector_profile}&quot;: retail metrics are applied as a crash test.
        </p>
      )}

      <Section title="Key financials" source="Milestone 1 · XBRL company facts → financial_facts (hover a value to see its XBRL tag; — means not reported)">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>Input</th>
                {years.map((y) => (
                  <th key={y} className={th}>
                    FY{y}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inputs.map((row) => (
                <tr key={row.id}>
                  <td className={td}>
                    {row.label}
                    <Sup notes={row.footnotes} />
                  </td>
                  {row.cells.map((c, i) => (
                    <td key={years[i]} className={`${td} text-right tabular-nums`} title={c?.tag}>
                      {c ? formatMoney(c.value, row.unit) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <NoteList notes={inputNotes} />
      </Section>

      <Section title="Ratios" source={`Milestone 1 · ratio engine (${profile.label} profile) → ratios`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>Metric</th>
                {years.map((y) => (
                  <th key={y} className={th}>
                    FY{y}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ratios.map((row) => (
                <tr key={row.id}>
                  <td className={td}>
                    {row.label}
                    <div className="text-xs text-gray-500">{row.description}</div>
                  </td>
                  {row.cells.map((c, i) => (
                    <td key={years[i]} className={`${td} text-right tabular-nums ${c.notApplicable ? "text-gray-500" : ""}`}>
                      {c.text}
                      <Sup notes={c.footnotes} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <NoteList notes={ratioNotes} />
      </Section>

      <Section title="Red flags" source="Milestone 1 · rules in the sector profile → red_flags">
        {flags.length === 0 ? (
          <p className="text-sm">No red flags fired in the selected years.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {flags.map((f) => (
              <li key={`${f.fiscalYear}-${f.rule}`}>
                <strong>
                  FY{f.fiscalYear}: {f.label}
                </strong>{" "}
                · {f.detail}
                <div className="text-xs text-gray-500">Rule: {f.threshold}</div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-500">
          Rules checked: {profile.redFlags.map((r) => r.label).join("; ")}.
        </p>
      </Section>

      <Section title="10-K filings and sections" source="Milestone 2 · documents in Storage → parser → sections, chunks">
        <div className="overflow-x-auto">
          {/* Minimum width: on phones the table scrolls sideways instead of squeezing section titles into a sliver. */}
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>FY</th>
                <th className={th}>Filed</th>
                <th className={th}>Status</th>
                <th className={th}>Sections found (pages · words)</th>
                <th className={th}>Passages</th>
              </tr>
            </thead>
            <tbody>
              {inRange.map((f) => (
                <tr key={f.id}>
                  <td className={td}>
                    <a className="underline" href={filingDocumentUrl(report.company.cik, f.accession_no, f.primary_document)}>
                      FY{f.fiscal_year} {f.form}
                    </a>
                    <div className="text-xs text-gray-500">period ends {f.period_end}</div>
                  </td>
                  <td className={td}>{f.filed_at}</td>
                  <td className={td}>{f.status}</td>
                  <td className={td}>
                    {f.sections.length === 0 ? (
                      "none"
                    ) : (
                      <ul>
                        {[...f.sections]
                          .sort((a, b) => a.page_start - b.page_start)
                          .map((s) => (
                            <li key={s.item}>
                              Item {s.item}: {s.title} (p. {s.page_start}–{s.page_end} · {s.word_count.toLocaleString("en-US")})
                            </li>
                          ))}
                      </ul>
                    )}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{f.passages ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Ask the filings" source="Milestone 3 · POST /api/ask: hybrid search → Claude with citations → number check against XBRL">
        <AskPanel
          ticker={report.company.ticker}
          companyName={report.company.name}
          fromYear={years[0]!}
          toYear={years.at(-1)!}
          passageCount={passages}
        />
      </Section>

      <Section title="What changed" source="Not built yet · milestone 5 (Risk Factors compared year over year)">
        <p className="text-sm text-gray-600">Will list risks added, removed and reworded between consecutive 10-Ks.</p>
      </Section>

      <Section
        title={`All XBRL facts for FY${latest} (${latestFacts.length})`}
        source="Milestone 1 · financial_facts. Facts marked ✓ are read by the profile; the rest are candidates for new metrics."
      >
        <details>
          <summary className="cursor-pointer text-sm">Show all</summary>
          <div className="overflow-x-auto">
            <table className="mt-2 w-full min-w-[36rem] border-collapse text-xs">
              <thead>
                <tr>
                  <th className={th}>Used</th>
                  <th className={th}>Concept</th>
                  <th className={th}>Value</th>
                  <th className={th}>Period</th>
                </tr>
              </thead>
              <tbody>
                {latestFacts.map((f) => (
                  <tr key={`${f.concept}-${f.unit}-${f.period_start}-${f.period_end}`}>
                    <td className={td}>{used.has(f.concept) ? "✓" : ""}</td>
                    <td className={`${td} font-mono`}>{f.concept}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatMoney(f.value, f.unit)}</td>
                    <td className={td}>{f.period_start ? `${f.period_start} → ${f.period_end}` : `at ${f.period_end}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Section>
    </>
  );
}
