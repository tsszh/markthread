# Markdown AI Reviewer

A VS Code extension that applies a clean, readable stylesheet to the built-in Markdown preview and adds line-by-line AI review comments in the Markdown source editor gutter.

## Features

### Preview styling

Injects [`media/markdown-preview.css`](media/markdown-preview.css) via `markdown.previewStyles` for a soft light theme with Inter typography, styled tables, GitHub-style alerts, and dark code blocks.

### AI review comments

Uses the native VS Code Comments API on Markdown files:

- Hover the editor gutter to add a comment on any line
- Press Enter to submit a comment, Shift+Enter for a newline
- Reply to or delete comments from the comment thread menu
- A dedicated "AI Review" panel (activity bar) shows comments grouped file → thread → comment, with replies nested; click the jump button to go to the line
- The panel has two large action buttons (Copy Review / Save to file), a small Clear-all link, and Expand all / Collapse all controls (which also expand/collapse the threads in the editor)
- Copy to Clipboard is the primary workflow: structured, line-referenced review text ready to paste into an AI
- Optional team-shareable storage: "Save to file" writes a sibling `<file>.ai-review.json`; it auto-loads when you reopen the file, and can be reloaded on demand — commit it to share with your team
- Floating table of contents in the Markdown preview: lists all headings, highlights the current section, and lets you jump between sections quickly

## Commands

| Command | Description |
| --- | --- |
| `Markdown AI Reviewer: Copy AI Review to Clipboard` | Copies a structured text block with file, line number, quoted source line, and comment text |
| `Markdown AI Reviewer: Save AI Review Comments to File` | Writes a sibling `<file>.ai-review.json` sidecar with the file's review comments |
| `Markdown AI Reviewer: Load AI Review Comments from File` | Reloads comments from the sidecar on demand (idempotent) |
| `Markdown AI Reviewer: Clear All AI Review Comments` | Clears all comment threads and deletes the current file's sidecar |

## Development

```bash
npm install
npm run compile
npm run watch      # rebuild extension on save
npm run lint
npm test           # VS Code headless integration tests
npm run preview    # local styled Markdown preview server
npm run package    # build .vsix
```

Press **F5** in VS Code/Cursor to launch an Extension Development Host.

### Preview server

`npm run preview` serves [`samples/rich-sample.md`](samples/rich-sample.md) rendered with `markdown-it` and the extension CSS at `http://localhost:4173`. The sample exercises YAML frontmatter properties, Mermaid diagrams, oversized tables, alerts, task lists, and a local image.

## Testing

- **Core logic**: `src/test/suite/extension.test.ts` covers `formatStructured`, sidecar serialize/parse and on-disk round-trips, comment tracking, and the panel model
- **Extension host**: same suite verifies activation and command registration via `@vscode/test-cli`
- **Rendering**: start `npm run preview` and verify styled output in a browser

## Packaging

```bash
npm run package
```

This produces `md-ai-reviewer-<version>.vsix`, installable via **Extensions: Install from VSIX**.

## Publishing (later)

When a Marketplace publisher ID is available:

```bash
vsce publish
```

## License

MIT
