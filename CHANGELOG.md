# Changelog

## 0.1.32

- **Toolbar polish (standalone web app).** Aligned the app-bar icon buttons consistently (the "more actions" affordance is now a real three-dot icon and icon/text buttons no longer clip), so the quick-action cluster lines up.
- **Clearer page-width control.** Replaced the page-width button's cramped glyph with a clean horizontal double-arrow and added a live text label of the current width (Narrow / Medium / Wide / Full · 窄 / 中 / 宽 / 全宽).
- **Better "follow system" theme icon.** The system/auto theme mode now uses the conventional half-filled contrast circle instead of a monitor glyph.
- **New Clipboard preview tab.** A third view (Read / Source / **Clipboard**) shows the exact plain text that "Share review" copies to the clipboard, with a one-click Copy button — so reviewers can see what will be shared before sending it. It stays live as comments and the language change.

## 0.1.31

- **Page width is now a live appearance toggle.** Switching the rendered document width is as instant as changing the theme — no Save step. The standalone web app gets a dedicated width button in the toolbar (next to the theme toggle) that cycles Narrow → Medium → Wide → Full. The VS Code preview reads a new `markThread.appearance.pageWidth` setting and reacts live, and the MarkThread side panel's **Appearance** section gained a matching Narrow / Medium / Wide / Full segmented control. All three surfaces drive the same width and reflect changes on the window immediately.

## 0.1.30

