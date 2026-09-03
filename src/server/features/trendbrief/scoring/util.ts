// Rounds a 0-1 component score to 4 decimal places — mirrors
// SearchOpportunityService's roundComponent (SearchOpportunityService.ts:96)
// so component scores stay stable and comparable across runs.
export function roundComponent(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

// Whole days between an ISO "YYYY-MM-DD" (or full ISO timestamp) date string
// and `now`, floor-rounded, never negative.
export function daysBetween(isoDate: string, now: Date): number {
  const then = new Date(isoDate).getTime();
  // An unparseable isoDate would otherwise propagate NaN silently through
  // confidence scoring and into a `real` database column. Not reachable
  // today (dates always come from GSC's own response), but fail loudly
  // rather than let it slip through.
  if (Number.isNaN(then)) {
    throw new Error(`daysBetween: unparseable date "${isoDate}"`);
  }
  const diffMs = now.getTime() - then;
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}
