export interface ReviewComment {
  line: number;
  lineText: string;
  comment: string;
}

export interface ReviewThread {
  file: string;
  comments: ReviewComment[];
}

/**
 * Default prefix prepended to the copied review. Must stay in sync with the
 * `markThread.copy.headerTemplate` default declared in package.json.
 */
export const STRUCTURED_HEADER = `# Review Comments

Please address the following review comments on the Markdown document below.
Each item quotes the source line it refers to.

---

`;

export interface FormatOptions {
  includeFileName: boolean;
  includeLineNumber: boolean;
  includeLineText: boolean;
  includeComment: boolean;
  headerTemplate: string;
}

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  includeFileName: false,
  includeLineNumber: false,
  includeLineText: true,
  includeComment: true,
  headerTemplate: STRUCTURED_HEADER,
};

export function formatStructured(
  threads: ReviewThread[],
  options?: Partial<FormatOptions>
): string {
  const opts: FormatOptions = { ...DEFAULT_FORMAT_OPTIONS, ...options };

  let header = opts.headerTemplate;
  if (header.length > 0 && !header.endsWith('\n')) {
    header += '\n\n';
  }

  if (threads.length === 0) {
    return header + '(No review comments yet.)\n';
  }

  const sections: string[] = [];

  for (const thread of threads) {
    for (const item of thread.comments) {
      const parts: string[] = [];
      if (opts.includeFileName) {
        parts.push(`file: ${thread.file}`);
      }
      if (opts.includeLineNumber) {
        parts.push(`Line ${item.line + 1}`);
      }
      if (opts.includeLineText) {
        parts.push(`> ${item.lineText.trim()}`);
      }
      if (opts.includeComment) {
        if (parts.length > 0) {
          parts.push('');
        }
        parts.push(item.comment);
      }
      parts.push('', '---', '');
      sections.push(parts.join('\n'));
    }
  }

  return header + sections.join('\n');
}
