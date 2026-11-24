"use client";

/**
 * Two-handle year slider built from two native range inputs stacked on top of
 * each other (no library). `years` is always an unbroken run, so any range
 * picked between the handles has no gap.
 */
import type { YearRange } from "@/lib/web/years";

interface Props {
  years: readonly number[];
  value: YearRange;
  onChange: (range: YearRange) => void;
}

export function YearSlider({ years, value, onChange }: Props) {
  const min = years[0];
  const max = years.at(-1);
  if (min === undefined || max === undefined) return <p className="text-sm text-gray-500">No downloaded 10-Ks for this company.</p>;
  if (min === max) return <p className="text-sm text-gray-500">Only fiscal {min} is downloaded.</p>;

  return (
    <div className="w-full">
      <div className="relative h-6">
        <input
          type="range"
          aria-label="From fiscal year"
          className="dual-range"
          min={min}
          max={max}
          step={1}
          value={value.from}
          onChange={(e) => onChange({ from: Math.min(Number(e.target.value), value.to), to: value.to })}
        />
        <input
          type="range"
          aria-label="To fiscal year"
          className="dual-range"
          min={min}
          max={max}
          step={1}
          value={value.to}
          onChange={(e) => onChange({ from: value.from, to: Math.max(Number(e.target.value), value.from) })}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        {years.map((y) => (
          <span key={y} className={y >= value.from && y <= value.to ? "font-semibold text-black" : undefined}>
            {y}
          </span>
        ))}
      </div>
    </div>
  );
}
