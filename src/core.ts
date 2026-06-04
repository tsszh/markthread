export interface ReviewComment {
  line: number;
  lineText: string;
  comment: string;
}

export interface ReviewThread {
  file: string;
  comments: ReviewComment[];
}

export const STRUCTURED_HEADER = `# AI Review Comments

Please address the following review comments on the Markdown document below.
Each item references a specific line number and the quoted source line.

---

`;

export function formatStructured(threads: ReviewThread[]): string {
  if (threads.length === 0) {
    return STRUCTURED_HEADER + '(No review comments yet.)\n';
  }

  const sections: string[] = [];

  for (const thread of threads) {
    for (const item of thread.comments) {
      sections.push(
        [
          `file: ${thread.file}`,
          `Line ${item.line + 1}`,
          `> ${item.lineText.trim()}`,
          '',
          item.comment,
          '',
          '---',
          '',
        ].join('\n')
      );
    }
  }

  return STRUCTURED_HEADER + sections.join('\n');
}
