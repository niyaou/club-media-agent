import { describe, expect, it, vi } from "vitest";

import { openCandidateInDetailPage } from "../src/site/rednote/client.js";

function createDetailPage(options: { failOnWait?: boolean } = {}) {
  let closed = false;

  return {
    goto: vi.fn(async () => {}),
    waitForLoadState: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {
      if (options.failOnWait) {
        closed = true;
        throw new Error("page.waitForTimeout: Target page, context or browser has been closed");
      }
    }),
    isClosed: vi.fn(() => closed)
  };
}

describe("openCandidateInDetailPage", () => {
  it("recreates the detail page and retries when the first page closes during stabilization", async () => {
    const firstPage = createDetailPage({ failOnWait: true });
    const secondPage = createDetailPage();
    const context = {
      newPage: vi
        .fn()
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage),
      browser: vi.fn(() => ({
        isConnected: () => true
      }))
    };

    const page = await openCandidateInDetailPage(
      context as never,
      null,
      "https://www.xiaohongshu.com/explore/abc"
    );

    expect(context.newPage).toHaveBeenCalledTimes(2);
    expect(firstPage.goto).toHaveBeenCalledTimes(1);
    expect(secondPage.goto).toHaveBeenCalledTimes(1);
    expect(page).toBe(secondPage);
  });
});
