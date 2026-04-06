import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openCrawlerDatabase } from "../src/storage/database.js";
import type { StoredPostRecord } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function createPost(postId: string): StoredPostRecord {
  return {
    postId,
    topic: "coffee",
    url: `https://www.xiaohongshu.com/explore/${postId}`,
    authorName: "Author",
    authorId: "author-1",
    title: "Great coffee",
    contentText: "Body",
    likeCount: 12,
    commentCount: 4,
    collectCount: 2,
    publishedAt: "2026-04-06T10:00:00.000Z",
    crawledAt: "2026-04-06T11:00:00.000Z",
    mediaType: "image",
    mediaManifestPath: null,
    commentsManifestPath: null
  };
}

describe("openCrawlerDatabase", () => {
  it("creates schema and skips duplicate posts by post id", () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), "crawler-db-"));
    tempDirs.push(baseDir);

    const database = openCrawlerDatabase(path.join(baseDir, "crawler.db"));
    const post = createPost("66cafe1234567890abcd123");

    expect(database.hasPost(post.postId)).toBe(false);
    expect(database.insertPost(post)).toBe(true);
    expect(database.hasPost(post.postId)).toBe(true);
    expect(database.insertPost(post)).toBe(false);
    expect(database.listPosts()).toHaveLength(1);
  });

  it("updates manifest paths after files are written", () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), "crawler-db-"));
    tempDirs.push(baseDir);

    const database = openCrawlerDatabase(path.join(baseDir, "crawler.db"));
    const post = createPost("66cafe1234567890abcd999");

    database.insertPost(post);
    database.updatePostArtifacts(post.postId, "storage/media/66cafe/manifest.json", "storage/comments/66cafe.json");

    const saved = database.listPosts()[0];
    expect(saved.media_manifest_path).toBe("storage/media/66cafe/manifest.json");
    expect(saved.comments_manifest_path).toBe("storage/comments/66cafe.json");
  });
});
