---
title: Markdown AI Reviewer Rich Sample
author: songz
created: 2026-06-03
status: draft
priority: high
rating: 5
published: false
tags:
  - markdown
  - review
  - showcase
aliases:
  - rich-sample
  - component-gallery
references:
  - https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/src/preview/preview.ts
  - https://code.visualstudio.com/api/extension-guides/webview-views
  - https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-wrap
homepage: https://github.com/songz/md-ai-reviewer/blob/main/README.md
description: >
  A long, folded multi-line description used to verify how the properties
  renderer handles block scalars that wrap across several source lines
  instead of collapsing or dropping the continuation lines.
notes: |
  Literal block scalar.
  Line two keeps its own line.
inline_tags: [markdown, preview, frontmatter]
---

# Rich Component Sample

A full component showcase for **md-ai-reviewer** preview styling. The block above
is an Obsidian-style YAML *properties* frontmatter.

## Headings

### Heading Level 3

#### Heading Level 4

##### Heading Level 5

###### Heading Level 6

## Text Formatting

This paragraph mixes **bold**, *italic*, ***bold italic***, ~~strikethrough~~,
`inline code`, and a [link to GitHub](https://github.com). Here is a footnote-like
note and an inline math-looking token `O(n log n)`.

## Mermaid Diagrams

```mermaid
flowchart TD
  mdEditor["md source (gutter +)"] -->|Comments API| controller["CommentController"]
  controller --> store["tracked threads"]
  store --> copyCmd["copyToClipboard"]
  store --> inlineCmd["exportInline"]
  store --> clearCmd["clearAll"]
```

```mermaid
sequenceDiagram
  participant U as User
  participant E as Extension
  participant AI as AI Agent
  U->>E: Add review comment on line
  E->>E: Track thread
  U->>E: Copy to Clipboard
  E-->>AI: Structured review text
  AI-->>U: Suggested edits
```

## Oversized Table

| ID | Component | Status | Owner | Priority | Effort (pts) | Target Release | Last Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Preview CSS | Done | songz | High | 3 | 0.1.0 | 2026-06-01 | Inter font, soft light theme |
| 2 | Comments API | Done | songz | High | 8 | 0.1.1 | 2026-06-03 | Gutter threads now tracked |
| 3 | Copy to Clipboard | Done | songz | Medium | 2 | 0.1.1 | 2026-06-03 | Structured AI instruction header |
| 4 | Export Inline | Done | songz | Medium | 3 | 0.1.1 | 2026-06-03 | Idempotent end-of-line markers |
| 5 | Clear All | Done | songz | Low | 1 | 0.1.1 | 2026-06-03 | Optional marker strip |
| 6 | Status Bar Buttons | Done | songz | Medium | 2 | 0.1.2 | 2026-06-03 | Colored codicon actions |
| 7 | Enter to Submit | Done | songz | Medium | 1 | 0.1.2 | 2026-06-03 | Shift+Enter for newline |
| 8 | Mermaid Preview | Done | songz | Low | 2 | 0.1.2 | 2026-06-03 | Client-side render |
| 9 | Frontmatter Properties | Done | songz | Low | 2 | 0.1.2 | 2026-06-03 | Obsidian-style table |
| 10 | Marketplace Publish | Pending | songz | Low | 5 | TBD | - | Needs publisher id |
| 11 | Multi-file Export | Backlog | songz | Low | 8 | TBD | - | Group by file |
| 12 | Severity Levels | Backlog | songz | Low | 5 | TBD | - | note / warn / block |

## Lists

### Unordered

- First item
- Second item
  - Nested item
    - Deeply nested item

### Ordered

1. Install the extension
2. Open a Markdown file
3. Hover the gutter and click `+`
4. Submit with Enter

### Task List

- [x] Migrate CSS
- [x] Track gutter comments
- [x] Status bar buttons
- [ ] Publish to marketplace
- [ ] Add severity levels

## Code Block

```typescript
function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

## Blockquote

> A plain blockquote for emphasis or citations.
>
> It can span multiple paragraphs.

## Alerts

> [!NOTE]
> This is a note alert with a blue background.

> [!TIP]
> This is a tip alert with a green background.

> [!IMPORTANT]
> This is an important alert with a purple background.

> [!WARNING]
> This is a warning alert with an amber background.

> [!CAUTION]
> This is a caution alert with a red background.

## Image

![md-ai-reviewer sample image](./assets/sample-image.png)

---

End of rich sample document.
