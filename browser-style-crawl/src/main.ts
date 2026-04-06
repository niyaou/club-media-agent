import path from "node:path";

import { initializeCrawlerRuntime } from "./app/bootstrap.js";
import { loadCrawlerConfig } from "./config.js";
import { crawlTopics, ensureLoggedIn, launchPersistentBrowser } from "./site/rednote/client.js";

function getConfigPathFromArgs(args: string[]): string {
  const configFlagIndex = args.findIndex((argument) => argument === "--config");
  if (configFlagIndex >= 0 && args[configFlagIndex + 1]) {
    return path.resolve(args[configFlagIndex + 1]);
  }

  return path.resolve("config/topics.json");
}

async function main(): Promise<void> {
  const configPath = getConfigPathFromArgs(process.argv.slice(2));
  const config = loadCrawlerConfig(configPath);
  const runtime = initializeCrawlerRuntime(config);
  const projectRoot = process.cwd();
  const runStartedAt = new Date().toISOString();

  const context = await launchPersistentBrowser(runtime.storage.browserProfileDir);

  try {
    await ensureLoggedIn(context);

    const summary = await crawlTopics(
      context,
      config.topics.map((topic) => ({
        topic,
        perTopicNewPostLimit: config.perTopicNewPostLimit,
        database: runtime.database,
        mediaDir: runtime.storage.mediaDir,
        commentsDir: runtime.storage.commentsDir,
        projectRoot,
        runStartedAt
      }))
    );

    console.log("REDnote crawl summary");
    console.log(`Topics processed: ${summary.topicsProcessed}`);
    console.log(`Stored posts: ${summary.storedPosts}`);
    console.log(`Duplicate posts: ${summary.duplicatePosts}`);
    console.log(`Failed posts: ${summary.failedPosts}`);
    console.log("Output paths:");
    for (const outputPath of summary.outputPaths) {
      console.log(`- ${outputPath}`);
    }
  } finally {
    runtime.database.close();
    await context.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
