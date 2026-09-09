/**
 * Per-issue-type copy and evidence for Website Health findings.
 *
 * Evidence is pre-rendered from persisted page data and the issue row's own
 * details, and never falls back to dumping the raw details JSON. Remediation
 * ("what to do") lives in the shared issue registry; this module supplies the
 * deterministic "problem" statement and re-run verification guidance that the
 * registry does not carry.
 */
import type {
  FindingEvidence,
  HealthIssueRow,
  HealthPageRow,
  IssueDetails,
} from "@/shared/audit-health/types";

const PROBLEM: Record<string, string> = {
  "blocked-page":
    "The site's bot protection challenged our crawler instead of serving the page, so the page could not be audited.",
  "server-error": "The URL returned a 5xx server error.",
  "broken-internal-link":
    "This page links to an internal URL that returned an error status.",
  "sitemap-noindex-conflict":
    "The URL is listed in the sitemap and the page itself sends a noindex signal.",
  "canonical-conflict":
    "The page declares a different canonical URL in its HTML and its HTTP Link header.",
  "missing-title": "This indexable page has no <title> tag.",
  "missing-h1": "This indexable page has no H1 heading.",
  "broken-page": "The URL returned a 4xx client error.",
  "missing-meta-description": "This page has no meta description.",
  "multiple-h1": "The page has more than one H1 heading.",
  "duplicate-title": "This title is shared with other pages.",
  "duplicate-meta-description":
    "This meta description is shared with other pages.",
  "duplicate-content": "The visible text is identical to another URL's.",
  "redirect-chain":
    "Reaching this page takes two or more consecutive redirects.",
  "redirect-loop": "The redirect points back into itself and never resolves.",
  "thin-content": "The page has very little visible text.",
  "images-missing-alt": "One or more images on the page lack alt text.",
  "orphan-page": "No crawled page links to this URL.",
  "no-outgoing-links": "The page contains no outgoing links.",
  "noindex-page": "The page tells search engines not to index it.",
  "canonicalized-page": "The page declares another URL as its canonical.",
  "deep-page": "The page is deep in the site structure.",
};

