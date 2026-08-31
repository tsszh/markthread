import * as assert from 'assert';
import { renderMarkdown } from '../../renderer/markdownRenderer';
import {
  obsidianChartToChartJs,
  parseEchartsOption,
} from '../../renderer/charts';
import { parseReview, serializeReview, StoredReview } from '../../storage';

suite('Markdown Renderer Suite', () => {
  test('annotates block elements with source line numbers', () => {
    const { html } = renderMarkdown('# Title\n\nHello world\n');
    // Heading starts on source line 0, paragraph on line 2.
    assert.ok(/<h1[^>]*data-source-line="0"/.test(html), html);
    assert.ok(/<p[^>]*data-source-line="2"/.test(html), html);
  });

  test('renders frontmatter into a Properties table', () => {
    const md = '---\ntitle: Hi\n---\n\n# Body\n';
    const { propertiesHtml } = renderMarkdown(md);
    assert.ok(propertiesHtml.includes('table'));
    assert.ok(propertiesHtml.includes('title'));
    assert.ok(propertiesHtml.includes('Hi'));
  });

  test('mermaid fence becomes a client-rendered pre.mermaid', () => {
    const { html } = renderMarkdown('```mermaid\nflowchart TD\n A-->B\n```\n');
    assert.ok(html.includes('<pre class="mermaid"'));
    assert.ok(html.includes('flowchart TD'));
  });

  test('echarts fence becomes an echarts-chart container with source', () => {
    const { html } = renderMarkdown('```echarts\n{"x":1}\n```\n');
    assert.ok(html.includes('echarts-chart'));
    assert.ok(html.includes('chart-src'));
    // JSON quotes are HTML-escaped inside the hidden source pre.
    assert.ok(html.includes('&quot;x&quot;:1'));
  });

  test('chart fence becomes an obsidian-chart container', () => {
    const { html } = renderMarkdown('```chart\ntype: bar\n```\n');
    assert.ok(html.includes('obsidian-chart'));
    assert.ok(html.includes('chart-src'));
  });

  test('unknown fences fall back to highlighted code blocks', () => {
    const { html } = renderMarkdown('```js\nconst a = 1;\n```\n');
    assert.ok(html.includes('hljs'));
    assert.ok(!html.includes('echarts-chart'));
  });

  test('blockquote source lines each get their own data-source-line', () => {
    const md = [
      '> **Winona Spotlight**',
      '> The spotlight searches the arena for players.',
      '> It keeps tracking even if the player hides.',
      '> After a power loss the spotlight goes dark.',
      '',
    ].join('\n');
    const { html } = renderMarkdown(md);
    assert.ok(/<p[^>]*data-source-line="0"/.test(html), html);
    assert.ok(/<p[^>]*data-source-line="1"/.test(html), html);
    assert.ok(/<p[^>]*data-source-line="2"/.test(html), html);
    assert.ok(/<p[^>]*data-source-line="3"/.test(html), html);
    assert.ok(html.includes('Winona Spotlight'), html);
    assert.ok(html.includes('spotlight goes dark'), html);
  });

  test('blockquote keeps emphasis that spans quoted source lines', () => {
    const md = '> *emphasized\n> text*\n';
    const { html } = renderMarkdown(md);
    assert.ok(html.includes('<em>'), html);
    assert.ok(!html.includes('*emphasized'), html);
    assert.ok(/<p[^>]*data-source-line="0"/.test(html), html);
    assert.ok(/<p[^>]*data-source-line="1"/.test(html), html);
  });

  test('GitHub alert title and body lines are independently commentable', () => {
    const md = [
      '> [!CAUTION] Winona\'s Spotlight',
      '> The spotlight searches the arena for players.',
      '> After a power loss the spotlight goes dark.',
      '',
    ].join('\n');
    const { html } = renderMarkdown(md);
    assert.ok(
      /<p class="markdown-alert-title"[^>]*data-source-line="0"/.test(html),
      html
    );
    assert.ok(/<p[^>]*data-source-line="1"/.test(html), html);
    assert.ok(/<p[^>]*data-source-line="2"/.test(html), html);
    assert.ok(html.includes("Winona's Spotlight"), html);
    assert.ok(html.includes('spotlight goes dark'), html);
  });

  test('fenced code lines map to content source lines, not the opening fence', () => {
    const md = [
      '```js',
      'const a = 1;',
      'const b = 2;',
      'const c = 3;',
      '```',
      '',
    ].join('\n');
    const { html } = renderMarkdown(md);
    assert.ok(html.includes('md-code-line'), html);
    assert.ok(
      /<span class="md-code-line"[^>]*data-source-line="1"/.test(html),
      html
    );
    assert.ok(
      /<span class="md-code-line"[^>]*data-source-line="2"/.test(html),
      html
    );
    assert.ok(
      /<span class="md-code-line"[^>]*data-source-line="3"/.test(html),
      html
    );
    // Opening fence is source line 0 and must not steal comments from line 1.
    assert.ok(
      !/<span class="md-code-line"[^>]*data-source-line="0"/.test(html),
      html
    );
    // highlight.js wraps tokens, so the raw `const a = 1;` string is not contiguous.
    assert.ok(html.includes('hljs-keyword'), html);
    assert.ok(html.includes('a ='), html);
    assert.ok(html.includes('c ='), html);
  });

  test('fenced code line numbers follow the document source', () => {
    const md = '# Title\n\n```js\nconst a = 1;\nconst b = 2;\n```\n';
    const { html } = renderMarkdown(md);
    // `# Title` is line 0, blank 1, opening fence 2, first code line 3.
    assert.ok(
      /<span class="md-code-line"[^>]*data-source-line="3"/.test(html),
      html
    );
    assert.ok(
      /<span class="md-code-line"[^>]*data-source-line="4"/.test(html),
      html
    );
  });

  test('blockquote line numbers follow the document source', () => {
    const md = '# Title\n\n> alpha\n> beta\n';
    const { html } = renderMarkdown(md);
    assert.ok(/<p[^>]*data-source-line="2"/.test(html), html);
    assert.ok(/<p[^>]*data-source-line="3"/.test(html), html);
  });

  test('indented code lines keep their own source line numbers', () => {
    const md = '    const a = 1;\n    const b = 2;\n';
    const { html } = renderMarkdown(md);
    assert.ok(
      /<span class="md-code-line"[^>]*data-source-line="0"/.test(html),
      html
    );
    assert.ok(
      /<span class="md-code-line"[^>]*data-source-line="1"/.test(html),
      html
    );
  });
});

