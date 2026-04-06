const NOTE_URL_PATTERNS = [
  /\/explore\/([a-zA-Z0-9]+)/,
  /\/discovery\/item\/([a-zA-Z0-9]+)/,
  /\/search_result\/([a-zA-Z0-9]+)/
];

export function extractNoteIdFromUrl(url: string): string | null {
  try {
    const parsedUrl = new URL(url);

    for (const pattern of NOTE_URL_PATTERNS) {
      const match = parsedUrl.pathname.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return parsedUrl.searchParams.get("noteId");
  } catch {
    return null;
  }
}

export function extractCanonicalUrlFromHtml(html: string): string | null {
  const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  if (canonicalMatch) {
    return canonicalMatch[1];
  }

  const openGraphMatch = html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i);
  return openGraphMatch ? openGraphMatch[1] : null;
}

export function normalizeCount(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/,/g, "").trim().toLowerCase();
  const match = normalized.match(/(\d+(?:\.\d+)?)(\s*[kw]|万)?/);
  if (!match) {
    return null;
  }

  const base = Number.parseFloat(match[1]);
  if (Number.isNaN(base)) {
    return null;
  }

  const suffix = (match[2] ?? "").trim();
  if (suffix === "k") {
    return Math.round(base * 1_000);
  }

  if (suffix === "w" || suffix === "万") {
    return Math.round(base * 10_000);
  }

  return Math.round(base);
}

export function extractLikeCount(html: string): number | null {
  const match = html.match(/>([^<]*?(?:likes?|赞)[^<]*)</i);
  return normalizeCount(match?.[1]);
}
