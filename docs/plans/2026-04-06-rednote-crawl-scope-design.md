# REDnote Crawl Scope Design

## Goal

Narrow the REDnote crawler so it searches newest-first, filters search-result cards by visible like count greater than 10, skips posts already stored in SQLite before opening detail pages, and continues opening remaining post details one by one.

## Approach

- Keep the existing newest-first search flow.
- Replace URL-only result collection with structured search-result candidates containing `url`, `noteId`, and `visibleLikeCount`.
- Parse the visible like count from each result card on the search page before any detail navigation.
- Skip candidates early when:
  - the note id is already present in SQLite
  - the result-card like count is missing
  - the result-card like count is `<= 10`
- Continue using detail-page extraction only for candidates that survive those filters.

## Tradeoffs

- Result-card like parsing is faster and matches the requested behavior, but it depends on the current search-card DOM.
- Persistence keeps its duplicate check as a second safety layer even though the crawler now skips known note ids earlier.
- Cards without a parseable like count are excluded to keep the crawl scope narrow and predictable.
