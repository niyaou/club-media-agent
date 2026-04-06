import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  extractCanonicalUrlFromHtml,
  extractLikeCount,
  extractNoteIdFromUrl
} from "../src/site/rednote/parser.js";

const fixturePath = path.resolve("tests/fixtures/rednote-post.html");

describe("REDnote parser helpers", () => {
  it("extracts a note id from supported urls", () => {
    expect(extractNoteIdFromUrl("https://www.xiaohongshu.com/explore/66cafe1234567890abcd123?xsec_token=abc")).toBe(
      "66cafe1234567890abcd123"
    );
    expect(extractNoteIdFromUrl("https://www.xiaohongshu.com/discovery/item/66cafe1234567890abcd123")).toBe(
      "66cafe1234567890abcd123"
    );
  });

  it("returns null when a url does not contain a note id", () => {
    expect(extractNoteIdFromUrl("https://www.xiaohongshu.com/user/profile/123")).toBeNull();
  });

  it("reads canonical url and engagement counts from html fixtures", () => {
    const html = readFileSync(fixturePath, "utf8");

    expect(extractCanonicalUrlFromHtml(html)).toBe("https://www.xiaohongshu.com/explore/66cafe1234567890abcd123");
    expect(extractLikeCount(html)).toBe(1200);
  });
});
