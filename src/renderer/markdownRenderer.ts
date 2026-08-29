// Isomorphic Markdown renderer shared by the VS Code webview, the standalone
// web page, and the local preview server. Pure: given a Markdown string it
// returns HTML plus a rendered frontmatter ("Properties") table. It also
// annotates every block element with `data-source-line` so the preview client
// can anchor review comments to the exact source line.
//
// The markdown-it configuration deliberately mirrors VS Code's built-in
// Markdown preview (highlight.js tokens, GitHub alerts, YAML frontmatter) so
// the custom preview looks identical to the native one.
import MarkdownIt from 'markdown-it';
import markdownItGithubAlerts from 'markdown-it-github-alerts';
import frontMatter from 'markdown-it-front-matter';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

type Token = MarkdownIt.Token;

export interface RenderResult {
  /** Rendered document body HTML. */
  html: string;
  /** Rendered frontmatter "Properties" table HTML (empty when absent). */
  propertiesHtml: string;
}

function createMd(): { md: MarkdownIt; getFrontMatter: () => string } {
  let frontMatterRaw = '';

  const md: MarkdownIt = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight: (str: string, lang: string): string => highlightInner(str, lang, md),
  });

  md.use(markdownItGithubAlerts);
  md.use(taskLists, { enabled: true, label: true });
  md.use(frontMatter, (fm: string) => {
    frontMatterRaw = fm;
  });

  // Split multi-line paragraphs inside blockquotes *before* GitHub alerts
  // rewrite the wrapper, so each original `>` source line is its own
  // commentable <p>. Registered after('block') once alerts is already in
  // the chain, which inserts this rule *between* block and github-alerts.
  md.core.ruler.after('block', 'split_quote_paragraphs', (state): boolean => {
    splitMultilineQuoteParagraphs(state as CoreState);
    return false;
  });

  // `[!NOTE]` (and optional custom title) lived on its own source line; after
  // the split + alerts transform that line's paragraph is empty — drop it so
  // the injected `.markdown-alert-title` is the comment target for that line.
  md.core.ruler.after('github-alerts', 'trim_alert_empty_intro', (state): boolean => {
    const tokens = state.tokens as Token[];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'alert_open') {
        continue;
      }
      const open = tokens[i + 1];
      const inline = tokens[i + 2];
      const close = tokens[i + 3];
      if (
        open?.type === 'paragraph_open' &&
        inline?.type === 'inline' &&
        close?.type === 'paragraph_close' &&
        !inline.content.trim()
      ) {
        tokens.splice(i + 1, 3);
      }
    }
    return false;
  });

  // The plugin's default alert_open renderer drops token attrs (so the
  // wrapper has no data-source-line) and the title <p> is raw HTML. Restore
  // both so the title is a commentable leaf and the wrapper is a container.
  md.renderer.rules.alert_open = (tokens, idx) => {
    const token = tokens[idx];
    const meta = (token.meta ?? {}) as {
      title?: string;
      type?: string;
      icon?: string;
    };
    const title = meta.title ?? '';
    const type = meta.type ?? 'note';
    const icon = meta.icon ?? '';
    const attrs = md.renderer.renderAttrs(token);
    const titleLine = token.map ? token.map[0] : 0;
    return `<div class="markdown-alert markdown-alert-${type}"${attrs}><p class="markdown-alert-title" data-source-line="${titleLine}" data-source-end="${titleLine + 1}">${icon}${title}</p>`;
  };

  // Annotate block-level tokens with their source line range so the preview
  // client can attach per-line comment affordances. Mirrors VS Code's own
  // `data-line` scheme used for scroll sync.
  md.core.ruler.push('source_line_numbers', (state): boolean => {
    for (const token of state.tokens as Token[]) {
      annotate(token);
    }
    return false;
  });

  function annotate(token: Token): void {
    if (token.map && token.block) {
      token.attrSet('data-source-line', String(token.map[0]));
      token.attrSet('data-source-end', String(token.map[1]));
    }
    if (token.children) {
      for (const child of token.children) {
        // Inline children have no useful block map; only block tokens carry one.
        if (child.block) {
          annotate(child);
        }
      }
    }
  }

  // Custom fences: charts and diagrams become client-rendered containers.
  // Regular (and indented) code is split into per-source-line spans so each
  // line can be commented independently with the correct Line N.
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = token.info.trim().toLowerCase();
    const lang = info.split(/\s+/)[0] ?? '';
    const lineAttrs = token.map
      ? ` data-source-line="${token.map[0]}" data-source-end="${token.map[1]}"`
      : '';

    if (lang === 'mermaid') {
      // Wrap the diagram so the per-line comment marker anchors to the wrapper,
      // not the <pre> Mermaid renders from. Mermaid reads the element's
      // textContent asynchronously, so a marker appended directly into the
      // <pre> would corrupt the diagram source ("Syntax error in text").
      return `<div class="md-diagram mermaid-block"${lineAttrs}><pre class="mermaid">${md.utils.escapeHtml(
        token.content
      )}</pre></div>\n`;
    }
    if (lang === 'echarts') {
      return chartContainer('echarts-chart', token.content, lineAttrs, md);
    }
    if (lang === 'chart') {
      return chartContainer('obsidian-chart', token.content, lineAttrs, md);
    }
    return renderLineCommentableCode(token, lang, md, 'fence');
  };

  md.renderer.rules.code_block = (tokens, idx) =>
    renderLineCommentableCode(tokens[idx], '', md, 'indented');

  return { md, getFrontMatter: () => frontMatterRaw };
}

