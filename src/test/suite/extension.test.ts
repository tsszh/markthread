import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  DEFAULT_FORMAT_OPTIONS,
  formatStructured,
  STRUCTURED_HEADER,
} from '../../core';
import { MarkdownCommentController, ReviewCommentItem } from '../../comments';
import { buildPanelModel } from '../../reviewPanel';
import {
  DEFAULT_QUICK_REPLIES,
  readSettings,
  resetSettings,
  writeSettings,
} from '../../settings';
import {
  deleteReview,
  isReviewableMarkdownDocument,
  parseReview,
  readReview,
  serializeReview,
  writeReview,
} from '../../storage';

const SAMPLE_THREADS = [
  {
    file: 'docs/example.md',
    comments: [
      {
        line: 4,
        lineText: 'const value = 1;',
        comment: 'Consider extracting this magic number.',
      },
    ],
  },
];

suite('Core Test Suite', () => {
  test('default copy output has line content + comment, no file name or line number', () => {
    const result = formatStructured(SAMPLE_THREADS);

    assert.ok(result.startsWith(STRUCTURED_HEADER));
    assert.ok(!result.includes('file: docs/example.md'));
    assert.ok(!result.includes('Line 5'));
    assert.ok(result.includes('> const value = 1;'));
    assert.ok(result.includes('Consider extracting this magic number.'));
  });

  test('default format options match the spec', () => {
    assert.deepStrictEqual(DEFAULT_FORMAT_OPTIONS, {
      includeFileName: false,
      includeLineNumber: false,
      includeLineText: true,
      includeComment: true,
      headerTemplate: STRUCTURED_HEADER,
    });
  });

  test('includeFileName and includeLineNumber add those fields', () => {
    const result = formatStructured(SAMPLE_THREADS, {
      includeFileName: true,
      includeLineNumber: true,
    });

    assert.ok(result.includes('file: docs/example.md'));
    assert.ok(result.includes('Line 5'));
    assert.ok(result.includes('> const value = 1;'));
    assert.ok(result.includes('Consider extracting this magic number.'));
  });

  test('fields can be excluded individually', () => {
    const result = formatStructured(SAMPLE_THREADS, {
      includeLineText: false,
    });

    assert.ok(!result.includes('> const value = 1;'));
    assert.ok(result.includes('Consider extracting this magic number.'));

    const noComment = formatStructured(SAMPLE_THREADS, {
      includeComment: false,
    });
    assert.ok(noComment.includes('> const value = 1;'));
    assert.ok(!noComment.includes('Consider extracting this magic number.'));
  });

  test('custom header template is used as prefix', () => {
    const result = formatStructured(SAMPLE_THREADS, {
      headerTemplate: 'My custom prompt:',
    });

    assert.ok(result.startsWith('My custom prompt:\n\n'));
    assert.ok(!result.includes(STRUCTURED_HEADER));
  });

  test('empty header template produces no prefix', () => {
    const result = formatStructured(SAMPLE_THREADS, { headerTemplate: '' });
    assert.ok(result.startsWith('> const value = 1;'));
  });
});

suite('Storage Suite', () => {
  test('serializeReview/parseReview round-trip', () => {
    const review = {
      version: 1,
      comments: [
        {
          line: 3,
          lineText: 'beta',
          comments: [{ author: 'songz', body: 'tighten wording' }],
        },
      ],
    };
    assert.deepStrictEqual(parseReview(serializeReview(review)), review);
  });

  test('parseReview rejects invalid payloads', () => {
    assert.strictEqual(parseReview('not json'), undefined);
    assert.strictEqual(parseReview('{}'), undefined);
  });

  test('sidecar write/read/delete round-trips on disk', async () => {
    const docUri = vscode.Uri.file(
      path.join(os.tmpdir(), `md-ai-reviewer-${Date.now()}.md`)
    );
    const review = {
      version: 1,
      comments: [
        {
          line: 1,
          lineText: 'second line',
          comments: [{ author: 'songz', body: 'please revise' }],
        },
      ],
    };

    await writeReview(docUri, review);
    assert.deepStrictEqual(await readReview(docUri), review);

    await deleteReview(docUri);
    assert.strictEqual(await readReview(docUri), undefined);
  });
});

