import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoverUrls,
  fetchDiscoveryDocument,
} from "@/server/lib/audit/discovery";

const ORIGIN = "https://example.com";

const sitemapXml = (urls: string[] | string) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${Array.isArray(urls) ? urls.join("</loc></url><url><loc>") : urls}</loc></url></urlset>`,
    { status: 200, headers: { "content-type": "application/xml" } },
  );

const redirect = (location: string) =>
  new Response(null, { status: 301, headers: { location } });

const ok = () => new Response("ok", { status: 200 });

const ALLOW_ALL_ROBOTS = "User-agent: *\nDisallow:";

/** A body stream that yields once and then fails mid-read. */
function bodyStreamThatFails(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(new TextEncoder().encode("partial-body"));
      throw new Error("connection reset during body read");
    },
  });
}

describe("fetchDiscoveryDocument", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(routes: Record<string, () => Response>) {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input instanceof Request ? input.url : input);
      const route = routes[url];
      return route ? Promise.resolve(route()) : Promise.resolve(ok());
    });
  }

  function requestedUrls(): string[] {
    return vi
      .mocked(fetch)
      .mock.calls.map(([input]) =>
        String(input instanceof Request ? input.url : input),
      );
  }

  it("follows a safe same-origin redirect to the final response", async () => {
    stubFetch({
      "https://example.com/robots.txt": () =>
        redirect("https://example.com/robots-custom.txt"),
      "https://example.com/robots-custom.txt": () => ok(),
    });

    const result = await fetchDiscoveryDocument(
      "https://example.com/robots.txt",
      ORIGIN,
      5_000,
    );
    expect(result.rejected).toBe(false);
    expect(result.response?.status).toBe(200);
    expect(result.finalUrl).toBe("https://example.com/robots-custom.txt");
  });

  it("allows the http -> https upgrade redirect within the same host", async () => {
    stubFetch({
      "http://example.com/robots.txt": () =>
        redirect("https://example.com/robots.txt"),
      "https://example.com/robots.txt": () => ok(),
    });

    const result = await fetchDiscoveryDocument(
      "http://example.com/robots.txt",
      "http://example.com",
      5_000,
    );
    expect(result.rejected).toBe(false);
    expect(result.finalUrl).toBe("https://example.com/robots.txt");
  });

  it("rejects a robots redirect to :8080 before fetching it", async () => {
    stubFetch({
      "https://example.com/robots.txt": () =>
        redirect("https://example.com:8080/robots.txt"),
    });

    const result = await fetchDiscoveryDocument(
      "https://example.com/robots.txt",
      ORIGIN,
      5_000,
    );
    expect(result.rejected).toBe(true);
    expect(result.response).toBeNull();
    expect(result.finalUrl).toBeNull();
    expect(requestedUrls()).toEqual(["https://example.com/robots.txt"]);
  });

  it("rejects a sitemap redirect to :8443 before fetching it", async () => {
    stubFetch({
      "https://example.com/sitemap.xml": () =>
        redirect("https://example.com:8443/sitemap.xml"),
    });

    const result = await fetchDiscoveryDocument(
      "https://example.com/sitemap.xml",
      ORIGIN,
      5_000,
    );
    expect(result.rejected).toBe(true);
    expect(result.response).toBeNull();
    expect(requestedUrls()).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("rejects a redirect to localhost before fetching it", async () => {
    stubFetch({
      "https://example.com/sitemap.xml": () =>
        redirect("http://localhost:8080/sitemap.xml"),
    });

    const result = await fetchDiscoveryDocument(
      "https://example.com/sitemap.xml",
      ORIGIN,
      5_000,
    );
    expect(result.rejected).toBe(true);
    expect(requestedUrls()).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("rejects a redirect to a private IP literal before fetching it", async () => {
    stubFetch({
      "https://example.com/robots.txt": () =>
        redirect("http://192.168.0.10/robots.txt"),
    });

    const result = await fetchDiscoveryDocument(
      "https://example.com/robots.txt",
      ORIGIN,
      5_000,
    );
    expect(result.rejected).toBe(true);
    expect(requestedUrls()).toEqual(["https://example.com/robots.txt"]);
  });

  it("rejects a redirect to a metadata endpoint before fetching it", async () => {
    stubFetch({
      "https://example.com/robots.txt": () =>
        redirect("http://metadata.google.internal/latest/meta-data/"),
    });

    const result = await fetchDiscoveryDocument(
      "https://example.com/robots.txt",
      ORIGIN,
      5_000,
    );
    expect(result.rejected).toBe(true);
    expect(requestedUrls()).toEqual(["https://example.com/robots.txt"]);
  });

  it("rejects a redirect across a disallowed origin before fetching it", async () => {
    stubFetch({
      "https://example.com/robots.txt": () =>
        redirect("https://other-site.example/robots.txt"),
    });

    const result = await fetchDiscoveryDocument(
      "https://example.com/robots.txt",
      ORIGIN,
      5_000,
    );
    expect(result.rejected).toBe(true);
    expect(requestedUrls()).toEqual(["https://example.com/robots.txt"]);
  });

  it("stops at the bounded hop limit on a redirect loop", async () => {
    stubFetch({
      "https://example.com/a.txt": () => redirect("https://example.com/b.txt"),
      "https://example.com/b.txt": () => redirect("https://example.com/a.txt"),
    });

    const result = await fetchDiscoveryDocument(
      "https://example.com/a.txt",
      ORIGIN,
      5_000,
    );
    // Six requests at most: the initial request plus up to 5 followed hops.
    expect(result.response).toBeNull();
    expect(result.rejected).toBe(false);
    expect(requestedUrls().length).toBeLessThanOrEqual(6);
  });
});

describe("discoverUrls — robots.txt redirect handling", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(routes: Record<string, () => Response>) {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input instanceof Request ? input.url : input);
      const route = routes[url];
      return route ? Promise.resolve(route()) : Promise.resolve(ok());
    });
  }

  function requestedUrls(): string[] {
    return vi
      .mocked(fetch)
      .mock.calls.map(([input]) =>
        String(input instanceof Request ? input.url : input),
      );
  }

  it("follows a safe same-origin robots.txt redirect", async () => {
    stubFetch({
      "https://example.com/robots.txt": () =>
        redirect("https://example.com/custom-robots.txt"),
      "https://example.com/custom-robots.txt": () =>
        new Response(
          "Sitemap: /sitemap-redirect.xml\nUser-agent: *\nDisallow: /admin",
          { status: 200 },
        ),
      "https://example.com/sitemap-redirect.xml": () =>
        sitemapXml("https://example.com/page"),
      "https://example.com/sitemap.xml": () => sitemapXml([]),
    });

    const { urls } = await discoverUrls(ORIGIN);
    expect(urls).toContain("https://example.com/page");
    expect(requestedUrls()).toContain("https://example.com/custom-robots.txt");
    expect(requestedUrls()).toContain(
      "https://example.com/sitemap-redirect.xml",
    );
  });

  it("refuses to follow a robots.txt redirect to :8080", async () => {
    stubFetch({
      "https://example.com/robots.txt": () =>
        redirect("https://example.com:8080/robots.txt"),
      "https://example.com/sitemap.xml": () => sitemapXml([]),
    });

    const { robotsText } = await discoverUrls(ORIGIN);
    expect(robotsText).toBeNull();
    expect(requestedUrls()).not.toContain(
      "https://example.com:8080/robots.txt",
    );
  });
});

describe("discoverUrls — sitemap redirect handling", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(routes: Record<string, () => Response>) {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input instanceof Request ? input.url : input);
      const route = routes[url];
      return route ? Promise.resolve(route()) : Promise.resolve(ok());
    });
  }

  function requestedUrls(): string[] {
    return vi
      .mocked(fetch)
      .mock.calls.map(([input]) =>
        String(input instanceof Request ? input.url : input),
      );
  }

  it("follows a safe same-origin sitemap redirect", async () => {
    stubFetch({
      "https://example.com/robots.txt": () =>
        new Response(ALLOW_ALL_ROBOTS, { status: 200 }),
      "https://example.com/sitemap.xml": () =>
        redirect("https://example.com/real-sitemap.xml"),
      "https://example.com/real-sitemap.xml": () =>
        sitemapXml(["https://example.com/a", "https://example.com/b"]),
    });

    const { urls } = await discoverUrls(ORIGIN, 10);
    expect(urls).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("refuses to follow a sitemap redirect to :8443", async () => {
    stubFetch({
      "https://example.com/robots.txt": () =>
        new Response(ALLOW_ALL_ROBOTS, { status: 200 }),
      "https://example.com/sitemap.xml": () =>
        redirect("https://example.com:8443/sitemap.xml"),
    });

    const { urls } = await discoverUrls(ORIGIN, 10);
    expect(urls).toEqual([]);
    expect(requestedUrls()).not.toContain(
      "https://example.com:8443/sitemap.xml",
    );
  });

  it("does not follow disallowed sitemap-index child redirects either", async () => {
    stubFetch({
      "https://example.com/robots.txt": () =>
        new Response(ALLOW_ALL_ROBOTS, { status: 200 }),
      "https://example.com/sitemap.xml": () =>
        new Response(
          '<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/child.xml</loc></sitemap></sitemapindex>',
          { status: 200, headers: { "content-type": "application/xml" } },
        ),
      "https://example.com/child.xml": () =>
        redirect("http://127.0.0.1:8080/child.xml"),
    });

    const { urls } = await discoverUrls(ORIGIN, 10);
    expect(urls).toEqual([]);
    expect(requestedUrls()).not.toContain("http://127.0.0.1:8080/child.xml");
  });
});

describe("discoverUrls — body-stream and parse degradation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(routes: Record<string, () => Response>) {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input instanceof Request ? input.url : input);
      const route = routes[url];
      return route ? Promise.resolve(route()) : Promise.resolve(ok());
    });
  }

  function requestedUrls(): string[] {
    return vi
      .mocked(fetch)
      .mock.calls.map(([input]) =>
        String(input instanceof Request ? input.url : input),
      );
  }

  it("degrades like unavailable robots when the robots.txt body read fails mid-stream", async () => {
    stubFetch({
      "https://example.com/robots.txt": () =>
        new Response(bodyStreamThatFails(), { status: 200 }),
      "https://example.com/sitemap.xml": () => sitemapXml([]),
    });

    const { robotsText } = await discoverUrls(ORIGIN);
    expect(robotsText).toBeNull();
    // Discovery continues to the default sitemap instead of aborting.
    expect(requestedUrls()).toContain("https://example.com/sitemap.xml");
  });

  it("degrades like an unavailable body when a sitemap body read fails mid-stream", async () => {
    stubFetch({
      "https://example.com/robots.txt": () =>
        new Response(ALLOW_ALL_ROBOTS, { status: 200 }),
      "https://example.com/sitemap.xml": () =>
        new Response(bodyStreamThatFails(), {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
    });

    const { urls } = await discoverUrls(ORIGIN);
    expect(urls).toEqual([]);
    // Body-read failures are not timeouts, so the existing timeout-only retry
    // path must not fire: exactly one attempt, then graceful degradation.
    expect(
      requestedUrls().filter(
        (url) => url === "https://example.com/sitemap.xml",
      ),
    ).toHaveLength(1);
  });

  it("degrades gracefully when the sitemap document body cannot be parsed as XML", async () => {
    stubFetch({
      "https://example.com/robots.txt": () =>
        new Response(ALLOW_ALL_ROBOTS, { status: 200 }),
      "https://example.com/sitemap.xml": () =>
        new Response("<<<<", {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
    });

    const { urls } = await discoverUrls(ORIGIN);
    expect(urls).toEqual([]);
    expect(
      requestedUrls().filter(
        (url) => url === "https://example.com/sitemap.xml",
      ),
    ).toHaveLength(1);
  });

  it("still discovers pages from a healthy sitemap alongside a broken one", async () => {
    stubFetch({
      "https://example.com/robots.txt": () =>
        new Response("Sitemap: /broken.xml\nSitemap: /good.xml\n", {
          status: 200,
        }),
      "https://example.com/broken.xml": () =>
        new Response(bodyStreamThatFails(), {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
      "https://example.com/good.xml": () =>
        sitemapXml("https://example.com/healthy"),
    });

    const { urls } = await discoverUrls(ORIGIN, 10);
    expect(urls).toEqual(["https://example.com/healthy"]);
  });
});
