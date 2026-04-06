# Browser-Style Crawl

This folder owns the REDnote/Xiaohongshu browser-driven crawler.

Scope:

- browser-driven navigation
- manual login with a persistent browser profile
- newest-first topic search
- post extraction, deduplication, and local persistence
- task-specific configs, tests, and implementation files for this section

Constraints:

- keep this folder self-contained
- avoid relying on shared subfolders outside this section unless there is a clear cross-task requirement

## Runtime

- `npm install`
- `npm run crawl -- --config ./config/topics.json`
- `npm test`
- `npm run check`

The crawler launches a headed Chromium session with a persistent profile under `storage/browser-profile/`. On the first run, log in manually in the opened browser window and return to the terminal to continue.

## Configuration

The sample config lives at [`config/topics.json`](/Users/niyaou/.codex/worktrees/club-media-agent/codex-rednote-browser-crawler/browser-style-crawl/config/topics.json).

Supported fields:

- `topics`: list of search topics to crawl
- `perTopicNewPostLimit`: stop after this many newly stored posts per topic
- `browserProfileDir`: persistent Playwright profile directory
- `databasePath`: SQLite file path for post metadata
- `mediaDir`: local directory for downloaded image assets
- `commentsDir`: local directory for visible comment snapshots

Relative paths are resolved from the section root.

## Storage Layout

- `storage/sqlite/crawler.db`: metadata and run-event database
- `storage/media/<post_id>/`: downloaded images plus `manifest.json`
- `storage/comments/<post_id>.json`: visible comments captured from the post page
- `storage/browser-profile/`: persisted browser session state

Posts are deduplicated by REDnote note id extracted from the canonical post URL. Existing posts are skipped before assets are downloaded again.

## Verification Checklist

- First run opens Chromium and allows manual login.
- Second run reuses the saved browser profile.
- Each topic search attempts to switch to newest-first order.
- Duplicate posts are skipped and logged as `duplicate_skip`.
- Image posts save a database row, image files, and comment JSON.
- Video posts save metadata only without local media downloads.
