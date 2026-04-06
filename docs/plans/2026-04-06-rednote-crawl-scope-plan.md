# REDnote Crawl Scope Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Narrow REDnote crawling to newest-first search results with visible like count greater than 10, skipping already-known note ids before opening detail pages.

**Architecture:** Extract structured search-result candidates from the search page, filter them before detail navigation, and keep detail-page extraction unchanged for eligible posts. Persistence remains the fallback duplicate guard.

**Tech Stack:** TypeScript, Playwright, Vitest, better-sqlite3

---

### Task 1: Add failing tests for search-result filtering

**Files:**
- Create: `browser-style-crawl/tests/search-result-candidates.test.ts`
- Modify: `browser-style-crawl/src/site/rednote/client.ts`

**Step 1: Write the failing test**

- Add tests for:
  - parsing a visible like count from search-card text
  - skipping cards with likes `<= 10`
  - skipping cards already present in SQLite before detail navigation

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/search-result-candidates.test.ts`

**Step 3: Write minimal implementation**

- Add structured search-result candidate collection and pre-detail filtering helpers.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/search-result-candidates.test.ts`

### Task 2: Wire candidate filtering into the crawl loop

**Files:**
- Modify: `browser-style-crawl/src/site/rednote/client.ts`

**Step 1: Write the failing test**

- Add a crawl-loop level test or helper test proving only eligible candidates reach detail-page navigation.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/search-result-candidates.test.ts`

**Step 3: Write minimal implementation**

- Apply newest-first candidate filtering before opening detail pages.
- Log duplicate skips for already-known note ids.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/search-result-candidates.test.ts`

### Task 3: Run verification

**Files:**
- Modify: `browser-style-crawl/src/site/rednote/client.ts`
- Create: `browser-style-crawl/tests/search-result-candidates.test.ts`

**Step 1: Run focused tests**

Run: `npm test -- tests/search-result-candidates.test.ts tests/browser-detail-page.test.ts`

**Step 2: Run full test suite**

Run: `npm test`

**Step 3: Run typecheck**

Run: `npm run check`