function num(details: IssueDetails, key: string): number | null {
  const value = details[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(details: IssueDetails, key: string): string | null {
  const value = details[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

const PROBLEM_WITH_EVIDENCE: Record<string, (details: IssueDetails) => string> =
  {
    "title-too-long": (details) =>
      `The title is ${num(details, "length") ?? "?"} characters — over the ~60 character guideline.`,
    "title-too-short": (details) =>
      `The title is ${num(details, "length") ?? "?"} characters — under the ~10 character guideline.`,
    "meta-description-too-long": (details) =>
      `The meta description is ${num(details, "length") ?? "?"} characters — over the ~160 character guideline.`,
    "meta-description-too-short": (details) =>
      `The meta description is ${num(details, "length") ?? "?"} characters — under the ~70 character guideline.`,
    "heading-order-skip": () =>
      "The heading hierarchy skips levels (e.g. H2 followed by H4).",
    "slow-response": (details) =>
      `The server took ${num(details, "responseTimeMs") ?? "?"}ms to respond — over the 1.5s guideline.`,
  };

const HOW_TO_VERIFY: Record<string, string> = {
  "blocked-page":
    "Re-run the audit after adjusting the bot-protection rules. The finding disappears once the crawler can read the page.",
  "server-error":
    "Re-run the audit after fixing the underlying error. The finding disappears once the page returns a successful response.",
  "broken-internal-link":
    "Re-run the audit after updating or removing the link. The finding disappears once every internal link resolves to a live page.",
  "sitemap-noindex-conflict":
    "Re-run the audit after the page and sitemap agree on indexability. The finding disappears once the page is either indexable and in the sitemap, or non-indexable and out of it.",
  "canonical-conflict":
    "Re-run the audit after picking one canonical declaration. The finding disappears once the HTML and header canonicals match.",
  "missing-title":
    "Re-run the audit after adding a title. The finding disappears once the page has a <title> tag.",
  "missing-h1":
    "Re-run the audit after adding an H1. The finding disappears once the page has an H1 heading.",
  "broken-page":
    "Re-run the audit after restoring, redirecting, or removing the URL. The finding disappears once the URL returns a successful response or is gone from the crawl.",
  "missing-meta-description":
    "Re-run the audit after adding a description. The finding disappears once the page has a meta description.",
  "multiple-h1":
    "Re-run the audit after demoting the extra H1s. The finding disappears once the page has a single H1.",
  "duplicate-title":
    "Re-run the audit after making the titles unique. The finding disappears once no two pages share this title.",
  "duplicate-meta-description":
    "Re-run the audit after making the descriptions unique. The finding disappears once no two pages share this description.",
  "duplicate-content":
    "Re-run the audit after consolidating the duplicates. The finding disappears once each URL serves distinct content.",
  "redirect-chain":
    "Re-run the audit after pointing the links at the final URL. The finding disappears once the page is reachable in one redirect or none.",
  "redirect-loop":
    "Re-run the audit after fixing the redirect rules. The finding disappears once the URL resolves to a final 200 page.",
  "thin-content":
    "Re-run the audit after expanding the page or deliberately marking it non-indexable. The finding disappears once the page has substantially more content or no longer asks to be indexed.",
  "images-missing-alt":
    "Re-run the audit after adding alt text. The finding disappears once every meaningful image has alt text.",
  "orphan-page":
    "Re-run the audit after linking to the page. The finding disappears once another crawled page links to it.",
  "no-outgoing-links":
    "Re-run the audit after adding onward links. The finding disappears once the page contains at least one link.",
  "noindex-page":
    "Re-run the audit after changing the directive if it was unintended. The finding disappears once the page is indexable — or stays as a confirmation that the noindex is intentional.",
  "canonicalized-page":
    "Re-run the audit after setting the canonical to the page itself if it should rank. The finding disappears once the page declares itself canonical — or stays as a confirmation that the canonicalization is intentional.",
  "deep-page":
    "Re-run the audit after adding links from higher-level pages. The finding disappears once the page is within a few clicks of the homepage.",
  "title-too-long":
    "Re-run the audit after shortening the title. The finding disappears once the title fits the guideline.",
  "title-too-short":
    "Re-run the audit after expanding the title. The finding disappears once the title is descriptive.",
  "meta-description-too-long":
    "Re-run the audit after trimming the description. The finding disappears once it fits the guideline.",
  "meta-description-too-short":
    "Re-run the audit after expanding the description. The finding disappears once it is descriptive.",
  "heading-order-skip":
    "Re-run the audit after fixing the heading levels. The finding disappears once the headings descend one level at a time.",
  "slow-response":
    "Re-run the audit after addressing server time. The finding disappears once the response is consistently under the threshold.",
};

const FALLBACK_VERIFY =
  "Re-run the audit after making the change. This finding should disappear for the affected URL(s).";

export function problemText(issueType: string, details: IssueDetails): string {
  const withEvidence = PROBLEM_WITH_EVIDENCE[issueType];
  if (withEvidence) return withEvidence(details);
  return PROBLEM[issueType] ?? issueType;
}

export function verifyTextFor(issueType: string): string {
  return HOW_TO_VERIFY[issueType] ?? FALLBACK_VERIFY;
}

// ─── Evidence ───────────────────────────────────────────────────────────────

function parseDetails(detailsJson: string | null | undefined): IssueDetails {
  if (!detailsJson) return {};
  try {
    const value: unknown = JSON.parse(detailsJson);
    if (!!value && typeof value === "object" && !Array.isArray(value)) {
      const result: IssueDetails = {};
      for (const entry of Object.entries(value)) {
        result[entry[0]] = entry[1];
      }
      return result;
    }
    return {};
  } catch {
    return {};
  }
}

function urlPart(value: unknown): string {
  if (typeof value === "string") return value;
  return typeof value === "number" ? String(value) : "";
}

function hopList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((hop) => urlPart(hop)).filter((hop) => hop.length > 0);
}

const STATUS_EVIDENCE_TYPES = new Set([
  "blocked-page",
  "server-error",
  "broken-page",
]);

type EvidenceBuilder = (
  details: IssueDetails,
  page?: HealthPageRow,
) => FindingEvidence[];

const EVIDENCE_BUILDERS: Record<string, EvidenceBuilder> = {
  "broken-internal-link": (details) => {
    const out: FindingEvidence[] = [];
    const target = str(details, "targetUrl");
    if (target) out.push({ label: "Link target", value: target });
    const targetStatus = num(details, "targetStatus");
    if (targetStatus != null) {
      out.push({ label: "Target status", value: String(targetStatus) });
    }
    return out;
  },
  "sitemap-noindex-conflict": (details) => {
    const out: FindingEvidence[] = [{ label: "Sitemap", value: "listed" }];
    const directive = str(details, "robotsMeta") ?? str(details, "xRobotsTag");
    if (directive) out.push({ label: "Noindex signal", value: directive });
    return out;
  },
  "canonical-conflict": (details) => {
    const out: FindingEvidence[] = [];
    const html = str(details, "htmlCanonical");
    if (html) out.push({ label: "HTML canonical", value: html });
    const header = str(details, "headerCanonical");
    if (header) out.push({ label: "Header canonical", value: header });
    return out;
  },
  "canonicalized-page": (details) => {
    const out: FindingEvidence[] = [];
    const canonical = str(details, "canonicalUrl");
    if (canonical) out.push({ label: "Canonical target", value: canonical });
    return out;
  },
  "noindex-page": (details) => {
    const out: FindingEvidence[] = [];
    const directive = str(details, "robotsMeta") ?? str(details, "xRobotsTag");
    if (directive) out.push({ label: "Noindex signal", value: directive });
    return out;
  },
  "title-too-long": (details, page) => {
    const out: FindingEvidence[] = [];
    if (page)
      out.push({ label: "Current title", value: page.title ?? "(none)" });
    const length = num(details, "length");
    if (length != null)
      out.push({ label: "Length", value: `${length} characters` });
    return out;
  },
  "title-too-short": (details, page) => {
    const out: FindingEvidence[] = [];
    if (page)
      out.push({ label: "Current title", value: page.title ?? "(none)" });
    const length = num(details, "length");
    if (length != null)
      out.push({ label: "Length", value: `${length} characters` });
    return out;
  },
  "meta-description-too-long": (details, page) => {
    const out: FindingEvidence[] = [];
    if (page) {
      out.push({
        label: "Current description",
        value: page.metaDescription ?? "(none)",
      });
    }
    const length = num(details, "length");
    if (length != null)
      out.push({ label: "Length", value: `${length} characters` });
    return out;
  },
  "meta-description-too-short": (details, page) => {
    const out: FindingEvidence[] = [];
    if (page) {
      out.push({
        label: "Current description",
        value: page.metaDescription ?? "(none)",
      });
    }
    const length = num(details, "length");
    if (length != null)
      out.push({ label: "Length", value: `${length} characters` });
    return out;
  },
  "missing-title": (_details, page) =>
    page ? [{ label: "Current title", value: "(none)" }] : [],
  "missing-meta-description": (_details, page) =>
    page ? [{ label: "Current description", value: "(none)" }] : [],
  "thin-content": (_details, page) =>
    page ? [{ label: "Words", value: String(page.wordCount ?? 0) }] : [],
  "images-missing-alt": (details) => {
    const out: FindingEvidence[] = [];
    const missing = num(details, "imagesMissingAlt");
    if (missing != null) {
      out.push({
        label: "Images missing alt",
        value: `${missing} of ${num(details, "imagesTotal") ?? "?"}`,
      });
    }
    return out;
  },
  "slow-response": (details) => {
    const ms = num(details, "responseTimeMs");
    return ms != null ? [{ label: "Response time", value: `${ms}ms` }] : [];
  },
  "deep-page": (details) => {
    const depth = num(details, "crawlDepth");
    return depth != null ? [{ label: "Depth", value: `${depth} clicks` }] : [];
  },
  "duplicate-title": (details) =>
    groupSizeEvidence(details, "pages share this"),
  "duplicate-meta-description": (details) =>
    groupSizeEvidence(details, "pages share this"),
  "duplicate-content": (details) =>
    groupSizeEvidence(details, "pages share this"),
  "redirect-chain": (details) => {
    const out: FindingEvidence[] = redirectPathEvidence(details);
    const finalUrl = str(details, "finalUrl");
    if (finalUrl) out.push({ label: "Final URL", value: finalUrl });
    return out;
  },
  "redirect-loop": (details) => redirectPathEvidence(details),
  "multiple-h1": (details) => {
    const count = num(details, "h1Count");
    return count != null ? [{ label: "H1 count", value: String(count) }] : [];
  },
};

function groupSizeEvidence(
  details: IssueDetails,
  suffix: string,
): FindingEvidence[] {
  const size = num(details, "groupSize");
  return size != null
    ? [{ label: "Duplicate group", value: `${size} ${suffix}` }]
    : [];
}

function redirectPathEvidence(details: IssueDetails): FindingEvidence[] {
  const hops = hopList(details.hops);
  if (hops.length === 0) return [];
  const shown = hops.slice(0, 6).join(" → ") + (hops.length > 6 ? " → …" : "");
  return [{ label: "Redirect path", value: shown }];
}

/**
 * Pre-rendered evidence lines for one affected URL. Layered from persisted
 * page data plus the row's own details. Unknown detail keys are ignored, so a
 * plausible-but-wrong issue engine payload can never surface as user copy.
 */
export function buildUrlEvidence(
  issue: HealthIssueRow,
  page?: HealthPageRow,
): FindingEvidence[] {
  const details = parseDetails(issue.detailsJson);
  const lines: FindingEvidence[] = [];

  if (STATUS_EVIDENCE_TYPES.has(issue.issueType) && page?.statusCode != null) {
    lines.push({ label: "HTTP status", value: String(page.statusCode) });
  }

  const builder = EVIDENCE_BUILDERS[issue.issueType];
  if (builder) lines.push(...builder(details, page));
  return lines;
}