suite('Reviewable Document Suite', () => {
  test('untitled markdown documents are reviewable', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: '# unsaved note',
    });
    assert.strictEqual(document.uri.scheme, 'untitled');
    assert.strictEqual(isReviewableMarkdownDocument(document), true);
  });

  test('non-markdown documents are not reviewable', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'plaintext',
      content: 'plain',
    });
    assert.strictEqual(isReviewableMarkdownDocument(document), false);
  });

  test('sidecar files are not reviewable', () => {
    const fake = {
      languageId: 'markdown',
      uri: vscode.Uri.file('/tmp/readme.md.ai-review.json'),
    } as vscode.TextDocument;
    assert.strictEqual(isReviewableMarkdownDocument(fake), false);
  });
});

suite('Extension Test Suite', () => {
  test('Extension activates for markdown', async () => {
    const extension = vscode.extensions.getExtension('local.md-ai-reviewer');
    assert.ok(extension, 'Extension should be discoverable');
    await extension!.activate();
    assert.strictEqual(extension!.isActive, true);
  });

  test('All commands are registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    const expected = [
      'md-ai-reviewer.copyToClipboard',
      'md-ai-reviewer.saveToFile',
      'md-ai-reviewer.loadFromFile',
      'md-ai-reviewer.clearAll',
      'md-ai-reviewer.submit',
      'md-ai-reviewer.createComment',
      'md-ai-reviewer.replyComment',
      'md-ai-reviewer.deleteComment',
      'md-ai-reviewer.deleteThread',
      'md-ai-reviewer.editComment',
      'md-ai-reviewer.saveComment',
      'md-ai-reviewer.cancelEditComment',
      'md-ai-reviewer.cancelEdit',
      'md-ai-reviewer.quickReply',
      'md-ai-reviewer.expandAllThreads',
      'md-ai-reviewer.collapseAllThreads',
    ];

    for (const command of expected) {
      assert.ok(commands.includes(command), `Missing command: ${command}`);
    }
  });
});

suite('Settings Suite', () => {
  test('defaults: quick replies and copy options', () => {
    const settings = readSettings();
    assert.deepStrictEqual(settings.quickReplies, DEFAULT_QUICK_REPLIES);
    assert.deepStrictEqual(DEFAULT_QUICK_REPLIES, [
      'Looks good',
      'Confirmed',
      'No',
      'Please clarify',
      'Please fix',
      'TODO later',
    ]);
    assert.strictEqual(settings.includeFileName, false);
    assert.strictEqual(settings.includeLineNumber, false);
    assert.strictEqual(settings.includeLineText, true);
    assert.strictEqual(settings.includeComment, true);
    assert.strictEqual(settings.headerTemplate, STRUCTURED_HEADER);
  });

  test('writeSettings persists and resetSettings restores defaults', async () => {
    await writeSettings({
      includeFileName: true,
      includeLineText: false,
      quickReplies: ['custom reply'],
      headerTemplate: 'custom header',
    });

    let settings = readSettings();
    assert.strictEqual(settings.includeFileName, true);
    assert.strictEqual(settings.includeLineText, false);
    assert.deepStrictEqual(settings.quickReplies, ['custom reply']);
    assert.strictEqual(settings.headerTemplate, 'custom header');

    await resetSettings();
    settings = readSettings();
    assert.strictEqual(settings.includeFileName, false);
    assert.strictEqual(settings.includeLineText, true);
    assert.deepStrictEqual(settings.quickReplies, DEFAULT_QUICK_REPLIES);
    assert.strictEqual(settings.headerTemplate, STRUCTURED_HEADER);
  });
});

