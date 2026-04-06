import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium, type BrowserContext, type Page } from "playwright";

import type {
  CrawlerRunSummary,
  ExtractedPost,
  MediaFileRecord,
  SearchResultCandidate,
  StoredPostRecord,
  VisibleComment
} from "../../types.js";
import { writeCommentsSnapshot, writeMediaManifest, toRelativeStoragePath } from "../../storage/files.js";
import type { CrawlerDatabase } from "../../storage/database.js";
import { extractCanonicalUrlFromHtml, extractNoteIdFromUrl, normalizeCount } from "./parser.js";
import { waitForPageStability, withNavigationRetry } from "./page-stability.js";
import { REDNOTE_SELECTORS } from "./selectors.js";

const REDNOTE_HOME_URL = "https://www.xiaohongshu.com/";
const PERSISTENT_BROWSER_OPTIONS = {
  acceptDownloads: true,
  headless: false,
  viewport: { width: 1440, height: 1080 }
};
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const LOGIN_POLL_INTERVAL_MS = 1_000;
const CLOSED_TARGET_MESSAGE = "Target page, context or browser has been closed";
const MIN_SEARCH_RESULT_LIKE_COUNT = 10;

interface CrawlTopicOptions {
  topic: string;
  perTopicNewPostLimit: number;
  database: CrawlerDatabase;
  mediaDir: string;
  commentsDir: string;
  projectRoot: string;
  runStartedAt: string;
}

interface LoginWaitOptions {
  loginTimeoutMs?: number;
  loginPollIntervalMs?: number;
}

export async function launchPersistentBrowser(profileDir: string): Promise<BrowserContext> {
  try {
    return await chromium.launchPersistentContext(profileDir, {
      ...PERSISTENT_BROWSER_OPTIONS,
      channel: "chrome"
    });
  } catch (error) {
    console.warn(
      `Chrome launch failed, falling back to bundled Chromium: ${error instanceof Error ? error.message : String(error)}`
    );

    return chromium.launchPersistentContext(profileDir, PERSISTENT_BROWSER_OPTIONS);
  }
}

function isRednotePage(page: Page): boolean {
  return page.url().includes("xiaohongshu.com");
}

async function getPrimaryRednotePage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  const primaryPage = pages.find((page) => isRednotePage(page)) ?? pages[0] ?? (await context.newPage());

  for (const page of pages) {
    if (page === primaryPage || page.isClosed() || page.url() !== "about:blank") {
      continue;
    }

    await page.close().catch(() => {});
  }

  await primaryPage.bringToFront().catch(() => {});
  return primaryPage;
}

async function waitForAuthentication(page: Page, timeoutMs: number, pollIntervalMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isAuthenticated(page)) {
      return;
    }

    if (page.isClosed()) {
      throw new Error("REDnote browser window was closed before login completed.");
    }

    await page.waitForTimeout(pollIntervalMs);
  }

  throw new Error("REDnote login was not detected before the timeout expired.");
}

async function isAuthenticated(page: Page): Promise<boolean> {
  const pageUrl = page.url();
  if (pageUrl.includes("/website-login/") || pageUrl.includes("/login")) {
    return false;
  }

  const loginVisible = await anySelectorExists(page, REDNOTE_SELECTORS.loginIndicators);
  if (loginVisible) {
    return false;
  }

  return anySelectorExists(page, REDNOTE_SELECTORS.authIndicators);
}

function isClosedTargetError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(CLOSED_TARGET_MESSAGE);
}

function isBrowserConnected(context: BrowserContext): boolean {
  return context.browser()?.isConnected() ?? true;
}

