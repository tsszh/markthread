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