suite('Comment Tracking Suite', () => {
  let controller: MarkdownCommentController;
  let document: vscode.TextDocument;

  const fakeContext = {
    subscriptions: [] as { dispose(): void }[],
  } as unknown as vscode.ExtensionContext;

  suiteSetup(async () => {
    document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: 'line one\nline two\nline three',
    });
    await vscode.window.showTextDocument(document);
  });

  setup(() => {
    controller = new MarkdownCommentController(fakeContext);
  });

  teardown(() => {
    controller.dispose();
  });

  function reply(line: number, text: string): vscode.CommentReply {
    const thread = controller.controller.createCommentThread(
      document.uri,
      new vscode.Range(line, 0, line, 0),
      []
    );
    return { thread, text } as vscode.CommentReply;
  }

  test('addComment tracks the native thread so it can be exported', () => {
    controller.addComment(reply(1, 'This line needs work'));

    const threads = controller.collectReviewThreads(document);
    assert.strictEqual(threads.length, 1);
    assert.strictEqual(threads[0].comments.length, 1);
    assert.strictEqual(threads[0].comments[0].line, 1);
    assert.strictEqual(threads[0].comments[0].lineText, 'line two');
    assert.strictEqual(threads[0].comments[0].comment, 'This line needs work');

    const structured = formatStructured(threads, {
      includeLineNumber: true,
    });
    assert.ok(structured.includes('Line 2'));
    assert.ok(structured.includes('This line needs work'));
  });

  test('clearAll removes all tracked threads', () => {
    controller.addComment(reply(0, 'note A'));
    controller.addComment(reply(2, 'note B'));
    const before = controller.collectReviewThreads();
    const commentCount = before.reduce((sum, t) => sum + t.comments.length, 0);
    assert.strictEqual(commentCount, 2);

    controller.clearAll();
    assert.strictEqual(controller.collectReviewThreads().length, 0);
  });

  test('deleteComment removes the comment and empties the thread', () => {
    const r = reply(0, 'note to delete');
    controller.addComment(r);
    const comment = r.thread.comments[0] as ReviewCommentItem;

    controller.deleteComment(comment);
    assert.strictEqual(controller.collectReviewThreads().length, 0);
  });

  test('addComment expands the thread and records it as last active', () => {
    const r = reply(1, 'fresh note');
    const thread = controller.addComment(r);

    assert.strictEqual(
      thread.collapsibleState,
      vscode.CommentThreadCollapsibleState.Expanded
    );
    assert.deepStrictEqual(controller.lastActive, {
      uri: document.uri.toString(),
      line: 1,
    });
  });

  test('editComment / saveComment / cancelEditComment lifecycle', () => {
    const r = reply(0, 'original text');
    controller.addComment(r);
    const comment = r.thread.comments[0] as ReviewCommentItem;
    assert.strictEqual(comment.contextValue, 'editable');
    assert.strictEqual(comment.savedBody, 'original text');

    // Enter edit mode.
    controller.editComment(comment);
    assert.strictEqual(
      (r.thread.comments[0] as ReviewCommentItem).mode,
      vscode.CommentMode.Editing
    );

    // Simulate the user typing a new body (VS Code mutates comment.body),
    // then saving.
    let changed = false;
    const sub = controller.onDidChange(() => (changed = true));
    comment.body = 'updated text';
    controller.saveComment(comment);
    sub.dispose();

    const saved = r.thread.comments[0] as ReviewCommentItem;
    assert.strictEqual(saved.mode, vscode.CommentMode.Preview);
    assert.strictEqual(saved.savedBody, 'updated text');
    assert.strictEqual(changed, true, 'saveComment should fire onDidChange');

    // Edit again but cancel: body reverts to the last saved value.
    controller.editComment(comment);
    comment.body = 'abandoned edit';
    controller.cancelEditComment(comment);
    const reverted = r.thread.comments[0] as ReviewCommentItem;
    assert.strictEqual(reverted.mode, vscode.CommentMode.Preview);
    assert.strictEqual(String(reverted.body), 'updated text');
  });

  test('cancelAllEdits reverts every editing comment (Escape behavior)', () => {
    const a = reply(0, 'note A');
    const b = reply(2, 'note B');
    controller.addComment(a);
    controller.addComment(b);
    const commentA = a.thread.comments[0] as ReviewCommentItem;
    const commentB = b.thread.comments[0] as ReviewCommentItem;

    // Nothing editing yet: reports false so Escape falls through to hide.
    assert.strictEqual(controller.cancelAllEdits(), false);

    controller.editComment(commentA);
    commentA.body = 'half-typed change';
    assert.strictEqual(controller.cancelAllEdits(), true);

    const reverted = a.thread.comments[0] as ReviewCommentItem;
    assert.strictEqual(reverted.mode, vscode.CommentMode.Preview);
    assert.strictEqual(String(reverted.body), 'note A');
    assert.strictEqual(commentB.mode, vscode.CommentMode.Preview);
  });

  test('edited body shows up in the exported review', () => {
    const r = reply(2, 'first draft');
    controller.addComment(r);
    const comment = r.thread.comments[0] as ReviewCommentItem;

    controller.editComment(comment);
    comment.body = 'final wording';
    controller.saveComment(comment);

    const threads = controller.collectReviewThreads(document);
    assert.strictEqual(threads[0].comments[0].comment, 'final wording');
  });

  test('setAllCollapsibleState expands and collapses every thread', () => {
    const a = controller.addComment(reply(0, 'note A'));
    const b = controller.addComment(reply(2, 'note B'));

    controller.setAllCollapsibleState(
      vscode.CommentThreadCollapsibleState.Collapsed
    );
    assert.strictEqual(
      a.collapsibleState,
      vscode.CommentThreadCollapsibleState.Collapsed
    );
    assert.strictEqual(
      b.collapsibleState,
      vscode.CommentThreadCollapsibleState.Collapsed
    );

    controller.setAllCollapsibleState(
      vscode.CommentThreadCollapsibleState.Expanded
    );
    assert.strictEqual(
      a.collapsibleState,
      vscode.CommentThreadCollapsibleState.Expanded
    );
    assert.strictEqual(
      b.collapsibleState,
      vscode.CommentThreadCollapsibleState.Expanded
    );
  });

  test('addQuickReply appends to the thread at (uri, line)', () => {
    const r = reply(1, 'needs review');
    controller.addComment(r);

    const ok = controller.addQuickReply(
      document.uri.toString(),
      1,
      'Confirmed'
    );
    assert.strictEqual(ok, true);
    assert.strictEqual(r.thread.comments.length, 2);
    assert.strictEqual(
      String((r.thread.comments[1] as ReviewCommentItem).body),
      'Confirmed'
    );
    assert.strictEqual(
      r.thread.collapsibleState,
      vscode.CommentThreadCollapsibleState.Expanded
    );
    assert.deepStrictEqual(controller.lastActive, {
      uri: document.uri.toString(),
      line: 1,
    });
  });

  test('addQuickReply rejects unknown threads and blank text', () => {
    const r = reply(1, 'needs review');
    controller.addComment(r);

    assert.strictEqual(
      controller.addQuickReply(document.uri.toString(), 2, 'Yes'),
      false
    );
    assert.strictEqual(
      controller.addQuickReply(document.uri.toString(), 1, '   '),
      false
    );
    assert.strictEqual(r.thread.comments.length, 1);
  });
});

