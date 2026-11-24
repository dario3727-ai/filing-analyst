/**
 * Display formatting for stored numbers. Stored values stay plain numbers
 * (fractions for percentages); only the screen turns 0.245 into "24.5%".
 */
import type { MetricUnit } from "../../metrics/types.ts";

const MINUS = "−";

function sign(value: number): string {
  return value < 0 ? MINUS : "";
}

/** 681_000_000_000 → "$681.0B"; −1_200_000 → "−$1.2M"; 2.41 per share → "$2.41". */
export function formatMoney(value: number, unit: string): string {
  const abs = Math.abs(value);
  if (unit === "USD/shares") return `${sign(value)}$${abs.toFixed(2)}`;
  if (unit === "USD") {
    if (abs >= 1e9) return `${sign(value)}$${(abs / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${sign(value)}$${(abs / 1e6).toFixed(1)}M`;
    return `${sign(value)}$${Math.round(abs).toLocaleString("en-US")}`;
  }
  if (unit === "shares") {
    if (abs >= 1e9) return `${sign(value)}${(abs / 1e9).toFixed(2)}B shares`;
    if (abs >= 1e6) return `${sign(value)}${(abs / 1e6).toFixed(1)}M shares`;
    return `${sign(value)}${Math.round(abs).toLocaleString("en-US")} shares`;
  }
  // Other XBRL units (pure numbers, employees, square feet...): plain, with the unit.
  const plain = Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return `${plain.replace("-", MINUS)} ${unit}`;
}

/** A computed metric in its unit: 0.245 fraction → "24.5%", 8.2 times → "8.2×". */
export function formatMetric(value: number, unit: MetricUnit): string {
  switch (unit) {
    case "fraction":
      return `${sign(value)}${(Math.abs(value) * 100).toFixed(1)}%`;
    case "percentage_points":
      return `${value < 0 ? MINUS : "+"}${(Math.abs(value) * 100).toFixed(1)} pts`;
    case "times":
      return `${sign(value)}${Math.abs(value).toFixed(1)}×`;
    case "days":
      return `${sign(value)}${Math.round(Math.abs(value))} days`;
    case "ratio":
      return `${sign(value)}${Math.abs(value).toFixed(2)}`;
  }
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Stored fiscal year end "01-31" → "January 31"; anything malformed is shown as stored. */
export function formatMonthDay(mmdd: string): string {
  const match = /^(\d{2})-(\d{2})$/.exec(mmdd);
  const month = match ? MONTHS[Number(match[1]) - 1] : undefined;
  return month && match ? `${month} ${Number(match[2])}` : mmdd;
}
