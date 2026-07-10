import { describe, expect, test } from "bun:test";

import {
  canGoBack,
  canGoForward,
  EMPTY_HISTORY,
  faviconUrl,
  isLikelyBlocked,
  normalizeUrl,
  pushHistory,
  resolveNavigation,
  stepHistory,
  toEmbeddable,
} from "./BrowserPanel";

describe("normalizeUrl", () => {
  test("keeps absolute http(s) URLs untouched", () => {
    expect(normalizeUrl("https://example.com/x")).toBe("https://example.com/x");
    expect(normalizeUrl("http://localhost:5173")).toBe("http://localhost:5173");
    expect(normalizeUrl("  https://example.com  ")).toBe("https://example.com");
  });

  test("adds https:// to bare domains", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com");
    expect(normalizeUrl("duckduckgo.com")).toBe("https://duckduckgo.com");
  });

  test("keeps localhost/dev servers on http", () => {
    expect(normalizeUrl("localhost:5173")).toBe("http://localhost:5173");
    expect(normalizeUrl("127.0.0.1:1420/app")).toBe("http://127.0.0.1:1420/app");
    expect(normalizeUrl("[::1]:3000")).toBe("http://[::1]:3000");
    expect(normalizeUrl("devbox.local:8080")).toBe("http://devbox.local:8080");
  });

  test("falls back to a DuckDuckGo search for free text", () => {
    expect(normalizeUrl("how to center a div")).toBe(
      "https://duckduckgo.com/?q=how%20to%20center%20a%20div",
    );
    // single word without a dot is a search, not a domain
    expect(normalizeUrl("rust")).toBe("https://duckduckgo.com/?q=rust");
  });

  test("empty input yields empty string", () => {
    expect(normalizeUrl("")).toBe("");
    expect(normalizeUrl("   ")).toBe("");
  });
});

describe("toEmbeddable", () => {
  test("rewrites YouTube watch links to the embeddable player", () => {
    expect(toEmbeddable("https://www.youtube.com/watch?v=abc123")).toBe(
      "https://www.youtube.com/embed/abc123",
    );
  });

  test("rewrites youtu.be short links", () => {
    expect(toEmbeddable("https://youtu.be/abc123")).toBe("https://www.youtube.com/embed/abc123");
  });

  test("rewrites YouTube shorts", () => {
    expect(toEmbeddable("https://www.youtube.com/shorts/xyz")).toBe(
      "https://www.youtube.com/embed/xyz",
    );
  });

  test("leaves non-YouTube URLs unchanged", () => {
    expect(toEmbeddable("https://example.com/watch?v=abc")).toBe("https://example.com/watch?v=abc");
  });

  test("returns malformed input unchanged", () => {
    expect(toEmbeddable("not a url")).toBe("not a url");
  });
});

describe("isLikelyBlocked", () => {
  test("DuckDuckGo — the default search target — is detected as blocked", () => {
    // This is the regression behind «duckduckgo.com отказано в подключении».
    expect(isLikelyBlocked("https://duckduckgo.com")).toBe(true);
    expect(isLikelyBlocked("https://duckduckgo.com/?q=rust")).toBe(true);
  });

  test("major framing-blockers are detected (incl. www. and subdomains)", () => {
    for (const u of [
      "https://www.google.com",
      "https://github.com/luxor-app/luxor",
      "https://x.com/home",
      "https://www.reddit.com/r/rust",
      "https://accounts.google.com/signin",
      "https://www.youtube.com",
      "https://www.bing.com/search?q=x",
    ]) {
      expect(isLikelyBlocked(u)).toBe(true);
    }
  });

  test("the YouTube embed player is NOT blocked (only the main site is)", () => {
    expect(isLikelyBlocked("https://www.youtube.com/embed/abc123")).toBe(false);
  });

  test("embeddable-friendly sites are not blocked", () => {
    expect(isLikelyBlocked("https://example.com")).toBe(false);
    expect(isLikelyBlocked("https://www.wikipedia.org")).toBe(false);
    expect(isLikelyBlocked("https://skills.sh")).toBe(false);
  });

  test("malformed URLs are treated as not blocked", () => {
    expect(isLikelyBlocked("garbage")).toBe(false);
  });
});