suite('Review Panel Suite', () => {
  const fakeContext = {
    subscriptions: [] as { dispose(): void }[],
  } as unknown as vscode.ExtensionContext;

  test('builds nested file -> thread -> comment model with replies', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: 'alpha\nbeta\ngamma',
    });
    const controller = new MarkdownCommentController(fakeContext);

    const thread = controller.controller.createCommentThread(
      document.uri,
      new vscode.Range(1, 0, 1, 0),
      []
    );
    controller.addComment({ thread, text: 'first comment' } as vscode.CommentReply);
    controller.addComment({ thread, text: 'reply to first' } as vscode.CommentReply);

    const model = buildPanelModel(controller);
    assert.strictEqual(model.length, 1);
    assert.strictEqual(model[0].threads.length, 1);

    const panelThread = model[0].threads[0];
    assert.strictEqual(panelThread.line, 1);
    assert.strictEqual(panelThread.comments.length, 2);
    assert.strictEqual(panelThread.comments[0].isReply, false);
    assert.strictEqual(panelThread.comments[0].body, 'first comment');
    assert.strictEqual(panelThread.comments[1].isReply, true);
    assert.strictEqual(panelThread.comments[1].body, 'reply to first');

    controller.dispose();
  });

  test('panel model includes untitled (never saved) documents', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: 'unsaved alpha\nunsaved beta',
    });
    assert.strictEqual(document.uri.scheme, 'untitled');
    assert.strictEqual(isReviewableMarkdownDocument(document), true);

    const controller = new MarkdownCommentController(fakeContext);
    const thread = controller.controller.createCommentThread(
      document.uri,
      new vscode.Range(0, 0, 0, 0),
      []
    );
    controller.addComment({ thread, text: 'note on unsaved file' } as vscode.CommentReply);

    const model = buildPanelModel(controller);
    const file = model.find((f) => f.uri === document.uri.toString());
    assert.ok(file, 'untitled file should appear in the panel model');
    assert.strictEqual(file!.threads.length, 1);
    assert.strictEqual(file!.threads[0].comments[0].body, 'note on unsaved file');
    assert.strictEqual(file!.threads[0].lineText, 'unsaved alpha');

    controller.dispose();
  });

  test('panel model is empty after clearAll', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: 'one\ntwo',
    });
    const controller = new MarkdownCommentController(fakeContext);
    const thread = controller.controller.createCommentThread(
      document.uri,
      new vscode.Range(0, 0, 0, 0),
      []
    );
    controller.addComment({ thread, text: 'note' } as vscode.CommentReply);
    assert.strictEqual(buildPanelModel(controller).length, 1);

    controller.clearAll();
    assert.strictEqual(buildPanelModel(controller).length, 0);

    controller.dispose();
  });
});

