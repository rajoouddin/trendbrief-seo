/**
 * robots.txt and sitemap.xml discovery for the site audit crawler.
 */
import robotsParser from "robots-parser";
import { XMLParser } from "fast-xml-parser";
import { isCrawlableUrl } from "./url-policy";
import { isSameOrigin, normalizeUrl } from "./url-utils";

const SITEMAP_FETCH_TIMEOUT_MS = 15_000;
// robots.txt is checkpointed as durable Workflow step state (~1MiB cap, shared
// with the rest of the step's return). RFC 9309 requires parsers to handle at
// least 500 KiB and permits ignoring anything beyond it — Google does exactly
// that — so this cap matches standard crawler behavior while keeping a
// misbehaving server (e.g. HTML at /robots.txt) from blowing the step limit.
const MAX_ROBOTS_TXT_BYTES = 500 * 1024;
const MAX_SITEMAP_DEPTH = 3;
const MAX_SITEMAP_DOCS = 300;
const SITEMAP_CONCURRENCY = 5;
const SITEMAP_RETRIES = 1;
// Discovery redirects are followed manually and bounded like the rest of the
// crawler (the start-URL probe uses the same budget).
const DISCOVERY_REDIRECT_HOPS = 5;
// Sitemap shards can legally reach 50 MB and SITEMAP_CONCURRENCY of them are
// read at once, so unbounded reads can exhaust Worker memory. Oversized
// shards are skipped whole — truncated XML would not parse anyway, and real
// generators shard far below this.
const MAX_SITEMAP_BYTES = 10 * 1024 * 1024;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  isArray: (name) => name === "sitemap" || name === "url",
});

export interface RobotsResult {
  isAllowed: (url: string) => boolean;
  sitemapUrls: string[];
}

interface DiscoveryFetchResult {
  /** Final non-redirect response, or null when the fetch failed or was refused. */
  response: Response | null;
  /** Final URL after any followed redirects (null when refused/unresolvable). */
  finalUrl: string | null;
  /** Set when the fetch itself threw (e.g. timed out); no response exists. */
  error?: unknown;
  /** True when a redirect destination was refused by policy/scope before fetch. */
  rejected: boolean;
}

/**
 * Bounded manual redirect handling for discovery fetches (robots.txt, sitemaps,
 * sitemap-index children).
 *
 * The audit's page fetches already use `redirect: "manual"`; discovery used the
 * runtime's automatic redirect following, which trusts a server-supplied
 * Location header before any validation runs. A hostile or compromised site
 * could point /robots.txt or /sitemap.xml at an internal metadata endpoint, a
 * private-address literal, a non-standard port, or another origin, and the
 * automatic redirect would perform that fetch.
 *
 * Every hop re-runs the crawler's URL policy on the destination BEFORE the next
 * request: scheme must be HTTP(S), the port must match the scheme's standard
 * (80/443 or the implicit default), blocked hostnames and literal-IP /
 * private-address / metadata rules must pass, and — like the rest of discovery —
 * the target must stay within the audit's same-origin crawl scope. Refused
 * destinations are never fetched; `rejected` distinguishes a policy refusal
 * from a network failure so callers can warn accurately.
 *
 * DNS TOCTOU note (unchanged, documented here so it stays accurate): per-hop
 * out-of-band DNS lookups would make discovery prohibitively slow, so hostnames
 * that are not literals resolve inside the fetch itself. Only the start URL
 * performs an out-of-band resolution check (normalizeAndValidateStartUrl in
 * url-policy.ts). A hostname that resolves to a private address at fetch time
 * but not at validation time remains the documented, accepted limitation —
 * validation covers URL shape, port, blocklist, literal addresses, and scope.
 */
export async function fetchDiscoveryDocument(
  url: string,
  origin: string,
  timeoutMs: number,
): Promise<DiscoveryFetchResult> {
  let current = normalizeUrl(url);
  if (current === null || !isDiscoveryTargetAllowed(current, origin)) {
    return { response: null, finalUrl: null, rejected: true };
  }

  for (let hop = 0; hop <= DISCOVERY_REDIRECT_HOPS; hop++) {
    let response: Response;
    try {
      response = await fetchDiscoveryRequest(current, timeoutMs);
    } catch (error) {
      console.warn(`Discovery fetch failed for ${current}:`, error);
      return { response: null, finalUrl: current, rejected: false, error };
    }

    if (response.status < 300 || response.status >= 400) {
      return { response, finalUrl: current, rejected: false };
    }

    if (hop === DISCOVERY_REDIRECT_HOPS) {
      // The hop budget is exhausted; the next hop would not be followed.
      return { response: null, finalUrl: null, rejected: false };
    }

    const location = response.headers.get("location");
    if (!location) {
      return { response, finalUrl: current, rejected: false };
    }

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return { response, finalUrl: current, rejected: false };
    }

    const nextNormalized = normalizeUrl(next.toString());
    if (
      nextNormalized === null ||
      !isDiscoveryTargetAllowed(nextNormalized, origin)
    ) {
      // Refused before any request is made to the destination.
      return { response: null, finalUrl: null, rejected: true };
    }
    current = nextNormalized;
  }

  return { response: null, finalUrl: null, rejected: false };
}