export async function openCandidateInDetailPage(
  context: BrowserContext,
  detailPage: Page | null,
  candidateUrl: string
): Promise<Page> {
  let currentPage = detailPage;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!currentPage || currentPage.isClosed()) {
      if (!isBrowserConnected(context)) {
        throw new Error("REDnote browser was disconnected during crawl.");
      }

      currentPage = await context.newPage();
    }

    try {
      await currentPage.goto(candidateUrl, { waitUntil: "domcontentloaded" });
      await waitForPageStability(currentPage);
      return currentPage;
    } catch (error) {
      if (!isClosedTargetError(error)) {
        throw error;
      }

      if (!isBrowserConnected(context)) {
        throw new Error("REDnote browser was disconnected during crawl.");
      }

      currentPage = null;
    }
  }

  throw new Error(`REDnote detail page closed while opening ${candidateUrl}`);
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

export function parseVisibleLikeCount(value: string | null | undefined): number | null {
  return normalizeCount(value);
}

export function filterSearchResultCandidates(
  candidates: SearchResultCandidate[],
  database: CrawlerDatabase,
  minLikeCount = MIN_SEARCH_RESULT_LIKE_COUNT
): SearchResultCandidate[] {
  return candidates.filter(
    (candidate) => candidate.visibleLikeCount !== null && candidate.visibleLikeCount > minLikeCount && !database.hasPost(candidate.noteId)
  );
}

function isPreferredSearchResultUrl(url: string): boolean {
  return url.includes("/search_result/") || url.includes("xsec_token=");
}

