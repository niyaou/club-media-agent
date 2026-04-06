import { describe, expect, it } from "vitest";

import { dedupeSearchResultCandidates, filterSearchResultCandidates, parseVisibleLikeCount } from "../src/site/rednote/client.js";
import type { SearchResultCandidate } from "../src/types.js";
import type { CrawlerDatabase } from "../src/storage/database.js";

function createDatabase(existingPostIds: string[]): CrawlerDatabase {
  const ids = new Set(existingPostIds);

  return {
    hasPost(postId: string): boolean {
      return ids.has(postId);
    },
    insertPost: () => false,
    updatePostArtifacts: () => {},
    logRunEvent: () => {},
    listPosts: () => [],
    close: () => {}
  };
}

describe("search result candidate filtering", () => {
  it("parses visible like counts from result-card text", () => {
    expect(parseVisibleLikeCount("11")).toBe(11);
    expect(parseVisibleLikeCount("1.2万")).toBe(12000);
    expect(parseVisibleLikeCount(null)).toBeNull();
  });

  it("keeps only candidates above the visible like threshold", () => {
    const database = createDatabase([]);
    const candidates: SearchResultCandidate[] = [
      {
        url: "https://www.xiaohongshu.com/explore/aaa",
        noteId: "aaa",
        visibleLikeCount: 9
      },
      {
        url: "https://www.xiaohongshu.com/explore/bbb",
        noteId: "bbb",
        visibleLikeCount: 11
      },
      {
        url: "https://www.xiaohongshu.com/explore/ccc",
        noteId: "ccc",
        visibleLikeCount: null
      }
    ];

    expect(filterSearchResultCandidates(candidates, database)).toEqual([
      {
        url: "https://www.xiaohongshu.com/explore/bbb",
        noteId: "bbb",
        visibleLikeCount: 11
      }
    ]);
  });

  it("skips candidates that already exist in sqlite before opening detail pages", () => {
    const database = createDatabase(["bbb"]);
    const candidates: SearchResultCandidate[] = [
      {
        url: "https://www.xiaohongshu.com/explore/aaa",
        noteId: "aaa",
        visibleLikeCount: 55
      },
      {
        url: "https://www.xiaohongshu.com/explore/bbb",
        noteId: "bbb",
        visibleLikeCount: 88
      }
    ];

    expect(filterSearchResultCandidates(candidates, database)).toEqual([
      {
        url: "https://www.xiaohongshu.com/explore/aaa",
        noteId: "aaa",
        visibleLikeCount: 55
      }
    ]);
  });

  it("prefers tokenized search_result urls over hidden raw explore urls", () => {
    const candidates: SearchResultCandidate[] = [
      {
        url: "https://www.xiaohongshu.com/explore/aaa",
        noteId: "aaa",
        visibleLikeCount: 55
      },
      {
        url: "https://www.xiaohongshu.com/search_result/aaa?xsec_token=token&xsec_source=",
        noteId: "aaa",
        visibleLikeCount: 55
      }
    ];

    expect(dedupeSearchResultCandidates(candidates)).toEqual([
      {
        url: "https://www.xiaohongshu.com/search_result/aaa?xsec_token=token&xsec_source=",
        noteId: "aaa",
        visibleLikeCount: 55
      }
    ]);
  });
});
