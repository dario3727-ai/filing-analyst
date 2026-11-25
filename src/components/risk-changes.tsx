/**
 * What changed: Risk Factors compared year over year, rendered on the
 * server from risk_changes (milestone 5). Bare-bones like the rest of the
 * page: new, removed and reworded risks, most material first, each with
 * Claude's one-line summary; the exact wording changes behind a toggle.
 */
import { buildRiskView, type RiskChangeRecord, type RiskItem } from "@/lib/web/risk-view";

const KIND_LABEL: Record<RiskItem["kind"], string> = { added: "New", removed: "Removed", modified: "Reworded" };
const MAX_EDITS_SHOWN = 40;

function Materiality({ value }: { value: RiskItem["materiality"] }) {
  if (!value) return <span className="text-gray-400">not rated</span>;
  return <span className={value === "high" ? "font-semibold text-red-700" : value === "medium" ? "text-amber-700" : "text-gray-500"}>{value}</span>;
}

function Item({ item }: { item: RiskItem }) {
  return (
    <li className="border-b border-gray-200 py-2">
      <p className="text-xs text-gray-500">
        {KIND_LABEL[item.kind]} · materiality <Materiality value={item.materiality} />
        {item.kind === "modified" && ` · +${item.wordsAdded} / −${item.wordsRemoved} words`}
        {item.category && ` · ${item.category}`}
      </p>
      <p className="font-medium">{item.title}</p>
      {item.oldTitle && <p className="text-xs text-gray-500">Was: {item.oldTitle}</p>}
      <p className="text-sm">{item.summary ?? <span className="text-gray-400">No summary yet (run npm run risks again).</span>}</p>
      {item.kind === "modified" && item.edits.length > 0 && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-gray-600">Show the {item.edits.length} wording change{item.edits.length === 1 ? "" : "s"}</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {item.edits.slice(0, MAX_EDITS_SHOWN).map((e, i) => (
              <li key={i}>
                {e.before && <del className="bg-red-50 text-red-800">{e.before}</del>}
                {e.before && e.after && " → "}
                {e.after && <ins className="bg-green-50 text-green-800 no-underline">{e.after}</ins>}
              </li>
            ))}
            {item.edits.length > MAX_EDITS_SHOWN && <li className="text-gray-500">…and {item.edits.length - MAX_EDITS_SHOWN} more.</li>}
          </ul>
        </details>
      )}
      {item.text && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-gray-600">Show the full text</summary>
          <p className="mt-1 whitespace-pre-wrap">{item.text}</p>
        </details>
      )}
    </li>
  );
}

export function RiskChanges({ rows }: { rows: readonly RiskChangeRecord[] }) {
  const pairs = buildRiskView(rows);
  if (pairs.length === 0) {
    return <p className="text-sm text-gray-600">No comparison yet for these years (it needs two consecutive downloaded 10-Ks; run npm run risks).</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      {pairs.map((p) => (
        <div key={`${p.fromYear}-${p.toYear}`}>
          <h3 className="font-semibold">
            FY{p.fromYear} → FY{p.toYear} 10-K
          </h3>
          <p className="text-xs text-gray-600">
            {p.counts.added} new · {p.counts.removed} removed · {p.counts.modified} reworded ({p.counts.high} rated high) · {p.unchanged} unchanged
          </p>
          <ul>
            {p.items.map((item, i) => (
              <Item key={i} item={item} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
