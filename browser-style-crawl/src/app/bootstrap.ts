import type { CrawlerConfig } from "../types.js";
import { openCrawlerDatabase } from "../storage/database.js";
import { ensureStorageLayout } from "../storage/files.js";

export function initializeCrawlerRuntime(config: CrawlerConfig) {
  const storage = ensureStorageLayout({
    browserProfileDir: config.browserProfileDir,
    databasePath: config.databasePath,
    mediaDir: config.mediaDir,
    commentsDir: config.commentsDir
  });

  const database = openCrawlerDatabase(storage.databasePath);

  return {
    config,
    storage,
    database
  };
}
