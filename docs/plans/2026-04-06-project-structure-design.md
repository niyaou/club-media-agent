# Project Structure Design

**Goal:** Define an initial repository structure where each task is isolated in its own top-level folder, starting with the browser-style crawl section.

**Architecture:** The repository uses a task-owned top-level layout rather than a language-owned layout. Each task folder is self-contained and can later hold Python, JavaScript, or non-code assets without forcing the whole repo into one runtime model.

**Tech Stack:** Repository structure only, Markdown documentation

---

## Requirements

- Keep task folders separate from one another.
- Add a `README.md` at the repository root.
- Add a `README.md` inside every created task folder.
- Start with the `browser-style-crawl` section only.

## Proposed Structure

- `README.md`
- `browser-style-crawl/`
- `browser-style-crawl/README.md`

## Design Notes

- The root `README.md` explains the repository-level organizational rule.
- Each task folder documents its own scope and constraints locally.
- Future tasks should be added as additional top-level folders following the same pattern.
