import { describe, expect, it } from "vitest";
import { matchCommercialRelevance } from "./relevance";

const keyPages = [
  {
    url: "https://example.com/tree-removal-cheltenham",
    role: "money" as const,
    topic: "tree removal",
  },
  {
    url: "https://example.com/blog/pruning-tips",
    role: "spoke" as const,
    topic: "pruning",
  },
];

describe("matchCommercialRelevance", () => {
  it("confirms relevance when the subject URL matches a key page by path, ignoring host/scheme", () => {
    const result = matchCommercialRelevance(
      "/tree-removal-cheltenham",
      keyPages,
    );
    expect(result.status).toBe("confirmed");
    expect(result.matchedRole).toBe("money");
    expect(result.matchedTopic).toBe("tree removal");
  });

  it("confirms relevance when the subject URL has a trailing slash and the key page doesn't", () => {
    const result = matchCommercialRelevance(
      "https://example.com/tree-removal-cheltenham/",
      keyPages,
    );
    expect(result.status).toBe("confirmed");
  });

  it("leaves relevance unconfirmed (not rejected) when no key page matches", () => {
    const result = matchCommercialRelevance("/some-other-page", keyPages);
    expect(result.status).toBe("unconfirmed");
    expect(result.matchedRole).toBeNull();
  });

  it("leaves relevance unconfirmed when the project has no key pages at all", () => {
    const result = matchCommercialRelevance("/tree-removal-cheltenham", []);
    expect(result.status).toBe("unconfirmed");
  });
});
