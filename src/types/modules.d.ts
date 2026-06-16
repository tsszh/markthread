// Minimal ambient declarations for markdown-it plugins that ship without types.
declare module 'markdown-it-github-alerts' {
  import type MarkdownIt from 'markdown-it';
  const plugin: (md: MarkdownIt, options?: unknown) => void;
  export default plugin;
}

declare module 'markdown-it-front-matter' {
  import type MarkdownIt from 'markdown-it';
  const plugin: (md: MarkdownIt, callback: (frontMatter: string) => void) => void;
  export default plugin;
}

declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it';
  const plugin: (md: MarkdownIt, options?: unknown) => void;
  export default plugin;
}