- **Rich, interactive tables.** Markdown tables are now upgraded in place into interactive grids without losing their native structure (so per-cell comments keep working). Wide tables that exceed the page width get their own horizontal scroll instead of overflowing the document. Each table gains a toolbar with **sort** (click a header to cycle ascending → descending → original), a per-column **filter** row (funnel toggle) with a live row count, **Auto-fit** (one click fits every column to its content; double-click a column's resize grip to fit just that one), a **Columns** menu to **show/hide** individual columns, and **Reset**. Columns are drag-resizable from their right edge and rows from the bottom edge of the first cell. Comment markers stay anchored to their cell across sorting/filtering via a stable per-row identity.
- **Load rich sample.** The standalone web app's "⋯" menu gained a **Load rich sample** action that loads the full component showcase (`samples/rich-sample.md`, including the oversized table), baked into the bundle so it works offline.
- **Configurable page width.** The standalone Settings dialog has a new **Page width** option (Narrow / Medium / Wide / Full width) so the rendered document can be widened to fit large tables or narrowed for easier reading. The choice is persisted per browser.

## 0.1.29

- Added an **Appearance** section to the MarkThread side panel's settings (the gear button), so the preview's language, theme, and accent can be changed without opening VS Code settings. Language and theme use compact segmented controls (Auto / EN / 中 and System / Light / Dark), and the accent is a row of live colour swatches. Choices apply instantly — they write the same `markThread.appearance.*` settings, and any open Review Preview updates live.

## 0.1.28

- Refreshed the visual design of both the standalone web app and the VS Code preview. A threaded-comment brand mark, a display typeface for headings (Inter Tight), tinted layered shadows, and a consistent corner-radius scale replace the previous generic blue-on-grey look.
- Added a **switchable accent palette** with five curated options — Oxblood, Graphite ink (near-monochrome), Pine green, Terracotta, and Petrol teal. Pick one from the palette button in the standalone toolbar (persisted per browser, defaults to Oxblood). Semantic status chips are retuned per accent so the brand colour never collides with the approve-green or warning-amber meaning.
- Added a real **dark mode**, orthogonal to the accent. The standalone app gets a light/dark toggle in the toolbar (persisted, defaults to the OS preference); the VS Code preview follows VS Code's own light/dark theme. Every accent works in both modes, and alerts, tables, code, status chips, and the review inbox all adapt.
- Polished the review chrome: a frosted sticky toolbar, tactile buttons, refined segmented tabs, and a branded text-selection highlight that echoes the annotation motif.
- Reworked reading for **long-form immersion**: the standalone app now renders the document on a centered paper "sheet" capped to a comfortable measure (instead of edge-to-edge text), which recenters into the free space when the comments panel opens. Full-width heading underlines are replaced with editorial spacing and a short accent section marker, and a reading-progress hairline under the toolbar tracks scroll position. The VS Code preview gets the same capped reading measure.
- Added a global **English / 简体中文 language switch**. A compact globe button in the toolbar toggles the entire interface language in place (no reload) and remembers the choice per browser, defaulting to the browser locale. Every piece of chrome localizes — toolbar, menus, the source editor, the settings dialog, toasts, and the whole review experience (comment threads, quick-reply composer, inbox filters, outline, gutter markers, and relative timestamps). Authored Markdown and saved verdict labels are left untouched.
- Polished the accent palette menu: labels no longer collide with their colour swatches (a CSS specificity fix), and the open menu now has a clear "Accent" header, rounded swatch chips, and a soft highlight pill on the active palette.
- Exposed **appearance settings for the VS Code preview** (`markThread.appearance.language`, `markThread.appearance.theme`, `markThread.appearance.accent`), editable from the Settings editor or `settings.json`. Language defaults to following VS Code's display language; the accent picks any of the five palettes; and the theme now offers **Follow system / Light / Dark** — "system" tracks the active VS Code color theme live. The standalone web app's theme toggle gained the same three-way **Follow system** option.

## 0.1.27

- The **Review Comments** side panel now lists selection- and table-cell-anchored comments too (previously it only showed whole-line gutter threads, so cell comments were invisible there even though they were stored and appeared when copying). Cell comments show their `Table N (L<line>), row R, column C (Header)` address as the badge, keeping the panel in sync with what is actually stored in memory.

## 0.1.26

- Table-cell comments now stay anchored to their individual cell instead of collapsing onto the whole table. In the VS Code preview, cell-anchored threads are kept as detached threads (like selection comments) rather than being mirrored onto the single table source line, so multiple cells in one table no longer merge into one thread.
- Copying/sharing a review now quotes a precise location for table-cell comments — `Table N (L<line>), row R, column C (Header)` — with the cell's content as the quoted line, instead of attributing every cell to the table's source line. The standalone web app and the VS Code extension produce the same label.

## 0.1.25

- Fixed Mermaid diagrams rendering "Syntax error in text" once a comment was attached to the diagram: the per-line comment marker was being appended inside the `<pre>` Mermaid reads, corrupting the diagram source. Mermaid blocks are now wrapped so the marker anchors to a wrapper element instead.
- `Ctrl/Cmd+Shift+V` now toggles: pressing it while the review preview is focused jumps back to the Markdown source editor (previously it only opened the preview).
- The quoted "line content" is no longer lost when copying/saving a review while the source file isn't open in an editor (e.g. after replacing it with the in-place preview). The source line is now captured per thread and used as a fallback.
- Review commenting/preview now recognises the whole Markdown family by extension (`.md`, `.markdown`, `.mdx`, `.mdc`, `.qmd`, `.rmd`, …) as well as the `markdown` language id, so skill/rule files such as `SKILL.md` and Cursor `.mdc` files are reviewable even when the editor labels them with a different language id.

## 0.1.24

- Renamed the project to **MarkThread** — "Review Markdown with humans, then send feedback back to agents." The extension/package id is now `markthread`, the configuration namespace is `markThread.*`, command IDs are `markthread.*`, and the per-file review sidecar is now `<file>.markthread.json` (previously `<file>.ai-review.json`). Older sidecar files are not migrated automatically.

## 0.1.23

- Standalone web app: added a "Clear all comments" action (in the ⋯ menu) that removes every comment for the current document after confirmation.
- VS Code: "Copy AI Review" and "Save to file" now work when the rendered preview webview is the active tab (previously they reported 0 comments and required switching back to the raw Markdown file). Copy/Save also now include selection-anchored comments.
- Comments can be edited and deleted individually in the preview popup (hover a comment for the edit/delete buttons); deleting the last comment removes the thread.
- The line/cell comment marker now shows the total number of comments (including follow-up replies) instead of always showing 1.

## 0.1.22

- The custom preview no longer writes a `<file>.ai-review.json` sidecar on every comment edit. Comments (including selection-anchored threads) are now kept in memory and only persisted to disk when you explicitly run "Save to file", matching the native gutter behavior.
- "Save to file" now also persists selection-anchored threads (previously only whole-line threads were saved), and loading a sidecar restores them into memory instead of duplicating them onto the gutter.

## 0.1.21

- Comment popups no longer drop below tall blocks (charts, big tables/images). When there is no room to the left, the popup now opens just below the marker with the drop capped to ~3 lines, and is kept within the viewport so it stays next to the element instead of appearing far below it.
- Rebinding the preview to a document in another folder now refreshes the webview's allowed resource roots so its relative images still load.

## 0.1.20

- Relative images (e.g. `![](screenshots/x.png)`) now load in the VS Code preview: the document folder and workspace folders are added to the webview's allowed resource roots, and relative image URLs are resolved against the document folder.
- Removed the always-on quick-reply pills from the side "Review Comments" panel; the panel is now a clean read-only index. Clicking a comment (or the jump button) opens the rendered AI Review preview and scrolls to that thread, where you can read, reply and edit it directly.
- The side-panel "jump" now opens the rendered preview at the thread instead of dropping you into the raw Markdown source.
- Added "Open AI Review Preview" (in place) which replaces the current editor like the built-in `Ctrl+Shift+V` Markdown preview, in addition to the existing "to the Side" command. Keybindings: `Ctrl/Cmd+Shift+V` opens in place, `Ctrl/Cmd+K V` opens to the side (in Markdown editors).

## 0.1.19

- The "Open AI Review Preview" editor-title button now uses a distinct comment-discussion icon so it is no longer confused with VS Code's built-in Markdown preview button.
- Fixed comment gutter markers overlapping the document text in the VS Code preview: the standalone mobile layout's gutter override was leaking into the (often narrow) preview panel; it is now scoped to the standalone app, so the preview keeps its desktop gutter offset.
- Fixed quick-reply pills in the VS Code preview adding an invisible comment: the verdict is now written into the comment body (in addition to the colored status chip), so it survives the sidecar/native round-trip — which only persists author + body — and shows up in the preview, the editor gutter threads, and the side panel.

## 0.1.18

- Reworked the shared review preview (used by both the standalone web app and the VS Code preview webview) into a Quip-style experience: comment threads now open in a single floating popup overlay that never reflows the document, with a left-gutter marker (icon + count) when collapsed.
- Table cells are individually commentable: a marker appears in the cell's top-right corner and opens the same popup to view/edit/add comments.
- Quick-reply pills are now hidden until the reply box is focused, so the composer starts clean.
- Fixed GitHub alert (Note/Tip/Important/Warning/Caution) titles so the icon and label are vertically aligned, and replaced the dashed divider above the quick-reply pills with a clean solid hairline.
- Standalone web app: configurable quick-reply pills and a "Share review" copy template, both persisted in `localStorage`; "Export comments" stays JSON while "Share review" copies a readable text summary (line number, line text, comments).
- Main content width is now fluid (grows with the window with responsive gutters) instead of a fixed max-width cap.

## 0.1.17

- Unsaved (`untitled`) Markdown files now show their comments in the AI Review side panel; jump-to-line works for them too.
- Comments can now be edited after submission: a pencil icon on each comment enters edit mode, Enter (or the Save button) saves, Escape (or Cancel) reverts to the last saved text.
- Expand/Collapse controls are now split into two independent groups in the side panel: "Panel" (the panel's own tree) and "Editor" (the comment threads in the Markdown editor). Each editor comment widget's title bar also gained Expand All / Collapse All buttons.
- Side panel threads are collapsed by default; only the active thread (cursor line, or the thread that just gained/edited a comment) expands automatically. Manual expand/collapse choices are remembered.
- Quick replies: clickable pills under each thread in the side panel submit a reply instantly. Defaults are emoji-friendly ("👍 Looks good", "✅ Confirmed", "❌ No", "🤔 Please clarify", "🛠️ Please fix", "📌 TODO later") and the list is editable in the panel's new settings section (gear icon) or via `mdAiReviewer.quickReplies`; a "Reset to defaults" button restores all settings.
- Copy Review is now configurable: by default it copies only the quoted line content and the comment (no file name, no line number). The settings section lets you toggle file name / line number / line content / comment and edit the header (prompt) template prepended to the copied text (`mdAiReviewer.copy.*`).
- Replaced the long "Add an AI review comment for this line" gutter prompt with a compact "💬 Add review comment" button label.

- Fixed the frontmatter Properties table squeezing values to one character per line in narrow preview panes. The key column used a fixed `table-layout` with a hard 200px width; it now uses an auto layout where the key column shrinks to its content and the value column takes the remaining width (long URLs still wrap instead of overflowing).

## 0.1.15

- Styled the Markdown preview's YAML frontmatter **Properties** table. VS Code's built-in preview already renders frontmatter as `table.frontmatter` (parsed with a real YAML library, so multi-line block scalars, lists, and inline arrays are handled correctly); the extension now themes that table (card styling, key column, list/code values) and, via the preview script, adds a "Properties" label and turns bare URLs into clickable links that wrap instead of overflowing the page. The local preview server now emits the same `table.frontmatter` markup (using the `yaml` parser) so it faithfully mirrors the shipped preview.
- Note: clicking task-list checkboxes to write back to the source is **not** supported by VS Code's built-in Markdown preview and cannot be added through the contributed preview-script/style API (the preview webview only accepts a fixed set of messages and does not execute `command:` links), so it was intentionally left out.

## 0.1.14

- Markdown preview code blocks now show proper language syntax highlighting. The custom stylesheet previously flattened all tokens to a single color (`pre code { color: inherit }`); it now styles the `hljs-*` token classes emitted by highlight.js (used by both the VS Code built-in preview and the local preview server) with a dark-friendly palette.
- Mermaid diagrams no longer get the dark code-block background. The dark `pre` chrome is now scoped to `pre:not(.mermaid)`, and `pre.mermaid` is transparent/centered so the diagram keeps mermaid's own theme.
- Preview view fixes: removed the global smooth-scroll that fought the editor/preview scroll sync (fast scrolling no longer bounces back), the content width now grows with the window instead of a fixed 960px cap, and the TOC opener is always available with click-outside-to-dismiss.

## 0.1.13

- Fixed the Markdown preview table of contents (and its toggle icon) intermittently not appearing, most notably with `Ctrl+Shift+V` and in WSL2/remote windows. The TOC was built only once, synchronously, before the VS Code preview injected the rendered HTML, so it found no headings and never retried; preview re-renders could also wipe it. The TOC now rebuilds reactively via a debounced `MutationObserver` and is idempotent (a heading signature avoids duplicate work and flicker).

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