describe("resolveNavigation", () => {
  test("empty input resolves to null", () => {
    expect(resolveNavigation("", "embedded")).toBeNull();
    expect(resolveNavigation("   ", "window")).toBeNull();
  });

  test("window mode sends everything to the native window", () => {
    expect(resolveNavigation("example.com", "window")).toEqual({
      url: "https://example.com",
      target: "window",
    });
    expect(resolveNavigation("wikipedia.org", "window")?.target).toBe("window");
  });

  test("embedded mode embeds framing-friendly sites", () => {
    expect(resolveNavigation("example.com", "embedded")).toEqual({
      url: "https://example.com",
      target: "embed",
    });
  });

  test("embedded mode promotes framing-blocked sites to the native window", () => {
    // The core fix: a DuckDuckGo search no longer dead-ends on "refused to
    // connect" — it opens in a window that actually renders it.
    expect(resolveNavigation("duckduckgo.com", "embedded")?.target).toBe("window");
    expect(resolveNavigation("best rust crates", "embedded")?.target).toBe("window");
    expect(resolveNavigation("github.com", "embedded")?.target).toBe("window");
  });

  test("force always embeds, even for blocked sites (\"try anyway\")", () => {
    expect(resolveNavigation("github.com", "embedded", true)?.target).toBe("embed");
    expect(resolveNavigation("github.com", "window", true)?.target).toBe("embed");
  });

  test("applies the YouTube embed rewrite to the resolved URL", () => {
    const nav = resolveNavigation("https://www.youtube.com/watch?v=abc123", "embedded", true);
    expect(nav?.url).toBe("https://www.youtube.com/embed/abc123");
    expect(nav?.target).toBe("embed");
  });

  test("a YouTube watch link in embedded mode resolves to the embeddable player inline", () => {
    // /watch is blocked, but toEmbeddable turns it into /embed/ which is allowed.
    const nav = resolveNavigation("https://www.youtube.com/watch?v=abc123", "embedded");
    expect(nav?.url).toBe("https://www.youtube.com/embed/abc123");
    expect(nav?.target).toBe("embed");
  });
});

describe("browser history", () => {
  test("pushHistory appends and advances the cursor", () => {
    let h = EMPTY_HISTORY;
    h = pushHistory(h, "https://a.com");
    h = pushHistory(h, "https://b.com");
    expect(h.entries).toEqual(["https://a.com", "https://b.com"]);
    expect(h.index).toBe(1);
    expect(canGoBack(h)).toBe(true);
    expect(canGoForward(h)).toBe(false);
  });

  test("pushHistory treats the same URL as a reload (no new entry)", () => {
    let h = pushHistory(EMPTY_HISTORY, "https://a.com");
    const same = pushHistory(h, "https://a.com");
    expect(same).toBe(h);
    expect(same.entries.length).toBe(1);
  });

  test("stepHistory moves back then forward", () => {
    let h = EMPTY_HISTORY;
    h = pushHistory(h, "https://a.com");
    h = pushHistory(h, "https://b.com");
    const back = stepHistory(h, -1);
    expect(back.index).toBe(0);
    expect(back.entries[back.index]).toBe("https://a.com");
    expect(canGoForward(back)).toBe(true);
    const fwd = stepHistory(back, 1);
    expect(fwd.entries[fwd.index]).toBe("https://b.com");
  });

  test("navigating after going back truncates the forward stack", () => {
    let h = EMPTY_HISTORY;
    h = pushHistory(h, "https://a.com");
    h = pushHistory(h, "https://b.com");
    h = stepHistory(h, -1); // back to a
    h = pushHistory(h, "https://c.com"); // new branch
    expect(h.entries).toEqual(["https://a.com", "https://c.com"]);
    expect(h.index).toBe(1);
    expect(canGoForward(h)).toBe(false);
  });

  test("stepHistory is a no-op at the edges", () => {
    const h = pushHistory(EMPTY_HISTORY, "https://a.com");
    expect(stepHistory(h, -1)).toBe(h);
    expect(stepHistory(h, 1)).toBe(h);
  });
});

describe("faviconUrl", () => {
  test("returns a favicon service URL for the host of a web page", () => {
    expect(faviconUrl("https://github.com/foo/bar")).toBe(
      "https://icons.duckduckgo.com/ip3/github.com.ico",
    );
    expect(faviconUrl("http://localhost:5173/app")).toBe(
      "https://icons.duckduckgo.com/ip3/localhost.ico",
    );
  });

  test("returns null for non-web or invalid URLs", () => {
    expect(faviconUrl("about:blank")).toBeNull();
    expect(faviconUrl("file:///tmp/x.html")).toBeNull();
    expect(faviconUrl("")).toBeNull();
    expect(faviconUrl("not a url")).toBeNull();
  });
});
