import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppError } from "@/server/lib/errors";
import {
  isCrawlableUrl,
  normalizeAndValidateStartUrl,
  resolveStartUrlRedirects,
} from "@/server/lib/audit/url-policy";

describe("normalizeAndValidateStartUrl", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds https when protocol is missing and strips hash", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ Status: 0, Answer: [] }), {
        status: 200,
        headers: { "content-type": "application/dns-json" },
      }),
    );

    await expect(
      normalizeAndValidateStartUrl("example.com/path#section"),
    ).resolves.toBe("https://example.com/path");
  });

  it("blocks localhost-like targets", async () => {
    await expect(
      normalizeAndValidateStartUrl("http://localhost:3000"),
    ).rejects.toMatchObject({
      code: "CRAWL_TARGET_BLOCKED",
    } satisfies Partial<AppError>);
  });

  it("blocks private ip targets", async () => {
    await expect(
      normalizeAndValidateStartUrl("http://192.168.0.10"),
    ).rejects.toMatchObject({
      code: "CRAWL_TARGET_BLOCKED",
    } satisfies Partial<AppError>);
  });

  it("rejects invalid URL input", async () => {
    await expect(
      normalizeAndValidateStartUrl("not a url"),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    } satisfies Partial<AppError>);
  });
});

describe("isCrawlableUrl", () => {
  it("accepts http://example.com", () => {
    expect(isCrawlableUrl("http://example.com/")).toBe(true);
  });

  it("accepts https://example.com", () => {
    expect(isCrawlableUrl("https://example.com/")).toBe(true);
  });

  it("accepts an explicit :80 port on HTTP", () => {
    expect(isCrawlableUrl("http://example.com:80/")).toBe(true);
  });

  it("accepts an explicit :443 port on HTTPS", () => {
    expect(isCrawlableUrl("https://example.com:443/")).toBe(true);
  });

  it("accepts the implicit default port for http URLs missing a port", () => {
    expect(isCrawlableUrl("http://example.com/path")).toBe(true);
  });

  it("rejects :8080", () => {
    expect(isCrawlableUrl("http://example.com:8080/")).toBe(false);
  });

  it("rejects :3000", () => {
    expect(isCrawlableUrl("http://example.com:3000/")).toBe(false);
  });

  it("rejects :22", () => {
    expect(isCrawlableUrl("https://example.com:22/")).toBe(false);
  });

  it("rejects a port that does not match the scheme (http on :443)", () => {
    expect(isCrawlableUrl("http://example.com:443/")).toBe(false);
  });

  it("rejects localhost and loopback hosts", () => {
    expect(isCrawlableUrl("http://localhost/")).toBe(false);
    expect(isCrawlableUrl("http://127.0.0.1/")).toBe(false);
    expect(isCrawlableUrl("http://::1/")).toBe(false);
  });

  it("rejects private IPs", () => {
    expect(isCrawlableUrl("http://10.0.0.5/")).toBe(false);
    expect(isCrawlableUrl("http://172.16.0.5/")).toBe(false);
    expect(isCrawlableUrl("http://192.168.0.10/")).toBe(false);
  });

  it("rejects link-local and CGN ranges", () => {
    expect(isCrawlableUrl("http://169.254.0.10/")).toBe(false);
    expect(isCrawlableUrl("http://100.100.100.200/")).toBe(false);
  });

  it("rejects metadata endpoints", () => {
    expect(isCrawlableUrl("http://metadata.google.internal/")).toBe(false);
    expect(isCrawlableUrl("http://metadata/")).toBe(false);
  });

  it("rejects non-http(s) schemes", () => {
    expect(isCrawlableUrl("ftp://example.com/")).toBe(false);
    expect(isCrawlableUrl("file:///etc/passwd")).toBe(false);
  });
});

