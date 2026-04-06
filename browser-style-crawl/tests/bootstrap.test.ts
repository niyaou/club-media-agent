import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { initializeCrawlerRuntime } from "../src/app/bootstrap.js";
import type { CrawlerConfig } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("initializeCrawlerRuntime", () => {
  it("prepares storage paths and a ready sqlite connection without launching a browser", () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), "crawler-bootstrap-"));
    tempDirs.push(baseDir);

    const config: CrawlerConfig = {
      topics: ["coffee"],
      perTopicNewPostLimit: 2,
      browserProfileDir: path.join(baseDir, "browser-profile"),
      databasePath: path.join(baseDir, "sqlite", "crawler.db"),
      mediaDir: path.join(baseDir, "media"),
      commentsDir: path.join(baseDir, "comments")
    };

    const runtime = initializeCrawlerRuntime(config);

    expect(runtime.storage.databasePath).toBe(config.databasePath);
    expect(runtime.database.listPosts()).toEqual([]);
  });
});
