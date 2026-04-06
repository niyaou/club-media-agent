import { describe, expect, it, vi } from "vitest";

import { ensureLoggedIn } from "../src/site/rednote/client.js";

const REDNOTE_HOME_URL = "https://www.xiaohongshu.com/";

interface FakePageOptions {
  initialUrl?: string;
  authenticatedAfterPolls?: number | null;
  loginIndicatorCount?: number;
}

function createFakePage(options: FakePageOptions = {}) {
  let currentUrl = options.initialUrl ?? "about:blank";
  let closed = false;
  let polls = 0;

  const page = {
    goto: vi.fn(async (url: string) => {
      currentUrl = url;
    }),
    url: vi.fn(() => currentUrl),
    bringToFront: vi.fn(async () => {}),
    waitForLoadState: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {
      polls += 1;
    }),
    locator: vi.fn((selector: string) => ({
      count: vi.fn(async () => {
        const authenticatedAfterPolls = options.authenticatedAfterPolls ?? null;
        const isAuthSelector = selector.includes("avatar") || selector.includes("user") || selector.includes("data-testid");
        const isLoginSelector = selector.includes("登录") || selector.includes("Log in") || selector.includes("login");

        if (isLoginSelector) {
          return options.loginIndicatorCount ?? 0;
        }

        if (!isAuthSelector) {
          return 0;
        }

        if (authenticatedAfterPolls === null) {
          return 0;
        }

        return polls >= authenticatedAfterPolls ? 1 : 0;
      })
    })),
    close: vi.fn(async () => {
      closed = true;
    }),
    isClosed: vi.fn(() => closed)
  };

  return page;
}

function createFakeContext(pages: ReturnType<typeof createFakePage>[]) {
  return {
    pages: vi.fn(() => pages),
    newPage: vi.fn(async () => {
      throw new Error("newPage should not be called in this test");
    })
  };
}

describe("ensureLoggedIn", () => {
  it("keeps the Xiaohongshu page in front and closes extra blank tabs", async () => {
    const blankPage = createFakePage();
    const rednotePage = createFakePage({
      initialUrl: "https://www.xiaohongshu.com/explore",
      authenticatedAfterPolls: 0
    });
    const context = createFakeContext([blankPage, rednotePage]);

    await ensureLoggedIn(context as never);

    expect(rednotePage.goto).toHaveBeenCalledWith(REDNOTE_HOME_URL, { waitUntil: "domcontentloaded" });
    expect(rednotePage.bringToFront).toHaveBeenCalled();
    expect(blankPage.close).toHaveBeenCalledTimes(1);
    expect(context.newPage).not.toHaveBeenCalled();
  });

  it("waits for authentication to appear in the browser before continuing", async () => {
    const rednotePage = createFakePage({
      initialUrl: "https://www.xiaohongshu.com/explore",
      authenticatedAfterPolls: 2
    });
    const context = createFakeContext([rednotePage]);

    await ensureLoggedIn(context as never, {
      loginTimeoutMs: 5_000,
      loginPollIntervalMs: 100
    });

    expect(rednotePage.waitForTimeout.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("does not treat public feed avatars as authenticated when login buttons are visible", async () => {
    const rednotePage = createFakePage({
      initialUrl: "https://www.xiaohongshu.com/explore",
      authenticatedAfterPolls: null,
      loginIndicatorCount: 2
    });
    const context = createFakeContext([rednotePage]);

    await expect(
      ensureLoggedIn(context as never, {
        loginTimeoutMs: 250,
        loginPollIntervalMs: 100
      })
    ).rejects.toThrow("REDnote login was not detected");
  });

  it("throws instead of crawling anonymously when login never completes", async () => {
    const rednotePage = createFakePage({
      initialUrl: "https://www.xiaohongshu.com/explore",
      authenticatedAfterPolls: null
    });
    const context = createFakeContext([rednotePage]);

    await expect(
      ensureLoggedIn(context as never, {
        loginTimeoutMs: 250,
        loginPollIntervalMs: 100
      })
    ).rejects.toThrow("REDnote login was not detected");
  });
});
