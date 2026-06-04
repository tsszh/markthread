import * as vscode from 'vscode';
import { ReviewComment, ReviewThread } from './core';

let commentIdCounter = 1;

/**
 * Concrete vscode.Comment used for review notes. Keeps a back-reference to its
 * parent thread so per-comment commands (delete) can locate it reliably.
 */
export class ReviewCommentItem implements vscode.Comment {
  readonly id: number;
  label: string | undefined;

  constructor(
    public body: string | vscode.MarkdownString,
    public mode: vscode.CommentMode,
    public author: vscode.CommentAuthorInformation,
    public parent?: vscode.CommentThread
  ) {
    this.id = commentIdCounter++;
  }
}

export class MarkdownCommentController {
  readonly controller: vscode.CommentController;

  /**
   * Threads created through the native `+` gutter button are owned by VS Code
   * and are surfaced to us via the submit/reply command's CommentReply.thread.
   * We track every thread we have seen so export/clear can operate on them.
   */
  private readonly threads = new Set<vscode.CommentThread>();

  private readonly author: vscode.CommentAuthorInformation = {
    name: 'Reviewer',
  };

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** Fires whenever the set of tracked threads/comments changes. */
  readonly onDidChange = this._onDidChange.event;

  constructor(context: vscode.ExtensionContext) {
    this.controller = vscode.comments.createCommentController(
      'md-ai-reviewer',
      'Markdown AI Reviewer'
    );

    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (document: vscode.TextDocument) => {
        if (document.languageId !== 'markdown') {
          return [];
        }

        const lastLine = Math.max(0, document.lineCount - 1);
        return [
          new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(lastLine, document.lineAt(lastLine).text.length)
          ),
        ];
      },
    };

    this.controller.options = {
      prompt: 'Add an AI review comment for this line',
      placeHolder: 'Describe the review feedback for this line...',
    };

    context.subscriptions.push(this.controller);
  }

  /** Appends a comment to the thread supplied by VS Code and tracks the thread. */
  addComment(reply: vscode.CommentReply): vscode.CommentThread {
    const thread = reply.thread;
    const comment = new ReviewCommentItem(
      reply.text,
      vscode.CommentMode.Preview,
      this.author,
      thread
    );

    thread.comments = [...thread.comments, comment];
    const line = thread.range ? thread.range.start.line + 1 : 0;
    thread.label = `AI review · line ${line}`;
    thread.contextValue = 'mdAiReviewerThread';
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;

    this.threads.add(thread);
    this._onDidChange.fire();
    return thread;
  }

  deleteComment(comment: ReviewCommentItem): void {
    const thread = comment.parent;
    if (!thread) {
      return;
    }

    thread.comments = thread.comments.filter(
      (item) => (item as ReviewCommentItem).id !== comment.id
    );

    if (thread.comments.length === 0) {
      this.threads.delete(thread);
      thread.dispose();
    }
    this._onDidChange.fire();
  }

  deleteThread(thread: vscode.CommentThread): void {
    this.threads.delete(thread);
    thread.dispose();
    this._onDidChange.fire();
  }

  clearAll(): void {
    for (const thread of this.threads) {
      thread.dispose();
    }
    this.threads.clear();
    this._onDidChange.fire();
  }

  /**
   * Rehydrates threads from persisted sidecar data (see storage.ts), taking
   * structured comments (with author). Idempotent on (line, body), so reloading
   * the same sidecar never duplicates. Returns the number of comments added.
   */
  loadStoredComments(
    document: vscode.TextDocument,
    stored: {
      line: number;
      comments: { author: string; body: string }[];
    }[]
  ): number {
    if (document.languageId !== 'markdown') {
      return 0;
    }

    let added = 0;

    for (const entry of stored) {
      if (entry.line < 0 || entry.line >= document.lineCount) {
        continue;
      }

      let thread = [...this.threads].find(
        (item) =>
          item.uri.toString() === document.uri.toString() &&
          item.range &&
          item.range.start.line === entry.line
      );

      if (!thread) {
        const lineLength = document.lineAt(entry.line).text.length;
        const range = new vscode.Range(entry.line, 0, entry.line, lineLength);
        thread = this.controller.createCommentThread(document.uri, range, []);
      }

      for (const stContent of entry.comments) {
        const exists = thread.comments.some((item) => {
          const body =
            item.body instanceof vscode.MarkdownString
              ? item.body.value
              : String(item.body);
          return body === stContent.body;
        });
        if (exists) {
          continue;
        }

        const comment = new ReviewCommentItem(
          stContent.body,
          vscode.CommentMode.Preview,
          { name: stContent.author || 'Reviewer' },
          thread
        );
        thread.comments = [...thread.comments, comment];
        added++;
      }

      thread.label = `AI review · line ${entry.line + 1}`;
      thread.contextValue = 'mdAiReviewerThread';
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
      this.threads.add(thread);
    }

    if (added > 0) {
      this._onDidChange.fire();
    }
    return added;
  }

  /** Tracked threads that currently have at least one comment and a range. */
  getThreads(): vscode.CommentThread[] {
    return [...this.threads].filter(
      (thread) => thread.comments.length > 0 && !!thread.range
    );
  }

  /** Expands or collapses every tracked comment thread shown in the editor. */
  setAllCollapsibleState(
    state: vscode.CommentThreadCollapsibleState
  ): void {
    for (const thread of this.threads) {
      thread.collapsibleState = state;
    }
  }

  hasComments(document?: vscode.TextDocument): boolean {
    return this.collectReviewThreads(document).some(
      (thread) => thread.comments.length > 0
    );
  }

  collectReviewThreads(document?: vscode.TextDocument): ReviewThread[] {
    const grouped = new Map<string, ReviewComment[]>();

    for (const thread of this.threads) {
      if (thread.comments.length === 0) {
        continue;
      }
      if (document && thread.uri.toString() !== document.uri.toString()) {
        continue;
      }
      if (!thread.range) {
        continue;
      }

      const file = vscode.workspace.asRelativePath(thread.uri);
      const doc = vscode.workspace.textDocuments.find(
        (item) => item.uri.toString() === thread.uri.toString()
      );
      const line = thread.range.start.line;
      const lineText = doc?.lineAt(line).text ?? '';

      for (const comment of thread.comments) {
        const body =
          comment.body instanceof vscode.MarkdownString
            ? comment.body.value
            : String(comment.body);

        const comments = grouped.get(file) ?? [];
        comments.push({ line, lineText, comment: body });
        grouped.set(file, comments);
      }
    }

    return [...grouped.entries()].map(([file, comments]) => ({
      file,
      comments: comments.sort((a, b) => a.line - b.line),
    }));
  }

  dispose(): void {
    this.clearAll();
    this._onDidChange.dispose();
    this.controller.dispose();
  }
}
