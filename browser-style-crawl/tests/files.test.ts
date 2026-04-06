import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ensureStorageLayout, writeCommentsSnapshot, writeMediaManifest } from "../src/storage/files.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("storage files", () => {
  it("creates required directories and writes comment snapshots", () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), "crawler-files-"));
    tempDirs.push(baseDir);

    const layout = ensureStorageLayout({
      browserProfileDir: path.join(baseDir, "browser-profile"),
      databasePath: path.join(baseDir, "sqlite", "crawler.db"),
      mediaDir: path.join(baseDir, "media"),
      commentsDir: path.join(baseDir, "comments")
    });

    const commentsPath = writeCommentsSnapshot(layout.commentsDir, "note-1", [
      { authorName: "Alice", content: "Looks good", publishedAt: "2026-04-06T10:00:00.000Z" }
    ]);

    const saved = JSON.parse(readFileSync(commentsPath, "utf8"));
    expect(saved).toEqual([
      { authorName: "Alice", content: "Looks good", publishedAt: "2026-04-06T10:00:00.000Z" }
    ]);
  });

  it("writes a manifest file for downloaded media", () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), "crawler-files-"));
    tempDirs.push(baseDir);

    const mediaDir = path.join(baseDir, "media");
    ensureStorageLayout({
      browserProfileDir: path.join(baseDir, "browser-profile"),
      databasePath: path.join(baseDir, "sqlite", "crawler.db"),
      mediaDir,
      commentsDir: path.join(baseDir, "comments")
    });

    const manifestPath = writeMediaManifest(mediaDir, "note-2", [
      { fileName: "image-1.jpg", sourceUrl: "https://cdn.example.com/image-1.jpg" }
    ]);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.postId).toBe("note-2");
    expect(manifest.files[0].fileName).toBe("image-1.jpg");
  });
});
