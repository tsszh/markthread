import * as vscode from 'vscode';
import { ReviewComment, ReviewThread } from './core';
import { StoredThread } from './storage';

let commentIdCounter = 1;

/**
 * Concrete vscode.Comment used for review notes. Keeps a back-reference to its
 * parent thread so per-comment commands (delete) can locate it reliably.
 */
export class ReviewCommentItem implements vscode.Comment {
  readonly id: number;
  label: string | undefined;
  /** Body as of the last save, restored when an edit is cancelled. */
  savedBody: string;
  /** Enables the edit/delete menu items declared in package.json. */
  contextValue = 'editable';

  constructor(
    public body: string | vscode.MarkdownString,
    public mode: vscode.CommentMode,
    public author: vscode.CommentAuthorInformation,
    public parent?: vscode.CommentThread
  ) {
    this.id = commentIdCounter++;
    this.savedBody = typeof body === 'string' ? body : body.value;
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

  /**
   * Selection-anchored threads authored in the custom preview, kept in memory
   * per document URI. The native gutter only models whole-line threads, so
   * selection threads live here (and in the sidecar once explicitly saved)
   * instead of being written to disk on every edit.
   */
  private readonly selectionThreads = new Map<string, StoredThread[]>();

  private readonly author: vscode.CommentAuthorInformation = {
    name: 'Reviewer',
  };

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** Fires whenever the set of tracked threads/comments changes. */
  readonly onDidChange = this._onDidChange.event;

  /** Location of the thread that most recently gained or changed a comment. */
  private _lastActive: { uri: string; line: number } | undefined;
  get lastActive(): { uri: string; line: number } | undefined {
    return this._lastActive;
  }

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
      prompt: '💬 Add review comment',
      placeHolder: 'Write a review comment... (Enter to submit)',
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
    if (thread.range) {
      this._lastActive = {
        uri: thread.uri.toString(),
        line: thread.range.start.line,
      };
    }
    this._onDidChange.fire();
    return thread;
  }

  /**
   * Appends a quick-reply comment to the tracked thread at (uri, line).
   * Returns false when no such thread exists or the text is blank.
   */
  addQuickReply(uri: string, line: number, text: string): boolean {
    const body = text.trim();
    if (!body) {
      return false;
    }

    const thread = [...this.threads].find(
      (item) =>
        item.uri.toString() === uri &&
        !!item.range &&
        item.range.start.line === line
    );
    if (!thread) {
      return false;
    }

    const comment = new ReviewCommentItem(
      body,
      vscode.CommentMode.Preview,
      this.author,
      thread
    );
    thread.comments = [...thread.comments, comment];
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    this._lastActive = { uri, line };
    this._onDidChange.fire();
    return true;
  }

  /** Switches a comment into inline editing mode. */
  editComment(comment: ReviewCommentItem): void {
    const thread = comment.parent;
    if (!thread) {
      return;
    }
    thread.comments = thread.comments.map((item) => {
      if ((item as ReviewCommentItem).id === comment.id) {
        item.mode = vscode.CommentMode.Editing;
      }
      return item;
    });
  }

  /** Persists the edited body (VS Code mutates `body` while editing). */
  saveComment(comment: ReviewCommentItem): void {
    const thread = comment.parent;
    if (!thread) {
      return;
    }
    thread.comments = thread.comments.map((item) => {
      const reviewItem = item as ReviewCommentItem;
      if (reviewItem.id === comment.id) {
        reviewItem.savedBody =
          typeof reviewItem.body === 'string'
            ? reviewItem.body
            : reviewItem.body.value;
        reviewItem.mode = vscode.CommentMode.Preview;
      }
      return item;
    });
    if (thread.range) {
      this._lastActive = {
        uri: thread.uri.toString(),
        line: thread.range.start.line,
      };
    }
    this._onDidChange.fire();
  }

  /**
   * Cancels every comment currently in editing mode (used by the Escape
   * keybinding, which has no specific comment argument). Returns whether any
   * edit was actually cancelled.
   */
  cancelAllEdits(): boolean {
    let cancelled = false;
    for (const thread of this.threads) {
      if (
        !thread.comments.some(
          (item) => item.mode === vscode.CommentMode.Editing
        )
      ) {
        continue;
      }
      thread.comments = thread.comments.map((item) => {
        const reviewItem = item as ReviewCommentItem;
        if (reviewItem.mode === vscode.CommentMode.Editing) {
          reviewItem.body = reviewItem.savedBody;
          reviewItem.mode = vscode.CommentMode.Preview;
          cancelled = true;
        }
        return item;
      });
    }
    return cancelled;
  }

  /** Discards an in-progress edit and restores the last saved body. */
  cancelEditComment(comment: ReviewCommentItem): void {
    const thread = comment.parent;
    if (!thread) {
      return;
    }
    thread.comments = thread.comments.map((item) => {
      const reviewItem = item as ReviewCommentItem;
      if (reviewItem.id === comment.id) {
        reviewItem.body = reviewItem.savedBody;
        reviewItem.mode = vscode.CommentMode.Preview;
      }
      return item;
    });
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
    this.selectionThreads.clear();
    this._onDidChange.fire();
  }

  /** In-memory selection-anchored threads for a document (preview-authored). */
  getSelectionThreads(uri: string): StoredThread[] {
    return this.selectionThreads.get(uri) ?? [];
  }

  /** Replaces the in-memory selection threads for a document (no disk write). */
  setSelectionThreads(uri: string, threads: StoredThread[]): void {
    if (threads.length > 0) {
      this.selectionThreads.set(uri, threads);
    } else {
      this.selectionThreads.delete(uri);
    }
    this._onDidChange.fire();
  }

  /**
   * Removes every tracked thread for a document. Used by the custom preview to
   * reconcile the native gutter with the (authoritative) preview thread set
   * before re-adding, so deletions made in the preview also clear the gutter.
   */
  removeThreadsForUri(uri: string): void {
    for (const thread of [...this.threads]) {
      if (thread.uri.toString() === uri) {
        this.threads.delete(thread);
        thread.dispose();
      }
    }
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
      // The document may have shrunk since the thread was created.
      const lineText =
        doc && line < doc.lineCount ? doc.lineAt(line).text : '';

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

    // Include preview-authored selection threads kept in memory.
    for (const [uri, list] of this.selectionThreads) {
      if (document && uri !== document.uri.toString()) {
        continue;
      }
      const file = vscode.workspace.asRelativePath(vscode.Uri.parse(uri));
      for (const thread of list) {
        const comments = grouped.get(file) ?? [];
        for (const c of thread.comments) {
          comments.push({
            line: thread.line,
            lineText: thread.lineText,
            comment: c.body,
          });
        }
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
