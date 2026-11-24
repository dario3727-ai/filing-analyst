"use client";

/**
 * Company search box with suggestions, plus the year slider for the chosen
 * company. Enter (or a click on a suggestion and then Enter) opens
 * /company/TICKER?from=YYYY&to=YYYY. Only companies already ingested match.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { exactCompany, matchCompanies, type CompanyOption } from "@/lib/web/search";
import { resolveRange, type YearRange } from "@/lib/web/years";
import { YearSlider } from "./year-slider";

interface Props {
  companies: readonly CompanyOption[];
  /** Prefill (results page): the company and range currently shown. */
  initialTicker?: string;
  initialRange?: YearRange | null;
}

export function SearchForm({ companies, initialTicker, initialRange }: Props) {
  const router = useRouter();
  const initial = initialTicker ? exactCompany(companies, initialTicker) : undefined;
  const [query, setQuery] = useState(initial ? `${initial.ticker} · ${initial.name}` : "");
  const [selected, setSelected] = useState<CompanyOption | undefined>(initial);
  const [range, setRange] = useState<YearRange | null>(initialRange ?? (initial ? resolveRange(initial.years) : null));
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const suggestions = selected ? [] : matchCompanies(companies, query);

  function choose(company: CompanyOption) {
    setSelected(company);
    setQuery(`${company.ticker} · ${company.name}`);
    setRange(resolveRange(company.years));
    setOpen(false);
    setMessage(null);
  }

  function submit() {
    const company = selected ?? exactCompany(companies, query) ?? suggestions[highlight];
    if (!company) {
      setMessage(query.trim() === "" ? "Type a company name or ticker." : `No loaded company matches "${query.trim()}".`);
      return;
    }
    const chosen = range && selected === company ? range : resolveRange(company.years);
    const params = chosen ? `?from=${chosen.from}&to=${chosen.to}` : "";
    router.push(`/company/${company.ticker}${params}`);
  }

  return (
    <form
      className="flex w-full max-w-xl flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="relative">
        <input
          type="search"
          aria-label="Search companies"
          placeholder="Search a company (e.g. Walmart or WMT)"
          autoComplete="off"
          className="w-full rounded-full border border-gray-300 px-5 py-3 outline-none focus:border-gray-500"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(undefined);
            setHighlight(0);
            setOpen(true);
            setMessage(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {open && suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full border border-gray-300 bg-white" role="listbox">
            {suggestions.map((c, i) => (
              <li
                key={c.ticker}
                role="option"
                aria-selected={i === highlight}
                className={`cursor-pointer px-5 py-2 ${i === highlight ? "bg-gray-100" : ""}`}
                // mousedown fires before the input's blur closes the list
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(c);
                }}
              >
                <span className="font-mono">{c.ticker}</span> · {c.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-5">
        {selected && range ? (
          <>
            <p className="mb-1 text-sm">
              Fiscal years: {range.from === range.to ? range.from : `${range.from}–${range.to}`}
            </p>
            <YearSlider years={selected.years} value={range} onChange={setRange} />
          </>
        ) : selected ? (
          <YearSlider years={selected.years} value={{ from: 0, to: 0 }} onChange={() => {}} />
        ) : (
          <p className="text-sm text-gray-500">Pick a company to choose its fiscal years.</p>
        )}
      </div>

      {message && <p className="px-5 text-sm text-red-700">{message}</p>}
      <p className="px-5 text-xs text-gray-500">Press Enter to search. Loaded: {companies.map((c) => c.ticker).join(", ")}.</p>
    </form>
  );
}