function isDiscoveryTargetAllowed(url: string, origin: string): boolean {
  return isCrawlableUrl(url) && isSameOrigin(url, origin);
}

function fetchDiscoveryRequest(
  url: string,
  timeoutMs: number,
): Promise<Response> {
  return fetch(url, {
    redirect: "manual",
    headers: { "User-Agent": "OpenSEO-Audit/1.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

const MAX_ROBOTS_TXT_TIMEOUT_MS = 10_000;

/**
 * Fetch the raw robots.txt body (null = missing/unreachable). Kept separate
 * from parsing so Workflows can checkpoint the text as durable step state and
 * re-derive the parsed result deterministically on replay.
 *
 * Redirects are followed manually with the same policy as every other
 * discovery fetch: each hop's destination is validated before it is requested,
 * and an unsafe redirect (non-standard port, blocked/metadata/private host,
 * cross-origin) means robots.txt is skipped rather than fetched from there.
 */
async function fetchRobotsTxtText(origin: string): Promise<string | null> {
  const result = await fetchDiscoveryDocument(
    `${origin}/robots.txt`,
    origin,
    MAX_ROBOTS_TXT_TIMEOUT_MS,
  );

  if (result.response === null) {
    if (result.rejected) {
      console.warn(
        `Blocked a disallowed robots.txt redirect for ${origin}; skipping robots.txt.`,
      );
    }
    return null;
  }

  if (!result.response.ok) return null;
  try {
    return (await result.response.text()).slice(0, MAX_ROBOTS_TXT_BYTES);
  } catch (error) {
    // A mid-stream body-read failure is the same signal as an unreachable
    // robots.txt: discovery degrades to "everything allowed" instead of
    // letting the body error escape and abort the whole discovery phase.
    console.warn(`Failed to read robots.txt body for ${origin}:`, error);
    return null;
  }
}

/** Deterministic: same text in, same result out. Null = everything allowed. */
export function parseRobotsTxt(
  origin: string,
  text: string | null,
): RobotsResult {
  if (text === null) {
    return { isAllowed: () => true, sitemapUrls: [] };
  }

  const robots = robotsParser(`${origin}/robots.txt`, text);
  return {
    isAllowed: (url: string) => robots.isAllowed(url) ?? true,
    sitemapUrls: robots.getSitemaps(),
  };
}

/**
 * Fetch and parse a sitemap (supports sitemap index recursion).
 * Returns a flat list of page URLs found.
 */
function isProbablySitemapXml(
  contentType: string | null,
  body: string,
): boolean {
  if (contentType?.toLowerCase().includes("xml")) {
    return true;
  }

  const trimmed = body.trimStart().toLowerCase();
  return (
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<urlset") ||
    trimmed.startsWith("<sitemapindex")
  );
}

function getSitemapLocations(input: unknown): string[] {
  if (!input) return [];
  const entries = Array.isArray(input) ? input : [input];
  return entries
    .map((entry) => {
      if (isRecord(entry)) {
        const loc = entry["loc"];
        return typeof loc === "string" ? loc : null;
      }
      return null;
    })
    .filter((loc): loc is string => typeof loc === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function getParsedSitemapSections(parsed: unknown): {
  sitemap: unknown;
  url: unknown;
} {
  if (!parsed || typeof parsed !== "object") {
    return { sitemap: undefined, url: undefined };
  }

  const root = parsed as {
    sitemapindex?: { sitemap?: unknown };
    urlset?: { url?: unknown };
  };

  return {
    sitemap: root.sitemapindex?.sitemap,
    url: root.urlset?.url,
  };
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "name" in error && error.name === "TimeoutError";
}

/** Read a response body up to maxBytes; null when the body exceeds it. */
async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

async function fetchSitemapDocumentWithRetry(
  sitemapUrl: string,
  origin: string,
): Promise<{
  nestedSitemaps: string[];
  pageUrls: string[];
  timedOut: boolean;
}> {
  const normalizedSitemapUrl = normalizeUrl(sitemapUrl);
  if (!normalizedSitemapUrl) {
    return { nestedSitemaps: [], pageUrls: [], timedOut: false };
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= SITEMAP_RETRIES; attempt++) {
    const result = await fetchDiscoveryDocument(
      normalizedSitemapUrl,
      origin,
      SITEMAP_FETCH_TIMEOUT_MS,
    );
    if (result.response === null) {
      if (result.rejected) {
        console.warn(
          `Blocked a disallowed sitemap redirect (${normalizedSitemapUrl}); skipping.`,
        );
        return { nestedSitemaps: [], pageUrls: [], timedOut: false };
      }
      lastError = result.error;
      if (!isTimeoutError(lastError) || attempt === SITEMAP_RETRIES) {
        break;
      }
      continue;
    }

    const finalUrl = result.finalUrl ?? normalizedSitemapUrl;
    if (!finalUrl || !isSameOrigin(finalUrl, normalizedSitemapUrl)) {
      return { nestedSitemaps: [], pageUrls: [], timedOut: false };
    }

    if (!result.response.ok) {
      return { nestedSitemaps: [], pageUrls: [], timedOut: false };
    }

    try {
      const body = await readBodyCapped(result.response, MAX_SITEMAP_BYTES);
      if (
        body === null ||
        !isProbablySitemapXml(result.response.headers.get("content-type"), body)
      ) {
        return { nestedSitemaps: [], pageUrls: [], timedOut: false };
      }

      const parsed = xmlParser.parse(body) as unknown;
      const sections = getParsedSitemapSections(parsed);
      const nestedSitemaps = getSitemapLocations(sections.sitemap)
        .map((loc) => normalizeUrl(loc, finalUrl))
        .filter((loc): loc is string => loc !== null);
      const pageUrls = getSitemapLocations(sections.url)
        .map((loc) => normalizeUrl(loc, finalUrl))
        .filter((loc): loc is string => loc !== null);

      return { nestedSitemaps, pageUrls, timedOut: false };
    } catch (error) {
      // A mid-stream body-read or parse failure means this sitemap document is
      // unusable — the same safe outcome as an unavailable body — so it degrades
      // to "no URLs from this document" instead of escaping discovery. The
      // caller counts it as a failed doc and warns; the existing timeout-retry
      // path above is untouched.
      console.warn(
        `Skipping unusable sitemap document ${normalizedSitemapUrl}:`,
        error,
      );
      return { nestedSitemaps: [], pageUrls: [], timedOut: false };
    }
  }

  return {
    nestedSitemaps: [],
    pageUrls: [],
    timedOut: isTimeoutError(lastError),
  };
}

/**
 * Discover all page URLs from robots.txt + sitemaps for an origin.
 * Also tries the default /sitemap.xml if not listed in robots.txt.
 */
export async function discoverUrls(
  origin: string,
  maxPages = 50,
): Promise<{ urls: string[]; robotsText: string | null }> {
  const robotsText = await fetchRobotsTxtText(origin);
  const robots = parseRobotsTxt(origin, robotsText);

  // Collect sitemap URLs: from robots.txt + default location
  const sitemapSources = new Set(robots.sitemapUrls);
  sitemapSources.add(`${origin}/sitemap.xml`);

  const maxDiscoveredUrls = Math.min(Math.max(maxPages * 20, 500), 50_000);
  const allUrls = new Set<string>();

  const queue: Array<{ url: string; depth: number }> = Array.from(
    sitemapSources,
  )
    .map((url) => normalizeUrl(url, origin))
    .filter((url): url is string => url !== null)
    .filter((url) => isSameOrigin(url, origin))
    .map((url) => ({ url, depth: MAX_SITEMAP_DEPTH }));
  const seenSitemapDocs = new Set<string>();
  let fetchedDocs = 0;
  let failedDocs = 0;
  let timedOutDocs = 0;

  while (queue.length > 0 && allUrls.size < maxDiscoveredUrls) {
    if (fetchedDocs >= MAX_SITEMAP_DOCS) {
      break;
    }
    const batch = queue.splice(0, SITEMAP_CONCURRENCY);
    await Promise.all(
      batch.map(async ({ url, depth }) => {
        const normalizedUrl = normalizeUrl(url);
        if (
          !normalizedUrl ||
          !isSameOrigin(normalizedUrl, origin) ||
          depth <= 0 ||
          seenSitemapDocs.has(normalizedUrl)
        ) {
          return;
        }

        seenSitemapDocs.add(normalizedUrl);
        fetchedDocs += 1;

        const result = await fetchSitemapDocumentWithRetry(
          normalizedUrl,
          origin,
        );
        if (
          result.pageUrls.length === 0 &&
          result.nestedSitemaps.length === 0
        ) {
          failedDocs += 1;
          if (result.timedOut) {
            timedOutDocs += 1;
          }
          return;
        }

        for (const pageUrl of result.pageUrls) {
          if (!isSameOrigin(pageUrl, origin)) continue;
          if (allUrls.size >= maxDiscoveredUrls) break;
          allUrls.add(pageUrl);
        }

        if (depth <= 1) return;

        for (const nestedUrl of result.nestedSitemaps) {
          if (!isSameOrigin(nestedUrl, origin)) continue;
          if (!seenSitemapDocs.has(nestedUrl)) {
            queue.push({ url: nestedUrl, depth: depth - 1 });
          }
        }
      }),
    );
  }

  if (failedDocs > 0) {
    console.warn(
      `Sitemap discovery completed with partial failures for ${origin}: fetched=${fetchedDocs}, failed=${failedDocs}, timedOut=${timedOutDocs}, discoveredUrls=${allUrls.size}`,
    );
  }

  // Cap at the crawl's page budget: these are seeds, the crawl can never use
  // more — and an uncapped list can blow the ~1MiB Workflow step-state limit.
  return {
    urls: Array.from(allUrls).slice(0, maxPages),
    robotsText,
  };
}
