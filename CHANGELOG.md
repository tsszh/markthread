# Changelog

## 0.1.12

- Fixed a recurring bug where the comments side panel would blank out while the comment text box was focused. The comment input is itself a markdown-language editor, so the active-editor tracker now requires a real `file`-scheme document before switching the panel's target file.

## 0.1.11

- Comment submit keybindings reworked: a wrapper command (`md-ai-reviewer.submit`) tries both `editor.action.submitComment` and `workbench.action.submitComment`, and is bound to Enter, Ctrl/Cmd+Enter, and Alt+Enter. Alt+Enter is the recommended fallback because Cursor's AI tends to capture Enter/Ctrl+Enter in the comment box. Shift+Enter still inserts a newline.

## 0.1.10

- Fixed: editing a comment (focusing the comment box) no longer blanks the panel. The panel now sticks to the last active Markdown file and ignores transient focus changes.
- Added a floating table of contents to the Markdown preview (both the built-in VS Code preview and the local preview server): lists all headings, supports quick jump between sections, highlights the current section, and collapses behind a toggle on narrow widths.

## 0.1.9

- The panel now shows comments for the currently active file only (it follows the active editor), so Copy/Save are never ambiguous about which file they act on.

## 0.1.8

- Removed inline HTML-comment export entirely. Copy to Clipboard is now the primary action.
- Sidecar persistence is now optional/manual: use "Save to file" to write `<file>.ai-review.json`; saved comments auto-load (reload) when the file is reopened, and "Load AI Review Comments from File" reloads on demand.
- Expand all / Collapse all now also expand/collapse the comment threads shown in the editor gutter, not just the panel.

## 0.1.7

- The review panel now only shows comments for files that are currently open; closing a file removes it from the panel (its sidecar is kept).
- Auto-save now only writes sidecars for open files, so closing a file can never clobber or delete its stored comments.

## 0.1.6

- Team-shareable persistence: each Markdown file's review comments are saved to a sibling `<file>.ai-review.json` sidecar that auto-loads when the file is opened and auto-saves on every change. Commit the sidecars and your whole team sees the same comments.
- Inline export no longer corrupts YAML frontmatter: markers are never inserted between the `---` fences (which caused "Nested mappings are not allowed in compact mappings"); skipped frontmatter comments stay in the panel/sidecar and the export reports how many were skipped.
- "Copy AI Review to Clipboard" now names the source file in the confirmation message.

## 0.1.5

- Rebuilt the AI Review panel as a webview that mirrors the native COMMENTS structure: comments are grouped file → thread → comment, with replies nested and tagged.
- Action buttons now live inside the panel: two large "Copy Review" / "Export Inline" buttons plus a small "Clear all comments" text link (no more title-bar icons).
- Added Expand all / Collapse all controls and a jump-to-line button on each thread.
- Inline `<!-- ai-review @Ln: ... -->` markers are now parsed back into comment threads: opening any Markdown file that contains them auto-loads the comments into the panel (idempotent). Added a "Load Inline AI Review Comments" command.

## 0.1.4

- Added a dedicated "AI Review" panel (activity bar view) listing all review comments grouped by file, with comment text and click-to-jump to the exact line.
- Moved the Copy / Export / Clear actions (plus Refresh) into the panel title bar.
- Removed the CodeLens action row.
- Simplified the Enter keybinding `when` to just `commentEditorFocused` (the previous `!inlineSuggestionVisible` clause could be permanently true in Cursor and disable Enter).

## 0.1.3

- Fixed Enter not submitting a comment: bound Enter to the built-in `workbench.action.submitComment` (Shift+Enter still inserts a newline). Reload the window after updating so the keybinding takes effect.
- Replaced the status bar buttons with an in-document CodeLens action row (Copy Review / Export Inline / Clear Review) at the top of each Markdown file.
- Improved blockquote styling: visible accent left border, soft tint, italic text, with legible nested emphasis/code.

## 0.1.2

- Moved the Copy / Export / Clear actions from the editor title bar to colored status bar buttons (shown for Markdown files only).
- Added keybindings: Enter submits a comment, Shift+Enter inserts a newline.
- Replaced the sample with `samples/rich-sample.md`: Obsidian YAML frontmatter properties, Mermaid diagrams, an oversized table, a downloaded local image, alerts, and task lists.
- Enhanced the preview server to render frontmatter as an Obsidian-style properties table, render Mermaid client-side, and serve local image assets.

## 0.1.1

- Fixed: comments added via the gutter `+` button are now tracked, so Copy to Clipboard and Export Inline include them.
- Fixed: Delete Comment, Delete Thread, and Clear All now actually remove threads.
- Wired the native Comments API submit/reply buttons via `comments/commentThread/context`.
- Renamed comment author from "AI Reviewer" to "Reviewer" to reduce confusion.

## 0.1.0

- Initial TypeScript extension scaffold with build, lint, test, and package scripts.
- Migrated Markdown preview stylesheet from the local static extension.
- Added line-by-line AI review comments via VS Code Comments API.
- Added commands to copy structured review text, export inline HTML comment markers, and clear threads.
- Added local preview server for styled Markdown rendering verification.
- Added VS Code headless integration tests for core logic and command registration.
