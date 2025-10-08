export function getArg(flag: string, fallback?: string) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i+1]) return process.argv[i+1];
  return fallback;
}

export function seasonFromDate(date: string): string {
  // e.g., 2024-10-05 -> season "20242025"
  const [y, m, d] = date.split('-').map(Number);
  if (m >= 7) return `${y}${y+1}`; // July or later counts as new season start (approx)
  return `${y-1}${y}`;
}