describe("normalizeAndValidateStartUrl port policy", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["http://example.com", "http://example.com/"],
    ["https://example.com", "https://example.com/"],
    ["http://example.com:80/", "http://example.com/"],
    ["https://example.com:443/", "https://example.com/"],
  ])("accepts %s", async (input, expected) => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ Status: 0, Answer: [] }), {
        status: 200,
        headers: { "content-type": "application/dns-json" },
      }),
    );
    await expect(normalizeAndValidateStartUrl(input)).resolves.toBe(expected);
  });

  it.each([
    "http://example.com:8080/",
    "http://example.com:3000/",
    "https://example.com:22/",
  ])("rejects non-standard port %s", async (input) => {
    await expect(normalizeAndValidateStartUrl(input)).rejects.toMatchObject({
      code: "CRAWL_TARGET_BLOCKED",
    } satisfies Partial<AppError>);
  });

  it("rejects a metadata start target", async () => {
    await expect(
      normalizeAndValidateStartUrl("http://metadata.google.internal/"),
    ).rejects.toMatchObject({
      code: "CRAWL_TARGET_BLOCKED",
    } satisfies Partial<AppError>);
  });
});

const dnsOk = () =>
  new Response(JSON.stringify({ Status: 0, Answer: [] }), {
    status: 200,
    headers: { "content-type": "application/dns-json" },
  });
const redirect = (location: string) =>
  new Response(null, { status: 301, headers: { location } });

describe("resolveStartUrlRedirects", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Route probe fetches by URL; DoH lookups always resolve clean. */
  function stubFetch(routes: Record<string, () => Response>) {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("dns-query")) return Promise.resolve(dnsOk());
      const route = routes[url];
      return route
        ? Promise.resolve(route())
        : Promise.resolve(new Response(null, { status: 200 }));
    });
  }

  it("follows a cross-domain redirect to the real origin", async () => {
    stubFetch({
      "https://example.net/": () => redirect("https://example.com/"),
    });
    await expect(
      resolveStartUrlRedirects("https://example.net/"),
    ).resolves.toBe("https://example.com/");
  });

  it("follows an apex-to-www redirect chain", async () => {
    stubFetch({
      "https://example.com/": () => redirect("https://www.example.com/"),
    });
    await expect(
      resolveStartUrlRedirects("https://example.com/"),
    ).resolves.toBe("https://www.example.com/");
  });

  it("returns the original URL when the site does not redirect", async () => {
    stubFetch({});
    await expect(
      resolveStartUrlRedirects("https://example.com/"),
    ).resolves.toBe("https://example.com/");
  });

  it("returns the last URL when the probe fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    await expect(
      resolveStartUrlRedirects("https://example.com/"),
    ).resolves.toBe("https://example.com/");
  });

  it("stops after the hop limit on a redirect loop", async () => {
    stubFetch({
      "https://a.example/": () => redirect("https://b.example/"),
      "https://b.example/": () => redirect("https://a.example/"),
    });
    await expect(
      resolveStartUrlRedirects("https://a.example/"),
    ).resolves.toMatch(/^https:\/\/(a|b)\.example\/$/);
  });

  it("rejects redirects into blocked targets", async () => {
    stubFetch({
      "https://example.com/": () => redirect("http://192.168.0.10/"),
    });
    await expect(
      resolveStartUrlRedirects("https://example.com/"),
    ).rejects.toMatchObject({
      code: "CRAWL_TARGET_BLOCKED",
    } satisfies Partial<AppError>);
  });

  it("rejects redirects into non-standard ports", async () => {
    stubFetch({
      "https://example.com/": () => redirect("https://example.com:8443/"),
    });
    await expect(
      resolveStartUrlRedirects("https://example.com/"),
    ).rejects.toMatchObject({
      code: "CRAWL_TARGET_BLOCKED",
    } satisfies Partial<AppError>);
  });

  it("rejects redirects into metadata endpoints", async () => {
    stubFetch({
      "https://example.com/": () =>
        redirect("http://metadata.google.internal/"),
    });
    await expect(
      resolveStartUrlRedirects("https://example.com/"),
    ).rejects.toMatchObject({
      code: "CRAWL_TARGET_BLOCKED",
    } satisfies Partial<AppError>);
  });

  it("still follows redirects to safe standard-port targets", async () => {
    stubFetch({
      "https://example.com/": () => redirect("https://www.example.com/"),
    });
    await expect(
      resolveStartUrlRedirects("https://example.com/"),
    ).resolves.toBe("https://www.example.com/");
  });
});
