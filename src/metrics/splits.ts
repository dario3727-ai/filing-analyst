/**
 * Stock-split detection from year-over-year change in diluted share count
 * (decision 2026-11-24). Companies only restate per-share values for the
 * years a post-split 10-K re-reports, so older years stay on the pre-split
 * basis (Walmart: fiscal 2020 EPS $4.75 on 2.85B shares, fiscal 2021 $1.62 on
 * 8.42B shares after its February 2024 3-for-1 split).
 *
 * A split shows up as the share count jumping by close to a clean factor
 * (×2.96 ≈ 3: buybacks keep it a little under). Normal years move a few
 * percent. A merger can also jump the share count, so if total assets jumped
 * too, the change is "unclear" rather than a split.
 */

export type ShareChange =
  | { kind: "none"; ratio: number }
  | { kind: "split"; ratio: number; factor: number }
  | { kind: "unclear"; ratio: number; reason: string };

/** Share-count ratios at or beyond this (or its inverse) count as a sharp change. */
export const SHARP_CHANGE = 1.4;
/** How close the ratio must be to a clean factor, as a fraction of the factor. */
export const FACTOR_TOLERANCE = 0.06;
/** Forward splits and their reverse-split inverses. */
export const SPLIT_FACTORS: readonly number[] = [1.5, 2, 3, 4, 5, 10, 20].flatMap((f) => [f, 1 / f]);
/** Assets moving more than this (either way) alongside the shares suggests a merger, not a split. */
export const MAX_ASSET_CHANGE = 1.5;

export function classifyShareChange(
  sharesPrior: number,
  sharesCurrent: number,
  assetsPrior?: number,
  assetsCurrent?: number,
): ShareChange {
  if (!(sharesPrior > 0) || !(sharesCurrent > 0)) {
    return { kind: "unclear", ratio: Number.NaN, reason: "share count is missing or not positive" };
  }
  const ratio = sharesCurrent / sharesPrior;
  if (ratio < SHARP_CHANGE && ratio > 1 / SHARP_CHANGE) return { kind: "none", ratio };

  const factor = SPLIT_FACTORS.find((f) => Math.abs(ratio - f) <= f * FACTOR_TOLERANCE);
  if (factor === undefined) {
    return { kind: "unclear", ratio, reason: `share count changed ×${ratio.toFixed(2)}, not a clean split factor` };
  }
  if (assetsPrior !== undefined && assetsCurrent !== undefined && assetsPrior > 0) {
    const assetRatio = assetsCurrent / assetsPrior;
    if (assetRatio > MAX_ASSET_CHANGE || assetRatio < 1 / MAX_ASSET_CHANGE) {
      return {
        kind: "unclear",
        ratio,
        reason: `share count changed ×${ratio.toFixed(2)} while total assets changed ×${assetRatio.toFixed(2)}, which looks like a merger, not a split`,
      };
    }
  }
  return { kind: "split", ratio, factor };
}

/** "3-for-1", "3-for-2", "1-for-10" */
export function describeSplit(factor: number): string {
  if (factor >= 1) {
    return Number.isInteger(factor) ? `${factor}-for-1` : `${Math.round(factor * 2)}-for-2`;
  }
  const inverse = 1 / factor;
  return Number.isInteger(Math.round(inverse * 1e9) / 1e9) ? `1-for-${Math.round(inverse)}` : `2-for-${Math.round(inverse * 2)}`;
}
