import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium, type BrowserContext, type Page } from "playwright";

import type {
  CrawlerRunSummary,
  ExtractedPost,
  MediaFileRecord,
  StoredPostRecord,
  VisibleComment
} from "../../types.js";
import { writeCommentsSnapshot, writeMediaManifest, toRelativeStoragePath } from "../../storage/files.js";
import type { CrawlerDatabase } from "../../storage/database.js";
import { extractCanonicalUrlFromHtml, extractNoteIdFromUrl, normalizeCount } from "./parser.js";
import { REDNOTE_SELECTORS } from "./selectors.js";

const REDNOTE_HOME_URL = "https://www.xiaohongshu.com/";

interface CrawlTopicOptions {
  topic: string;
  perTopicNewPostLimit: number;
  database: CrawlerDatabase;
  mediaDir: string;
  commentsDir: string;
  projectRoot: string;
  runStartedAt: string;
}

export async function launchPersistentBrowser(profileDir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profileDir, {
    acceptDownloads: true,
    headless: false,
    viewport: { width: 1440, height: 1080 }
  });
}

async function promptForEnter(message: string): Promise<void> {
  const terminal = createInterface({ input, output });
  try {
    await terminal.question(`${message}\nPress Enter after the step is complete.`);
  } finally {
    terminal.close();
  }
}

