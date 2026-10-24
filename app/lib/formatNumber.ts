// A fixed locale, so server and client render the same digits, as the dates do.
const formats = new Map<number, Intl.NumberFormat>();

export function formatNumber(value: number, decimals = 0): string {
  let format = formats.get(decimals);
  if (format === undefined) {
    format = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formats.set(decimals, format);
  }
  return format.format(value);
}

export const formatPlays = (count: number): string =>
  `${formatNumber(count)} ${count === 1 ? "play" : "plays"}`;