/** Inner highlighted HTML only — never a wrapping <pre>, so token attrs survive. */
function highlightInner(src: string, lang: string, md: MarkdownIt): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(src, { language: lang, ignoreIllegals: true }).value;
    } catch {
      /* fall through to plain escaped output */
    }
  }
  return md.utils.escapeHtml(src);
}

/**
 * Wrap each highlighted line in a leaf `span.md-code-line` whose
 * `data-source-line` is the matching Markdown source line (not the opening
 * fence). highlight.js may open a <span> on one line and close it on another;
 * carry those tags across so the HTML stays balanced.
 */
function wrapCodeLines(highlightedHtml: string, firstLine: number): string {
  const lines = highlightedHtml.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const stack: string[] = [];
  const tagRe = /<\/?span\b[^>]*>/gi;
  return lines
    .map((line, i) => {
      const reopen = stack.join('');
      tagRe.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = tagRe.exec(line))) {
        if (match[0].startsWith('</')) {
          stack.pop();
        } else {
          stack.push(match[0]);
        }
      }
      const close = stack.map(() => '</span>').join('');
      const n = firstLine + i;
      return `<span class="md-code-line" data-source-line="${n}" data-source-end="${n + 1}">${reopen}${line}${close}</span>`;
    })
    .join('');
}

function renderLineCommentableCode(
  token: Token,
  lang: string,
  md: MarkdownIt,
  kind: 'fence' | 'indented'
): string {
  const highlighted = highlightInner(token.content, lang, md);
  const firstContentLine =
    token.map != null
      ? kind === 'fence'
        ? token.map[0] + 1
        : token.map[0]
      : 0;
  const linesHtml = wrapCodeLines(highlighted, firstContentLine);
  const attrs = md.renderer.renderAttrs(token);
  const langClass = lang
    ? ` language-${md.utils.escapeHtml(lang)}`
    : '';
  return `<pre class="hljs"${attrs}><code class="hljs${langClass}">${linesHtml}</code></pre>\n`;
}

interface CoreState {
  tokens: Token[];
  src: string;
  Token: new (type: string, tag: string, nesting: number) => Token;
}

/** Strip `depth` CommonMark blockquote markers (`>` plus optional space). */
function stripQuotePrefix(line: string, depth: number): string {
  let rest = line.replace(/\r$/, '');
  for (let d = 0; d < depth; d++) {
    const match = /^ {0,3}> ?/.exec(rest);
    if (!match) {
      break;
    }
    rest = rest.slice(match[0].length);
  }
  return rest;
}

/**
 * Consecutive `>` lines without a blank line become one markdown-it paragraph,
 * so the preview can only comment the first source line. Split those
 * paragraphs (direct children of a quote/alert, not list items) into one
 * paragraph per source line — matching how ordinary body paragraphs work.
 */