async function anySelectorExists(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const selector of selectors) {
    try {
      if ((await page.locator(selector).count()) > 0) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

async function firstText(page: Page, selectors: readonly string[]): Promise<string | null> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0) {
        const text = (await locator.textContent())?.trim();
        if (text) {
          return text;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function firstAttribute(page: Page, selectors: readonly string[], name: string): Promise<string | null> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0) {
        const value = await locator.getAttribute(name);
        if (value) {
          return value;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

function buildSearchUrl(topic: string): string {
  return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(topic)}&source=web_explore_feed`;
}

async function sortResultsByNewest(page: Page): Promise<void> {
  for (const selector of REDNOTE_SELECTORS.newestSortTriggers) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0) {
        await locator.click({ timeout: 3_000 });
        await page.waitForTimeout(1_000);
        return;
      }
    } catch {
      continue;
    }
  }
}

async function collectCandidateUrls(page: Page): Promise<string[]> {
  const selector = REDNOTE_SELECTORS.resultAnchors.join(", ");
  const urls = await page.locator(selector).evaluateAll((elements) =>
    elements
      .map((element) => {
        if (element instanceof HTMLAnchorElement) {
          return element.href;
        }

        return element.getAttribute("href");
      })
      .filter((href): href is string => Boolean(href))
  );

  return [...new Set(urls)].filter((href) => extractNoteIdFromUrl(href) !== null);
}

async function collectImageUrls(page: Page): Promise<string[]> {
  const selector = REDNOTE_SELECTORS.imageNodes.join(", ");
  const urls = await page.locator(selector).evaluateAll((elements) =>
    elements
      .map((element) => {
        if (element instanceof HTMLImageElement) {
          return element.currentSrc || element.src;
        }

        return element.getAttribute("src");
      })
      .filter((src): src is string => Boolean(src))
  );

  return [...new Set(urls)].filter((url) => !url.startsWith("data:"));
}

async function collectVisibleComments(page: Page): Promise<VisibleComment[]> {
  const selector = REDNOTE_SELECTORS.commentItems.join(", ");
  const comments = await page.locator(selector).evaluateAll((elements) =>
    elements.slice(0, 100).map((element) => {
      const authorName =
        element.querySelector('[class*="author"]')?.textContent?.trim() ??
        element.querySelector("a")?.textContent?.trim() ??
        "unknown";
      const content =
        element.querySelector('[class*="content"]')?.textContent?.trim() ??
        element.textContent?.trim() ??
        "";
      const publishedAt =
        element.querySelector("time")?.textContent?.trim() ??
        element.querySelector('[class*="time"]')?.textContent?.trim() ??
        null;

      return {
        authorName,
        content,
        publishedAt
      };
    })
  );

  return comments.filter((comment) => comment.content.length > 0);
}

function inferFileExtension(sourceUrl: string, contentType: string | null): string {
  if (contentType?.includes("png")) {
    return ".png";
  }
  if (contentType?.includes("webp")) {
    return ".webp";
  }
  if (contentType?.includes("gif")) {
    return ".gif";
  }

  try {
    const parsedUrl = new URL(sourceUrl);
    const fileExtension = path.extname(parsedUrl.pathname);
    return fileExtension || ".jpg";
  } catch {
    return ".jpg";
  }
}

async function downloadImageAssets(
  page: Page,
  mediaDir: string,
  postId: string,
  imageUrls: string[]
): Promise<MediaFileRecord[]> {
  const postDir = path.join(mediaDir, postId);
  mkdirSync(postDir, { recursive: true });

  const files: MediaFileRecord[] = [];
  for (const [index, sourceUrl] of imageUrls.entries()) {
    try {
      const response = await page.context().request.get(sourceUrl, {
        headers: {
          referer: page.url()
        }
      });

      if (!response.ok()) {
        continue;
      }

      const contentType = response.headers()["content-type"] ?? null;
      const extension = inferFileExtension(sourceUrl, contentType);
      const fileName = `image-${String(index + 1).padStart(2, "0")}${extension}`;
      const targetPath = path.join(postDir, fileName);

      writeFileSync(targetPath, await response.body());

      files.push({
        fileName,
        sourceUrl,
        contentType,
        localPath: targetPath
      });
    } catch {
      continue;
    }
  }

  return files;
}

async function extractPost(page: Page, topic: string): Promise<ExtractedPost> {
  const html = await page.content();
  const canonicalUrl = extractCanonicalUrlFromHtml(html) ?? page.url();
  const postId = extractNoteIdFromUrl(canonicalUrl);

  if (!postId) {
    throw new Error(`Unable to extract REDnote post id from ${canonicalUrl}`);
  }

  const title =
    (await firstAttribute(page, ['meta[property="og:title"]'], "content")) ??
    (await firstText(page, REDNOTE_SELECTORS.title));
  const authorName = (await firstText(page, REDNOTE_SELECTORS.authorName)) ?? "unknown";
  const contentText = await firstText(page, REDNOTE_SELECTORS.contentText);
  const likeCount = normalizeCount(await firstText(page, REDNOTE_SELECTORS.likeCount));
  const commentCount = normalizeCount(await firstText(page, REDNOTE_SELECTORS.commentCount));
  const collectCount = normalizeCount(await firstText(page, REDNOTE_SELECTORS.collectCount));
  const publishedAt = await firstText(page, REDNOTE_SELECTORS.publishedAt);
  const mediaType = (await anySelectorExists(page, REDNOTE_SELECTORS.videoNodes)) ? "video" : "image";
  const imageUrls = mediaType === "image" ? await collectImageUrls(page) : [];
  const comments = await collectVisibleComments(page);

  const record: StoredPostRecord = {
    postId,
    topic,
    url: canonicalUrl,
    authorName,
    authorId: null,
    title,
    contentText,
    likeCount,
    commentCount,
    collectCount,
    publishedAt,
    crawledAt: new Date().toISOString(),
    mediaType,
    mediaManifestPath: null,
    commentsManifestPath: null
  };

  return {
    record,
    imageUrls,
    comments
  };
}

async function persistExtractedPost(
  page: Page,
  extractedPost: ExtractedPost,
  options: CrawlTopicOptions & { summary: CrawlerRunSummary }
): Promise<"stored" | "duplicate"> {
  const { database, mediaDir, commentsDir, projectRoot, runStartedAt, topic, summary } = options;
  const { record, comments, imageUrls } = extractedPost;

  if (database.hasPost(record.postId)) {
    database.logRunEvent(runStartedAt, topic, record.postId, "duplicate_skip", "Post already exists in the database.");
    summary.duplicatePosts += 1;
    return "duplicate";
  }

  const inserted = database.insertPost(record);
  if (!inserted) {
    database.logRunEvent(runStartedAt, topic, record.postId, "duplicate_skip", "Post insert was ignored.");
    summary.duplicatePosts += 1;
    return "duplicate";
  }

  let mediaManifestPath: string | null = null;
  if (record.mediaType === "image" && imageUrls.length > 0) {
    const files = await downloadImageAssets(page, mediaDir, record.postId, imageUrls);
    if (files.length > 0) {
      const writtenPath = writeMediaManifest(mediaDir, record.postId, files);
      mediaManifestPath = toRelativeStoragePath(projectRoot, writtenPath);
      summary.outputPaths.push(mediaManifestPath);
    }
  }

  let commentsManifestPath: string | null = null;
  if (comments.length > 0) {
    const writtenPath = writeCommentsSnapshot(commentsDir, record.postId, comments);
    commentsManifestPath = toRelativeStoragePath(projectRoot, writtenPath);
    summary.outputPaths.push(commentsManifestPath);
  }

  database.updatePostArtifacts(record.postId, mediaManifestPath, commentsManifestPath);
  database.logRunEvent(runStartedAt, topic, record.postId, "stored", "Post saved successfully.");
  summary.storedPosts += 1;

  return "stored";
}

export async function ensureLoggedIn(context: BrowserContext): Promise<void> {
  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto(REDNOTE_HOME_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);

  const authenticated = await anySelectorExists(page, REDNOTE_SELECTORS.authIndicators);
  if (authenticated) {
    return;
  }

  await promptForEnter("Log in to REDnote in the opened browser window.");
  await page.goto(REDNOTE_HOME_URL, { waitUntil: "domcontentloaded" });
}

export async function crawlTopics(context: BrowserContext, options: CrawlTopicOptions[]): Promise<CrawlerRunSummary> {
  const summary: CrawlerRunSummary = {
    topicsProcessed: 0,
    storedPosts: 0,
    duplicatePosts: 0,
    failedPosts: 0,
    outputPaths: []
  };

  for (const option of options) {
    const searchPage = context.pages()[0] ?? (await context.newPage());
    const detailPage = await context.newPage();
    const seenUrls = new Set<string>();

    option.database.logRunEvent(option.runStartedAt, option.topic, null, "topic_start", "Starting topic crawl.");
    await searchPage.goto(buildSearchUrl(option.topic), { waitUntil: "domcontentloaded" });
    await searchPage.waitForTimeout(2_000);
    await sortResultsByNewest(searchPage);

    let storedForTopic = 0;
    let stallCount = 0;

    while (storedForTopic < option.perTopicNewPostLimit && stallCount < 5) {
      const candidateUrls = await collectCandidateUrls(searchPage);
      const unseenUrls = candidateUrls.filter((candidateUrl) => !seenUrls.has(candidateUrl));

      if (unseenUrls.length === 0) {
        stallCount += 1;
      } else {
        stallCount = 0;
      }

      for (const candidateUrl of unseenUrls) {
        seenUrls.add(candidateUrl);

        try {
          await detailPage.goto(candidateUrl, { waitUntil: "domcontentloaded" });
          await detailPage.waitForTimeout(1_500);

          const extractedPost = await extractPost(detailPage, option.topic);
          const status = await persistExtractedPost(detailPage, extractedPost, { ...option, summary });
          if (status === "stored") {
            storedForTopic += 1;
          }

          if (storedForTopic >= option.perTopicNewPostLimit) {
            break;
          }
        } catch (error) {
          option.database.logRunEvent(
            option.runStartedAt,
            option.topic,
            extractNoteIdFromUrl(candidateUrl),
            "failure",
            error instanceof Error ? error.message : "Unknown crawl error."
          );
          summary.failedPosts += 1;
        }
      }

      if (storedForTopic >= option.perTopicNewPostLimit) {
        break;
      }

      await searchPage.mouse.wheel(0, 2_500);
      await searchPage.waitForTimeout(1_500);
    }

    await detailPage.close();
    option.database.logRunEvent(option.runStartedAt, option.topic, null, "topic_complete", `Stored ${storedForTopic} new posts.`);
    summary.topicsProcessed += 1;
  }

  return summary;
}
