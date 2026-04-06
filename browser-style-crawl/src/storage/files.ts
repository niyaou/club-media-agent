import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { MediaFileRecord, StorageLayout, VisibleComment } from "../types.js";

export function ensureStorageLayout(layout: StorageLayout): StorageLayout {
  mkdirSync(layout.browserProfileDir, { recursive: true });
  mkdirSync(path.dirname(layout.databasePath), { recursive: true });
  mkdirSync(layout.mediaDir, { recursive: true });
  mkdirSync(layout.commentsDir, { recursive: true });
  return layout;
}

export function writeCommentsSnapshot(commentsDir: string, postId: string, comments: VisibleComment[]): string {
  const targetPath = path.join(commentsDir, `${postId}.json`);
  writeFileSync(targetPath, JSON.stringify(comments, null, 2));
  return targetPath;
}

export function writeMediaManifest(mediaDir: string, postId: string, files: MediaFileRecord[]): string {
  const postDir = path.join(mediaDir, postId);
  mkdirSync(postDir, { recursive: true });

  const targetPath = path.join(postDir, "manifest.json");
  writeFileSync(
    targetPath,
    JSON.stringify(
      {
        postId,
        files
      },
      null,
      2
    )
  );

  return targetPath;
}

export function toRelativeStoragePath(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath);
}
