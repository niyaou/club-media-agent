import Database from "better-sqlite3";

import type { RunEventType, StoredPostRecord } from "../types.js";

export interface CrawlerDatabase {
  hasPost(postId: string): boolean;
  insertPost(post: StoredPostRecord): boolean;
  updatePostArtifacts(postId: string, mediaManifestPath: string | null, commentsManifestPath: string | null): void;
  logRunEvent(runStartedAt: string, topic: string, postId: string | null, eventType: RunEventType, message: string): void;
  listPosts(): Array<Record<string, unknown>>;
  close(): void;
}

function ensureSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      post_id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      url TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_id TEXT,
      title TEXT,
      content_text TEXT,
      like_count INTEGER,
      comment_count INTEGER,
      collect_count INTEGER,
      published_at TEXT,
      crawled_at TEXT NOT NULL,
      media_type TEXT NOT NULL,
      media_manifest_path TEXT,
      comments_manifest_path TEXT
    );

    CREATE TABLE IF NOT EXISTS run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_started_at TEXT NOT NULL,
      topic TEXT NOT NULL,
      post_id TEXT,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL
    );
  `);
}

export function openCrawlerDatabase(databasePath: string): CrawlerDatabase {
  const database = new Database(databasePath);
  ensureSchema(database);

  const hasPostStatement = database.prepare("SELECT 1 FROM posts WHERE post_id = ?");
  const insertStatement = database.prepare(`
    INSERT OR IGNORE INTO posts (
      post_id, topic, url, author_name, author_id, title, content_text,
      like_count, comment_count, collect_count, published_at, crawled_at,
      media_type, media_manifest_path, comments_manifest_path
    ) VALUES (
      @postId, @topic, @url, @authorName, @authorId, @title, @contentText,
      @likeCount, @commentCount, @collectCount, @publishedAt, @crawledAt,
      @mediaType, @mediaManifestPath, @commentsManifestPath
    )
  `);
  const updateArtifactsStatement = database.prepare(`
    UPDATE posts
    SET media_manifest_path = ?, comments_manifest_path = ?
    WHERE post_id = ?
  `);
  const insertRunEventStatement = database.prepare(`
    INSERT INTO run_events (run_started_at, topic, post_id, event_type, message)
    VALUES (?, ?, ?, ?, ?)
  `);
  const listPostsStatement = database.prepare("SELECT * FROM posts ORDER BY rowid ASC");

  return {
    hasPost(postId: string): boolean {
      return Boolean(hasPostStatement.get(postId));
    },

    insertPost(post: StoredPostRecord): boolean {
      const result = insertStatement.run(post);
      return result.changes > 0;
    },

    updatePostArtifacts(postId: string, mediaManifestPath: string | null, commentsManifestPath: string | null): void {
      updateArtifactsStatement.run(mediaManifestPath, commentsManifestPath, postId);
    },

    logRunEvent(runStartedAt: string, topic: string, postId: string | null, eventType: RunEventType, message: string): void {
      insertRunEventStatement.run(runStartedAt, topic, postId, eventType, message);
    },

    listPosts(): Array<Record<string, unknown>> {
      return listPostsStatement.all() as Array<Record<string, unknown>>;
    },

    close(): void {
      database.close();
    }
  };
}