function splitMultilineQuoteParagraphs(state: CoreState): void {
  const srcLines = state.src.split(/\r?\n/);
  const tokens = state.tokens;
  const out: Token[] = [];
  let quoteDepth = 0;
  let listDepth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'blockquote_open' || token.type === 'alert_open') {
      quoteDepth += 1;
      out.push(token);
      continue;
    }
    if (token.type === 'blockquote_close' || token.type === 'alert_close') {
      quoteDepth -= 1;
      out.push(token);
      continue;
    }
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      listDepth += 1;
      out.push(token);
      continue;
    }
    if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      listDepth -= 1;
      out.push(token);
      continue;
    }

    const inline = tokens[i + 1];
    const close = tokens[i + 2];
    if (
      quoteDepth > 0 &&
      listDepth === 0 &&
      token.type === 'paragraph_open' &&
      token.map &&
      token.map[1] - token.map[0] > 1 &&
      inline?.type === 'inline' &&
      close?.type === 'paragraph_close'
    ) {
      const [start, end] = token.map;
      for (let line = start; line < end; line++) {
        const content = stripQuotePrefix(srcLines[line] ?? '', quoteDepth);
        if (!content.trim()) {
          continue;
        }
        const open = new state.Token('paragraph_open', 'p', 1);
        open.map = [line, line + 1];
        open.block = true;
        open.level = token.level;
        const inlineTok = new state.Token('inline', '', 0);
        inlineTok.content = content;
        inlineTok.map = [line, line + 1];
        inlineTok.children = [];
        inlineTok.level = inline.level;
        const closeTok = new state.Token('paragraph_close', 'p', -1);
        closeTok.block = true;
        closeTok.level = close.level;
        out.push(open, inlineTok, closeTok);
      }
      i += 2;
      continue;
    }
    out.push(token);
  }
  state.tokens = out;
}

// The raw fence body is stashed in a hidden <pre> so it survives HTML escaping
// and round-trips through the DOM (the client reads textContent, auto-unescaped).
function chartContainer(
  className: string,
  content: string,
  lineAttrs: string,
  md: MarkdownIt
): string {
  return `<div class="md-chart ${className}"${lineAttrs}><pre class="chart-src" hidden>${md.utils.escapeHtml(
    content
  )}</pre><div class="chart-canvas"></div></div>\n`;
}

function formatScalar(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function formatValueHtml(value: unknown, md: MarkdownIt): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      return '';
    }
    return `<ul>${value
      .map((v) => `<li>${formatValueHtml(v, md)}</li>`)
      .join('')}</ul>`;
  }
  if (typeof value === 'object') {
    return `<code>${md.utils.escapeHtml(
      stringifyYaml(value).trimEnd()
    )}</code>`;
  }
  return md.utils.escapeHtml(formatScalar(value));
}

function renderFrontMatter(raw: string, md: MarkdownIt): string {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `<div class="frontmatter-error" role="alert"><strong>Failed to parse frontmatter</strong><pre>${md.utils.escapeHtml(
      message
    )}</pre></div>`;
  }

  if (parsed === null || parsed === undefined) {
    return '';
  }

  const entries =
    typeof parsed !== 'object' || Array.isArray(parsed)
      ? [['', parsed] as [string, unknown]]
      : Object.entries(parsed as Record<string, unknown>);

  if (!entries.length) {
    return '';
  }

  const rows = entries
    .map(
      ([key, value]) =>
        `<tr><th>${md.utils.escapeHtml(key)}</th><td>${formatValueHtml(
          value,
          md
        )}</td></tr>`
    )
    .join('');

  return `<table class="frontmatter" title="Frontmatter"><tbody>${rows}</tbody></table>`;
}

/** Renders a Markdown string to body + frontmatter HTML. */
export function renderMarkdown(markdown: string): RenderResult {
  const { md, getFrontMatter } = createMd();
  const html = md.render(markdown);
  const fm = getFrontMatter();
  return {
    html,
    propertiesHtml: fm ? renderFrontMatter(fm, md) : '',
  };
}
