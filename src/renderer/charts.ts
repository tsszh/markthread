// Pure helpers that turn fenced chart sources into chart library configs.
// Kept free of DOM/library imports so they can be unit-tested under Node.
import { parse as parseYaml } from 'yaml';

/** Parses an ECharts option from a fenced ```echarts block. */
export function parseEchartsOption(source: string): Record<string, unknown> {
  const text = source.trim();
  if (!text) {
    throw new Error('Empty ECharts option.');
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Obsidian's echarts plugin allows a JS object literal (and even `option =`
    // assignments). Evaluate as an expression as a best-effort fallback.
    const body = text.replace(/^\s*(?:const|let|var)?\s*option\s*=\s*/, '');
    const value = new Function(`"use strict";return (${body});`)();
    if (value && typeof value === 'object') {
      return value as Record<string, unknown>;
    }
    throw new Error('ECharts option did not evaluate to an object.');
  }
}

const DEFAULT_CHART_COLORS = [
  '#3b6fe0',
  '#1f9d6b',
  '#d98a00',
  '#d64545',
  '#7b61ff',
  '#0ca5b0',
  '#e0518b',
  '#5a6acf',
];

interface ObsidianChartSpec {
  type?: string;
  labels?: unknown[];
  series?: { title?: string; data?: unknown[] }[];
  beginAtZero?: boolean;
  stacked?: boolean;
  tension?: number;
  fill?: boolean;
  legend?: boolean;
  legendPosition?: string;
  title?: string;
}

/**
 * Converts an Obsidian Charts (```chart) YAML spec into a Chart.js config.
 * Supports the common bar/line/pie/doughnut/radar/polarArea forms.
 */
export function obsidianChartToChartJs(source: string): {
  type: string;
  data: unknown;
  options: Record<string, unknown>;
} {
  const spec = (parseYaml(source) ?? {}) as ObsidianChartSpec;
  const type = (spec.type ?? 'bar').toLowerCase();
  const labels = Array.isArray(spec.labels) ? spec.labels : [];
  const series = Array.isArray(spec.series) ? spec.series : [];

  const isCircular = ['pie', 'doughnut', 'polararea'].includes(type);
  const chartType = type === 'polararea' ? 'polarArea' : type;

  const datasets = series.map((s, i) => {
    const color = DEFAULT_CHART_COLORS[i % DEFAULT_CHART_COLORS.length];
    const data = Array.isArray(s.data) ? s.data : [];
    if (isCircular) {
      return {
        label: s.title ?? `Series ${i + 1}`,
        data,
        backgroundColor: data.map(
          (_v, j) => DEFAULT_CHART_COLORS[j % DEFAULT_CHART_COLORS.length]
        ),
      };
    }
    return {
      label: s.title ?? `Series ${i + 1}`,
      data,
      backgroundColor: color,
      borderColor: color,
      fill: spec.fill ?? false,
      tension: spec.tension ?? 0.3,
    };
  });

  const options: Record<string, unknown> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: spec.legend !== false,
        position: spec.legendPosition ?? 'top',
      },
      title: spec.title
        ? { display: true, text: spec.title }
        : { display: false },
    },
  };

  if (!isCircular) {
    options.scales = {
      x: { stacked: !!spec.stacked },
      y: { stacked: !!spec.stacked, beginAtZero: spec.beginAtZero !== false },
    };
  }

  return { type: chartType, data: { labels, datasets }, options };
}
