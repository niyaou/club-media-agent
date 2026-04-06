export type MediaType = "image" | "video";

export interface CrawlerConfig {
  topics: string[];
  perTopicNewPostLimit: number;
  browserProfileDir: string;
  databasePath: string;
  mediaDir: string;
  commentsDir: string;
}

export interface StorageLayout {
  browserProfileDir: string;
  databasePath: string;
  mediaDir: string;
  commentsDir: string;
}

export interface VisibleComment {
  authorName: string;
  content: string;
  publishedAt: string | null;
}

export interface MediaFileRecord {
  fileName: string;
  sourceUrl: string;
  contentType?: string | null;
  localPath?: string;
}

export interface StoredPostRecord {
  postId: string;
  topic: string;
  url: string;
  authorName: string;
  authorId: string | null;
  title: string | null;
  contentText: string | null;
  likeCount: number | null;
  commentCount: number | null;
  collectCount: number | null;
  publishedAt: string | null;
  crawledAt: string;
  mediaType: MediaType;
  mediaManifestPath: string | null;
  commentsManifestPath: string | null;
}

export interface ExtractedPost {
  record: StoredPostRecord;
  imageUrls: string[];
  comments: VisibleComment[];
}

export interface CrawlerRunSummary {
  topicsProcessed: number;
  storedPosts: number;
  duplicatePosts: number;
  failedPosts: number;
  outputPaths: string[];
}

export type RunEventType =
  | "topic_start"
  | "topic_complete"
  | "stored"
  | "duplicate_skip"
  | "failure";
