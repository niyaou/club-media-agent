import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import type { CrawlerConfig } from "./types.js";

const crawlerConfigSchema = z.object({
  topics: z.array(z.string().trim().min(1)).min(1, "topics must contain at least one topic"),
  perTopicNewPostLimit: z.number().int().positive(),
  browserProfileDir: z.string().min(1),
  databasePath: z.string().min(1),
  mediaDir: z.string().min(1),
  commentsDir: z.string().min(1)
});

function inferProjectRoot(configFilePath: string): string {
  const configDir = path.dirname(configFilePath);
  return path.basename(configDir) === "config" ? path.resolve(configDir, "..") : configDir;
}

function resolveConfigPath(configFilePath: string, candidate: string): string {
  if (path.isAbsolute(candidate)) {
    return candidate;
  }

  return path.resolve(inferProjectRoot(configFilePath), candidate);
}

export function parseCrawlerConfig(input: unknown, configFilePath: string): CrawlerConfig {
  const parsed = crawlerConfigSchema.parse(input);

  return {
    topics: parsed.topics,
    perTopicNewPostLimit: parsed.perTopicNewPostLimit,
    browserProfileDir: resolveConfigPath(configFilePath, parsed.browserProfileDir),
    databasePath: resolveConfigPath(configFilePath, parsed.databasePath),
    mediaDir: resolveConfigPath(configFilePath, parsed.mediaDir),
    commentsDir: resolveConfigPath(configFilePath, parsed.commentsDir)
  };
}

export function loadCrawlerConfig(configFilePath: string): CrawlerConfig {
  const raw = JSON.parse(readFileSync(configFilePath, "utf8")) as unknown;
  return parseCrawlerConfig(raw, configFilePath);
}