suite('Stored Load Suite', () => {
  const fakeContext = {
    subscriptions: [] as { dispose(): void }[],
  } as unknown as vscode.ExtensionContext;

  test('loadStoredComments restores author and is idempotent', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: 'alpha\nbeta\ngamma',
    });
    const controller = new MarkdownCommentController(fakeContext);

    const stored = [
      { line: 1, comments: [{ author: 'songz', body: 'fix this line' }] },
    ];
    assert.strictEqual(controller.loadStoredComments(document, stored), 1);

    const model = buildPanelModel(controller);
    assert.strictEqual(model[0].threads[0].comments[0].author, 'songz');
    assert.strictEqual(model[0].threads[0].comments[0].body, 'fix this line');

    assert.strictEqual(controller.loadStoredComments(document, stored), 0);

    controller.dispose();
  });

  test('loaded threads start collapsed (only newly added ones expand)', async () => {
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: 'alpha\nbeta\ngamma',
    });
    const controller = new MarkdownCommentController(fakeContext);

    controller.loadStoredComments(document, [
      { line: 0, comments: [{ author: 'songz', body: 'stored note' }] },
    ]);

    const loaded = controller.getThreads()[0];
    assert.strictEqual(
      loaded.collapsibleState,
      vscode.CommentThreadCollapsibleState.Collapsed
    );

    controller.dispose();
  });
});
