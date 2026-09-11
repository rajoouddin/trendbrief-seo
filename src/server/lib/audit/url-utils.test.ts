import { describe, expect, it } from "vitest";
import {
  canonicalSiteIdentity,
  canonicalUrlKey,
  detectUrlTemplate,
  getOrigin,
  isSameOrigin,
  normalizeUrl,
} from "@/server/lib/audit/url-utils";

describe("normalizeUrl", () => {
  it("normalizes host/query/hash, preserves trailing slash", () => {
    const value = normalizeUrl(
      "https://Example.COM/path/?b=2&a=1#section",
      "https://fallback.com",
    );

    expect(value).toBe("https://example.com/path/?a=1&b=2");
  });

  it("preserves a trailing slash on path-only URLs", () => {
    // A trailing slash is the canonical form on most CMSes; stripping it would
    // rewrite the canonical URL into its own redirect source and cause a loop.
    expect(normalizeUrl("https://example.com/services/")).toBe(
      "https://example.com/services/",
    );
  });

  it("preserves the absence of a trailing slash", () => {
    expect(normalizeUrl("https://example.com/services")).toBe(
      "https://example.com/services",
    );
  });

  it("returns null for unsupported protocol", () => {
    expect(normalizeUrl("mailto:test@example.com")).toBeNull();
  });
});

describe("canonicalUrlKey", () => {
  it("treats www and non-www as equal", () => {
    expect(canonicalUrlKey("https://www.example.com/")).toBe(
      canonicalUrlKey("https://example.com/"),
    );
  });

  it("treats http and https as equal", () => {
    expect(canonicalUrlKey("http://example.com/")).toBe(
      canonicalUrlKey("https://example.com/"),
    );
  });

  it("keeps the trailing-slash distinction in the path", () => {
    expect(canonicalUrlKey("https://example.com/services")).not.toBe(
      canonicalUrlKey("https://example.com/services/"),
    );
  });
});

describe("isSameOrigin", () => {
  it("accepts www host equivalence", () => {
    expect(
      isSameOrigin("https://www.example.com/products", "https://example.com"),
    ).toBe(true);
  });

  it("allows http to https upgrade on default ports", () => {
    expect(isSameOrigin("https://example.com/page", "http://example.com")).toBe(
      true,
    );
  });

  it("rejects mismatched hosts", () => {
    expect(isSameOrigin("https://example.org", "https://example.com")).toBe(
      false,
    );
  });
});

describe("detectUrlTemplate", () => {
  it("maps dynamic path segments", () => {
    expect(detectUrlTemplate("/blog/2026-03-01/my-great-post")).toBe(
      "/blog/:date/:slug",
    );
  });

  it("maps numeric id segments", () => {
    expect(detectUrlTemplate("/products/12345")).toBe("/products/:id");
  });
});

describe("canonicalSiteIdentity", () => {
  it("treats www/non-www, http/https and paths as the same site", () => {
    const base = "https://example.com/";
    for (const variant of [
      "https://www.example.com/a",
      "http://example.com/a?q=1",
      "http://www.example.com/sub/path",
    ]) {
      expect(canonicalSiteIdentity(variant)).toBe(base);
    }
  });

  it("distinguishes different hosts", () => {
    expect(canonicalSiteIdentity("https://example.com/")).not.toBe(
      canonicalSiteIdentity("https://other.com/"),
    );
    // A subdomain is still a different authority, even though the crawl
    // boundary allows www equivalence.
    expect(canonicalSiteIdentity("https://example.com/")).not.toBe(
      canonicalSiteIdentity("https://blog.example.com/"),
    );
  });

  it("fallbacks to a case-folded string on unparseable input", () => {
    expect(canonicalSiteIdentity("not a url")).toBe("not a url");
  });
});

describe("getOrigin", () => {
  it("returns URL origin", () => {
    expect(getOrigin("https://example.com:8080/path?q=1")).toBe(
      "https://example.com:8080",
    );
  });
});