export function dedupeSearchResultCandidates(candidates: SearchResultCandidate[]): SearchResultCandidate[] {
  const dedupedCandidates = new Map<string, SearchResultCandidate>();

  for (const candidate of candidates) {
    const existing = dedupedCandidates.get(candidate.noteId);
    if (!existing) {
      dedupedCandidates.set(candidate.noteId, candidate);
      continue;
    }

    if (isPreferredSearchResultUrl(candidate.url) && !isPreferredSearchResultUrl(existing.url)) {
      dedupedCandidates.set(candidate.noteId, candidate);
    }
  }

  return [...dedupedCandidates.values()];
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

async function collectSearchResultCandidates(page: Page): Promise<SearchResultCandidate[]> {
  const selector = REDNOTE_SELECTORS.resultAnchors.join(", ");
  const rawCandidates = await withNavigationRetry(
    () =>
      page.locator(selector).evaluateAll((elements, likeSelectors) =>
        elements
          .map((element) => {
            const anchor =
              element instanceof HTMLAnchorElement
                ? element
                : element.closest('a[href*="/search_result/"], a[href*="/explore/"], a[href*="/discovery/item/"]');

            if (!(anchor instanceof HTMLAnchorElement)) {
              return null;
            }

            const style = window.getComputedStyle(anchor);
            if (style.display === "none" || style.visibility === "hidden") {
              return null;
            }

            let rawLikeText: string | null = null;
            let container: Element | null = anchor;

            for (let depth = 0; depth < 4 && container && !rawLikeText; depth += 1) {
              for (const likeSelector of likeSelectors) {
                const match = container.querySelector(likeSelector);
                const text = match?.textContent?.trim();
                if (text) {
                  rawLikeText = text;
                  break;
                }
              }

              container = container.parentElement;
            }

            return {
              url: anchor.href,
              rawLikeText
            };
          })
          .filter((candidate): candidate is { url: string; rawLikeText: string | null } => Boolean(candidate?.url)),
        REDNOTE_SELECTORS.searchResultLikeCounts
      ),
    () => waitForPageStability(page)
  );
  const candidates: SearchResultCandidate[] = [];

  for (const candidate of rawCandidates) {
    const noteId = extractNoteIdFromUrl(candidate.url);
    if (!noteId) {
      continue;
    }

    candidates.push({
      url: candidate.url,
      noteId,
      visibleLikeCount: parseVisibleLikeCount(candidate.rawLikeText)
    });
  }

  return dedupeSearchResultCandidates(candidates);
}

async function collectImageUrls(page: Page): Promise<string[]> {
  const selector = REDNOTE_SELECTORS.imageNodes.join(", ");
  const urls = await withNavigationRetry(
    () =>
      page.locator(selector).evaluateAll((elements) =>
        elements
          .map((element) => {
            if (element instanceof HTMLImageElement) {
              return element.currentSrc || element.src;
            }

            return element.getAttribute("src");
          })
          .filter((src): src is string => Boolean(src))
      ),
    () => waitForPageStability(page)
  );

  return [...new Set(urls)].filter((url) => !url.startsWith("data:"));
}

async function collectVisibleComments(page: Page): Promise<VisibleComment[]> {
  const selector = REDNOTE_SELECTORS.commentItems.join(", ");
  const comments = await withNavigationRetry(
    () =>
      page.locator(selector).evaluateAll((elements) =>
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
      ),
    () => waitForPageStability(page)
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

export async function ensureLoggedIn(context: BrowserContext, options: LoginWaitOptions = {}): Promise<void> {
  const loginTimeoutMs = options.loginTimeoutMs ?? LOGIN_TIMEOUT_MS;
  const loginPollIntervalMs = options.loginPollIntervalMs ?? LOGIN_POLL_INTERVAL_MS;
  const page = await getPrimaryRednotePage(context);

  await page.goto(REDNOTE_HOME_URL, { waitUntil: "domcontentloaded" });
  await waitForPageStability(page);
  await page.bringToFront().catch(() => {});

  const authenticated = await isAuthenticated(page);
  if (authenticated) {
    return;
  }

  console.log("Log in to REDnote in the opened browser window. Waiting for the account avatar to appear...");
  await waitForAuthentication(page, loginTimeoutMs, loginPollIntervalMs);
  await page.goto(REDNOTE_HOME_URL, { waitUntil: "domcontentloaded" });
  await waitForPageStability(page);
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
    const searchPage = await getPrimaryRednotePage(context);
    let detailPage: Page | null = null;
    const seenUrls = new Set<string>();
    let abortTopic = false;

    option.database.logRunEvent(option.runStartedAt, option.topic, null, "topic_start", "Starting topic crawl.");
    await searchPage.goto(buildSearchUrl(option.topic), { waitUntil: "domcontentloaded" });
    await waitForPageStability(searchPage);
    await sortResultsByNewest(searchPage);
    await waitForPageStability(searchPage);

    let storedForTopic = 0;
    let stallCount = 0;

    while (storedForTopic < option.perTopicNewPostLimit && stallCount < 5) {
      const searchCandidates = await collectSearchResultCandidates(searchPage);
      const unseenCandidates = searchCandidates.filter((candidate) => !seenUrls.has(candidate.url));

      for (const candidate of unseenCandidates) {
        seenUrls.add(candidate.url);
        if (option.database.hasPost(candidate.noteId)) {
          option.database.logRunEvent(
            option.runStartedAt,
            option.topic,
            candidate.noteId,
            "duplicate_skip",
            "Post already exists in the database."
          );
          summary.duplicatePosts += 1;
        }
      }

      const eligibleCandidates = filterSearchResultCandidates(unseenCandidates, option.database);

      if (eligibleCandidates.length === 0) {
        stallCount += 1;
      } else {
        stallCount = 0;
      }

      for (const candidate of eligibleCandidates) {
        const candidateUrl = candidate.url;

        try {
          detailPage = await openCandidateInDetailPage(context, detailPage, candidateUrl);

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

          if (!isBrowserConnected(context)) {
            abortTopic = true;
            break;
          }

          if (detailPage?.isClosed()) {
            detailPage = null;
          }
        }
      }

      if (storedForTopic >= option.perTopicNewPostLimit || abortTopic) {
        break;
      }

      await searchPage.mouse.wheel(0, 2_500);
      await waitForPageStability(searchPage);
    }

    if (detailPage) {
      await detailPage.close();
    }
    option.database.logRunEvent(option.runStartedAt, option.topic, null, "topic_complete", `Stored ${storedForTopic} new posts.`);
    summary.topicsProcessed += 1;
  }

  return summary;
}
