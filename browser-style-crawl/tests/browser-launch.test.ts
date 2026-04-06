import { beforeEach, describe, expect, it, vi } from "vitest";

const launchPersistentContext = vi.fn();

vi.mock("playwright", () => ({
  chromium: {
    launchPersistentContext
  }
}));

describe("launchPersistentBrowser", () => {
  beforeEach(() => {
    vi.resetModules();
    launchPersistentContext.mockReset();
  });

  it("prefers Playwright's chrome channel over a raw executable path", async () => {
    launchPersistentContext.mockResolvedValue({ close: vi.fn() });

    const { launchPersistentBrowser } = await import("../src/site/rednote/client.js");

    await launchPersistentBrowser("/tmp/browser-profile");

    expect(launchPersistentContext).toHaveBeenCalledTimes(1);

    const [profileDir, options] = launchPersistentContext.mock.calls[0]!;
    expect(profileDir).toBe("/tmp/browser-profile");
    expect(options).toMatchObject({
      acceptDownloads: true,
      headless: false,
      viewport: { width: 1440, height: 1080 },
      channel: "chrome"
    });
    expect(options).not.toHaveProperty("executablePath");
  });

  it("falls back to bundled Chromium if the Chrome channel cannot be launched", async () => {
    launchPersistentContext
      .mockRejectedValueOnce(new Error("chrome crashed during startup"))
      .mockResolvedValueOnce({ close: vi.fn() });

    const { launchPersistentBrowser } = await import("../src/site/rednote/client.js");

    await launchPersistentBrowser("/tmp/browser-profile");

    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
    expect(launchPersistentContext.mock.calls[0]?.[1]).toMatchObject({ channel: "chrome" });
    expect(launchPersistentContext.mock.calls[1]?.[1]).toMatchObject({
      acceptDownloads: true,
      headless: false,
      viewport: { width: 1440, height: 1080 }
    });
    expect(launchPersistentContext.mock.calls[1]?.[1]).not.toHaveProperty("channel");
    expect(launchPersistentContext.mock.calls[1]?.[1]).not.toHaveProperty("executablePath");
  });
});
