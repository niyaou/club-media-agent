import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseCrawlerConfig } from "../src/config.js";

describe("parseCrawlerConfig", () => {
  it("accepts a valid config and resolves project-local paths", () => {
    const config = parseCrawlerConfig(
      {
        topics: ["coffee", "nightlife"],
        perTopicNewPostLimit: 3,
        browserProfileDir: "./storage/browser-profile",
        databasePath: "./storage/sqlite/crawler.db",
        mediaDir: "./storage/media",
        commentsDir: "./storage/comments"
      },
      "/tmp/rednote/config/topics.json"
    );

    expect(config.topics).toEqual(["coffee", "nightlife"]);
    expect(config.perTopicNewPostLimit).toBe(3);
    expect(config.browserProfileDir).toBe(path.resolve("/tmp/rednote", "./storage/browser-profile"));
    expect(config.databasePath).toBe(path.resolve("/tmp/rednote", "./storage/sqlite/crawler.db"));
  });

  it("rejects an empty topic list", () => {
    expect(() =>
      parseCrawlerConfig(
        {
          topics: [],
          perTopicNewPostLimit: 1,
          browserProfileDir: "./storage/browser-profile",
          databasePath: "./storage/sqlite/crawler.db",
          mediaDir: "./storage/media",
          commentsDir: "./storage/comments"
        },
        "/tmp/rednote/config/topics.json"
      )
    ).toThrow(/topics/i);
  });
});
