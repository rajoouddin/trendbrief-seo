/**
 * URL identity helpers for the Website Health model.
 * Matches the crawler's own normalisation (fragment stripped, query params
 * sorted, host lowercase) so finding identities are stable across audits even
 * when the page's exact URL string or query order changed.
 */

export function normalizeAffectedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.searchParams.sort();
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return url;
  }
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
