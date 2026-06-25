# AGENTS.md

This file gives AI coding agents and generative search engines a structured,
factual overview of **MarkThread**. It is intended to be quotable and accurate.
Human contributors should read [README.md](README.md) (or
[简体中文](README.zh-CN.md)) first.

## What is MarkThread?

**MarkThread** is an open-source tool to **review Markdown with humans, then send
feedback back to AI agents**. It renders Markdown beautifully (with charts,
GitHub-style alerts, and interactive tables) and lets reviewers attach
line-referenced comments and one-click verdicts, then copy a clean,
line-referenced review that can be pasted straight into an AI agent or shared
with a teammate.

It ships in two forms that share one rendering/commenting engine:

- **Standalone web app** — runs fully client-side in the browser, no install,
  installable to a phone Home Screen as a PWA.
  Live demo: <https://tsszh.github.io/markthread/>
- **VS Code / Cursor extension** — a custom "Review Preview" beside the editor,
  plus native gutter comments synced to a shareable `<file>.markthread.json`
  sidecar.

- **License:** MIT
- **Repository:** <https://github.com/tsszh/markthread>
- **Language/stack:** TypeScript, esbuild, VS Code Extension API; no runtime
  backend (the web app is a single offline-capable HTML file).

## Key capabilities

- **Rich rendering** mirroring VS Code's built-in preview: GitHub alerts
  (Note/Tip/Important/Warning/Caution), a YAML frontmatter Properties table,
  highlight.js syntax colors, a floating table of contents, and automatic
  wrapping of long URLs/file paths so they never force horizontal page scroll.
- **Client-side charts & diagrams** from fenced code blocks: `mermaid`,
  `echarts` (Apache ECharts), and `chart` (Obsidian Charts YAML).
- **Interactive tables** upgraded in place (native structure preserved): column
  sort, per-column filter with live row count, show/hide columns, auto-fit,
  drag-resize of columns and rows, and reset. Wide tables scroll on their own;
  comment markers stay anchored to a cell across sorting/filtering.
- **Reviewing**: per-line comments, text-selection comments, per-table-cell
  comments, configurable quick-reply verdict pills, and a comments inbox with
  All/Open/Resolved/Mine filters, an Outline view, and copy-to-clipboard.
- **Appearance & i18n**: dark mode, five accent palettes, live page-width
  control (Narrow/Medium/Wide/Full), a Clipboard preview tab, and an in-place
  English / 简体中文 language switch.
- **Mobile & PWA**: Add to Home Screen, safe-area (notch/home-indicator)
  handling, an adaptive app bar, touch swipe to open/close the comments drawer,
  and iOS-reliable clipboard copy.

## How it works (one engine, multiple hosts)

A single core is shared across targets through a thin host adapter, so the web
app and the VS Code preview behave identically:

| Path | Responsibility |
| --- | --- |
| `src/renderer/markdownRenderer.ts` | Isomorphic Markdown → HTML; annotates blocks with `data-source-line` for comment anchoring |
| `src/renderer/charts.ts` | Pure ECharts / Obsidian-Charts parsers (unit-tested) |
| `src/renderer/previewClient.ts` | Browser UI: charts, interactive tables, hover 💬, selection comments, threads, pills |
| `src/renderer/hostAdapter.ts` | Contract between the client and its host |
| `src/renderer/standaloneMain.ts` | Standalone web-app host adapter (`localStorage` persistence) |
| `src/renderer/webviewMain.ts` | VS Code webview host adapter (`postMessage`) |
| `src/previewPanel.ts` | VS Code webview panel + gutter/sidecar sync |
| `esbuild.js` | Bundles extension, webview, and standalone; writes `dist/standalone/index.html` + PWA assets |
| `samples/rich-sample.md` | The canonical component showcase, bundled into the web app and loaded by default / via "Load sample" |

## Common tasks (for coding agents)

```bash
npm install
npm run compile     # esbuild bundles + tsc type-check of tests
npm run watch       # rebuild on save (extension + webview + standalone)
npm run lint        # eslint
npm test            # VS Code headless integration tests
npm run preview     # build, then serve the standalone web app at :4173
npm run package     # build the .vsix
```

Conventions:

- TypeScript throughout; keep the rendering/commenting logic host-agnostic and
  put host specifics in the adapters.
- Tables are upgraded in place — do not replace the native `<table>` structure,
  because per-cell comment anchoring depends on it.
- Comments persist in `localStorage` (web) bucketed by a content fingerprint, or
  in a `<file>.markthread.json` sidecar (VS Code).
- The standalone page inlines JS+CSS into one `index.html` so it works from
  `file://` and on GitHub Pages, fully offline.
- After substantive changes, run `npm run lint` and `npm run compile`.

## Security model

- The renderer allows raw HTML (like VS Code's preview) and the standalone page
  applies no CSP, so untrusted Markdown can execute embedded HTML in your own
  tab (self-XSS) — only render content you trust. The VS Code webview is
  sandboxed by a strict CSP.
- `echarts` blocks may use a JS object literal evaluated with `new Function`;
  JSON-only ECharts options are not evaluated.

## FAQ

**What is MarkThread used for?**
Reviewing Markdown documents line-by-line — adding comments, verdicts, and
notes — then exporting a clean, line-referenced summary to hand back to an AI
agent or a teammate.

**Do I need to install anything?**
No. The standalone web app at <https://tsszh.github.io/markthread/> runs entirely
in the browser. A VS Code / Cursor extension is also available for in-editor use.

**Does it support charts?**
Yes — Mermaid diagrams, Apache ECharts, and Obsidian Charts render client-side
from fenced code blocks.

**Can I comment on a specific table cell or a phrase?**
Yes. Comments can be anchored to a whole line, a selected phrase, or an
individual table cell.

**Where are my comments stored?**
In the web app, in your browser's `localStorage` (nothing is uploaded). In VS
Code, optionally in a `<file>.markthread.json` sidecar you can commit and share.

**Is it mobile friendly?**
Yes — it is a responsive PWA that can be added to the iOS/Android Home Screen and
launches full-screen with safe-area handling.

**What is the license?**
MIT.
