import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { formatStructured, STRUCTURED_HEADER } from '../../core';
import { MarkdownCommentController, ReviewCommentItem } from '../../comments';
import { buildPanelModel } from '../../reviewPanel';
import {
  deleteReview,
  parseReview,
  readReview,
  serializeReview,
  writeReview,
} from '../../storage';

suite('Core Test Suite', () => {
  test('formatStructured produces expected output', () => {
    const result = formatStructured([
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
    ]);

    assert.ok(result.startsWith(STRUCTURED_HEADER));
    assert.ok(result.includes('file: docs/example.md'));
    assert.ok(result.includes('Line 5'));
    assert.ok(result.includes('> const value = 1;'));
    assert.ok(result.includes('Consider extracting this magic number.'));
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
    ];

    for (const command of expected) {
      assert.ok(commands.includes(command), `Missing command: ${command}`);
    }
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

    const structured = formatStructured(threads);
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
});
