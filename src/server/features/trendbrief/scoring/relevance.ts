import type { TrendbriefRelevanceStatus } from "../domain/types";

export type KeyPageRole = "hub" | "spoke" | "money" | "other";

export type KeyPageForRelevance = {
  url: string;
  role: KeyPageRole | null;
  topic: string | null;
};

export type CommercialRelevanceMatch = {
  status: TrendbriefRelevanceStatus;
  matchedRole: KeyPageRole | null;
  matchedTopic: string | null;
};

function normalizePath(rawUrl: string): string {
  const withScheme = rawUrl.includes("://")
    ? rawUrl
    : `https://placeholder.invalid${rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`}`;
  try {
    const parsed = new URL(withScheme);
    let path = parsed.pathname || "/";
    if (path.length > 1) path = path.replace(/\/+$/, "");
    return path.toLowerCase();
  } catch {
    return rawUrl.toLowerCase();
  }
}

export function matchCommercialRelevance(
  subjectUrl: string,
  keyPages: KeyPageForRelevance[],
): CommercialRelevanceMatch {
  const subjectPath = normalizePath(subjectUrl);
  const match = keyPages.find((page) => normalizePath(page.url) === subjectPath);
  if (!match) {
    return { status: "unconfirmed", matchedRole: null, matchedTopic: null };
  }
  return { status: "confirmed", matchedRole: match.role, matchedTopic: match.topic };
}