suite('Charts Suite', () => {
  test('parses ECharts option from JSON', () => {
    assert.deepStrictEqual(parseEchartsOption('{"a":1}'), { a: 1 });
  });

  test('parses ECharts option from a JS object literal', () => {
    assert.deepStrictEqual(parseEchartsOption('{ a: 2, b: [1,2] }'), {
      a: 2,
      b: [1, 2],
    });
  });

  test('parses ECharts option from an `option =` assignment', () => {
    assert.deepStrictEqual(parseEchartsOption('option = { a: 3 }'), { a: 3 });
  });

  test('converts an Obsidian chart spec to a Chart.js config', () => {
    const config = obsidianChartToChartJs(
      'type: bar\nlabels: [A, B]\nseries:\n  - title: S1\n    data: [1, 2]\n'
    );
    assert.strictEqual(config.type, 'bar');
    const data = config.data as {
      labels: unknown[];
      datasets: { label: string; data: unknown[] }[];
    };
    assert.deepStrictEqual(data.labels, ['A', 'B']);
    assert.strictEqual(data.datasets[0].label, 'S1');
    assert.deepStrictEqual(data.datasets[0].data, [1, 2]);
  });

  test('defaults to a bar chart when type is omitted', () => {
    const config = obsidianChartToChartJs('labels: [A]\nseries: []\n');
    assert.strictEqual(config.type, 'bar');
  });
});

suite('Storage Selection Schema Suite', () => {
  test('round-trips a thread with a selection', () => {
    const review: StoredReview = {
      version: 1,
      comments: [
        {
          line: 3,
          lineText: 'some text',
          selection: {
            startLine: 3,
            startChar: 2,
            endLine: 3,
            endChar: 6,
            text: 'some',
          },
          comments: [{ author: 'Reviewer', body: 'Pick a better word' }],
        },
      ],
    };

    const parsed = parseReview(serializeReview(review));
    assert.ok(parsed);
    assert.deepStrictEqual(parsed!.comments[0].selection, review.comments[0].selection);
    assert.strictEqual(parsed!.comments[0].comments[0].body, 'Pick a better word');
  });

  test('still parses legacy sidecars without a selection field', () => {
    const legacy = JSON.stringify({
      version: 1,
      comments: [
        {
          line: 0,
          lineText: 'heading',
          comments: [{ author: 'Reviewer', body: 'ok' }],
        },
      ],
    });

    const parsed = parseReview(legacy);
    assert.ok(parsed);
    assert.strictEqual(parsed!.comments[0].selection, undefined);
    assert.strictEqual(parsed!.comments[0].comments[0].body, 'ok');
  });
});
