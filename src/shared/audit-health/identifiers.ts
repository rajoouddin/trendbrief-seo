/**
 * URL identity helpers for the Website Health model.
 * Matches the crawler's own normalisation (fragment stripped, query params
 * sorted, host lowercase) so finding identities are stable across audits even
 * when the page's exact URL string or query order changed.
 *
 * Percent-encoding is canonicalized conservatively: percent-hex digits are
 * uppercased, and only RFC 3986 unreserved characters are decoded back to
 * their literal form (so "%7E" and "~" are the same identity, as are "%2f" and
 * "%2F"). Reserved characters keep their percent-encoded semantics — "%2F" is
 * forced to "%2F" but stays distinct from a literal path separator "/" — so
 * path meaning is never over-normalized away.
 */

const PERCENT_ESCAPE = /%[0-9a-fA-F]{2}/g;

function canonicalizePercentEscapes(url: string): string {
  return url.replace(PERCENT_ESCAPE, (match) => {
    const hex = match.slice(1);
    const byte = parseInt(hex, 16);
    const isUnreserved =
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      byte === 0x2d || // -
      byte === 0x2e || // .
      byte === 0x5f || // _
      byte === 0x7e; // ~
    return isUnreserved ? String.fromCharCode(byte) : `%${hex.toUpperCase()}`;
  });
}

export function normalizeAffectedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.searchParams.sort();
    parsed.hostname = parsed.hostname.toLowerCase();
    return canonicalizePercentEscapes(parsed.toString());
  } catch {
    return url;
  }
}
