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
    highlight: (str: string, lang: string): string => {
      const escaped = md.utils.escapeHtml(str);
      if (lang && hljs.getLanguage(lang)) {
        try {
          const out = hljs.highlight(str, {
            language: lang,
            ignoreIllegals: true,
          }).value;
          return `<pre class="hljs"><code class="hljs language-${lang}">${out}</code></pre>`;
        } catch {
          /* fall through to plain escaped output */
        }
      }
      return `<pre class="hljs"><code class="hljs">${escaped}</code></pre>`;
    },
  });

  md.use(markdownItGithubAlerts);
  md.use(taskLists, { enabled: true, label: true });
  md.use(frontMatter, (fm: string) => {
    frontMatterRaw = fm;
  });

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
  const defaultFence =
    md.renderer.rules.fence?.bind(md.renderer.rules) ??
    ((tokens, idx, options, _env, self) =>
      self.renderToken(tokens, idx, options));

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info = token.info.trim().toLowerCase();
    const lineAttrs = token.map
      ? ` data-source-line="${token.map[0]}" data-source-end="${token.map[1]}"`
      : '';

    if (info === 'mermaid') {
      // Wrap the diagram so the per-line comment marker anchors to the wrapper,
      // not the <pre> Mermaid renders from. Mermaid reads the element's
      // textContent asynchronously, so a marker appended directly into the
      // <pre> would corrupt the diagram source ("Syntax error in text").
      return `<div class="md-diagram mermaid-block"${lineAttrs}><pre class="mermaid">${md.utils.escapeHtml(
        token.content
      )}</pre></div>\n`;
    }
    if (info === 'echarts') {
      return chartContainer('echarts-chart', token.content, lineAttrs, md);
    }
    if (info === 'chart') {
      return chartContainer('obsidian-chart', token.content, lineAttrs, md);
    }
    return defaultFence(tokens, idx, options, env, self);
  };

  return { md, getFrontMatter: () => frontMatterRaw };
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
