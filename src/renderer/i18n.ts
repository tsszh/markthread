// Tiny browser-only i18n layer shared by the standalone app and the preview
// client. English and Simplified Chinese are bundled. The active language is
// persisted per browser and broadcast to subscribers so the imperative DOM can
// relabel itself without a full reload.

export type Lang = 'en' | 'zh';

export const LANGS: { id: Lang; label: string; short: string }[] = [
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'zh', label: '简体中文', short: '中' },
];

type Params = Record<string, string | number>;
type Entry = string | ((p: Params) => string);

// One flat namespace. Each key carries an `en` and a `zh` form; values may be
// functions when they need counts or interpolation with pluralization.
const M: Record<string, Record<Lang, Entry>> = {
  // App bar
  read: { en: 'Read', zh: '阅读' },
  source: { en: 'Source', zh: '源码' },
  clipboardView: { en: 'Clipboard', zh: '复制预览' },
  viewTabs: { en: 'View', zh: '视图' },
  comments: { en: 'Comments', zh: '评论' },
  shareReview: { en: 'Share review', zh: '分享评审' },
  accentColor: { en: 'Accent color', zh: '强调色' },
  toggleTheme: { en: 'Theme', zh: '主题' },
  themeSystem: { en: 'Follow system', zh: '跟随系统' },
  themeLight: { en: 'Light', zh: '浅色' },
  themeDark: { en: 'Dark', zh: '深色' },
  moreActions: { en: 'More actions', zh: '更多操作' },
  switchLanguage: { en: 'Switch language', zh: '切换语言' },

  // More menu
  loadSample: { en: 'Load sample', zh: '加载示例' },
  loadRichSample: { en: 'Load rich sample', zh: '加载完整示例' },
  uploadMarkdown: { en: 'Upload Markdown…', zh: '上传 Markdown…' },
  exportComments: { en: 'Export comments', zh: '导出评论' },
  importComments: { en: 'Import comments', zh: '导入评论' },
  clearAllComments: { en: 'Clear all comments', zh: '清除所有评论' },
  settingsMenu: { en: 'Settings…', zh: '设置…' },

  // Source view
  markdownSource: { en: 'Markdown source', zh: 'Markdown 源码' },
  cancel: { en: 'Cancel', zh: '取消' },
  renderReview: { en: 'Render & review', zh: '渲染并评审' },
  sourcePlaceholder: {
    en: 'Paste Markdown here, then Render & review…',
    zh: '在此粘贴 Markdown，然后点击"渲染并评审"…',
  },

  // Clipboard (plain-text) view
  clipboardTitle: { en: 'Clipboard preview', zh: '复制预览' },
  clipboardHint: {
    en: 'This is exactly the plain text "Share review" copies to your clipboard.',
    zh: '这正是"分享评审"复制到剪贴板的纯文本内容。',
  },
  clipboardEmpty: {
    en: 'No comments yet — add a review comment to preview what would be copied.',
    zh: '暂无评论 —— 添加评审评论后即可预览将要复制的内容。',
  },
  copyToClipboard: { en: 'Copy to clipboard', zh: '复制到剪贴板' },

  // Settings modal
  settingsTitle: { en: 'Settings', zh: '设置' },
  reviewSettings: { en: 'Review settings', zh: '评审设置' },
  closeSettings: { en: 'Close settings', zh: '关闭设置' },
  quickReplyPills: { en: 'Quick reply pills', zh: '快捷回复标签' },
  addReply: { en: '+ Add reply', zh: '+ 添加回复' },
  quickReplyHint: {
    en: 'Shown as one-click verdict pills on every comment. Tone sets the colour and icon.',
    zh: '在每条评论上作为一键评定标签显示。色调决定颜色与图标。',
  },
  pageWidthLabel: { en: 'Page width', zh: '页面宽度' },
  pageWidthNarrow: { en: 'Narrow', zh: '窄' },
  pageWidthMedium: { en: 'Medium', zh: '中' },
  pageWidthWide: { en: 'Wide', zh: '宽' },
  pageWidthFull: { en: 'Full', zh: '全宽' },
  pageWidthHint: {
    en: 'Sets how wide the rendered document is. Wider fits big tables; narrower is easier to read.',
    zh: '设置文档渲染宽度。更宽适合大表格，更窄更易阅读。',
  },
  shareTemplate: { en: 'Share summary template', zh: '分享摘要模板' },
  shareHeaderAria: { en: 'Share summary header', zh: '分享摘要标题' },
  includeLineNumber: { en: 'Include line number', zh: '包含行号' },
  includeLineText: { en: 'Include line / selection text', zh: '包含行 / 选区文本' },
  includeComment: { en: 'Include comment text', zh: '包含评论文本' },
  shareHint: {
    en: 'Used by "Share review", which copies a readable summary (not JSON) to the clipboard.',
    zh: '"分享评审"会将可读摘要（而非 JSON）复制到剪贴板。',
  },
  resetDefaults: { en: 'Reset to defaults', zh: '恢复默认' },
  save: { en: 'Save', zh: '保存' },
  quickReplyLabelAria: { en: 'Quick reply label', zh: '快捷回复文本' },
  quickReplyToneAria: { en: 'Quick reply tone', zh: '快捷回复色调' },
  removeQuickReply: { en: 'Remove quick reply', zh: '移除快捷回复' },

  // Toasts / dialogs
  exportedThreads: {
    en: (p) => `Exported ${p.n} comment thread${p.n === 1 ? '' : 's'}`,
    zh: (p) => `已导出 ${p.n} 条评论`,
  },
  exportedEmpty: {
    en: 'Exported review (no comments yet)',
    zh: '已导出评审（暂无评论）',
  },
  noCommentsToClear: { en: 'No comments to clear', zh: '没有可清除的评论' },
  confirmClear: {
    en: (p) =>
      `Clear all ${p.n} comment thread${p.n === 1 ? '' : 's'}? This cannot be undone.`,
    zh: (p) => `确定清除全部 ${p.n} 条评论？此操作无法撤销。`,
  },
  clearedAll: { en: 'Cleared all comments', zh: '已清除所有评论' },
  loadedFile: { en: (p) => `Loaded ${p.name}`, zh: (p) => `已加载 ${p.name}` },
  couldNotRead: { en: 'Could not read that file', zh: '无法读取该文件' },
  importedThreads: {
    en: (p) => `Imported ${p.n} comment thread${p.n === 1 ? '' : 's'}`,
    zh: (p) => `已导入 ${p.n} 条评论`,
  },
  invalidExport: {
    en: 'That file is not a valid review export',
    zh: '该文件不是有效的评审导出文件',
  },
  loadedSample: { en: 'Loaded the sample document', zh: '已加载示例文档' },
  loadedRichSample: {
    en: 'Loaded the rich sample document',
    zh: '已加载完整示例文档',
  },
  richSampleUnavailable: {
    en: 'Rich sample is unavailable in this build',
    zh: '此版本中没有可用的完整示例',
  },
  copiedSummary: {
    en: 'Review summary copied to clipboard',
    zh: '评审摘要已复制到剪贴板',
  },
  clipboardUnavailable: {
    en: 'Could not copy to clipboard',
    zh: '无法复制到剪贴板',
  },
  settingsSaved: { en: 'Settings saved', zh: '设置已保存' },

  // Accent palette
  accent: { en: 'Accent', zh: '强调色' },
  accent_oxblood: { en: 'Oxblood', zh: '牛血红' },
  accent_ink: { en: 'Graphite ink', zh: '石墨墨黑' },
  accent_pine: { en: 'Pine green', zh: '松林墨绿' },
  accent_terracotta: { en: 'Terracotta', zh: '赭石陶土' },
  accent_petrol: { en: 'Petrol teal', zh: '孔雀深青' },

  // Language menu
  language: { en: 'Language', zh: '语言' },

  // Time (relative)
  justNow: { en: 'just now', zh: '刚刚' },
  timeMin: { en: (p) => `${p.n}m`, zh: (p) => `${p.n} 分钟` },
  timeHour: { en: (p) => `${p.n}h`, zh: (p) => `${p.n} 小时` },
  timeDay: { en: (p) => `${p.n}d`, zh: (p) => `${p.n} 天` },

  // Comment threads
  editComment: { en: 'Edit comment', zh: '编辑评论' },
  deleteComment: { en: 'Delete comment', zh: '删除评论' },
  editCommentPlaceholder: { en: 'Edit comment…', zh: '编辑评论…' },
  enterToSend: { en: 'Enter to send', zh: '回车发送' },
  commentLabel: { en: 'Comment', zh: '评论' },
  lineN: { en: (p) => `Line ${p.n}`, zh: (p) => `第 ${p.n} 行` },
  jumpToLine: { en: 'Jump to this line', zh: '跳转到该行' },
  resolved: { en: 'Resolved', zh: '已解决' },
  open: { en: 'Open', zh: '未解决' },
  reopenThread: { en: 'Reopen thread', zh: '重新打开' },
  resolveThread: { en: 'Resolve thread', zh: '标记解决' },
  deleteThread: { en: 'Delete thread', zh: '删除线程' },
  close: { en: 'Close', zh: '关闭' },
  reply: { en: 'Reply…', zh: '回复…' },
  writeComment: { en: 'Write a review comment…', zh: '写下评审意见…' },
  addVerdict: {
    en: (p) => `Add verdict: ${p.label}`,
    zh: (p) => `添加评定：${p.label}`,
  },
  commentsOnLine: {
    en: (p) => `${p.n} comment${p.n === 1 ? '' : 's'} on this line`,
    zh: (p) => `该行有 ${p.n} 条评论`,
  },
  commentsOnCell: {
    en: (p) => `${p.n} comment${p.n === 1 ? '' : 's'} on this cell`,
    zh: (p) => `该单元格有 ${p.n} 条评论`,
  },
  viewComments: {
    en: (p) => `View comment${p.n === 1 ? '' : 's'}`,
    zh: '查看评论',
  },
  addCommentLine: { en: 'Add a comment on this line', zh: '在该行添加评论' },
  commentOnLine: { en: 'Comment on this line', zh: '评论该行' },
  addCommentCell: { en: 'Add a comment on this cell', zh: '在该单元格添加评论' },
  commentOnCell: { en: 'Comment on this cell', zh: '评论该单元格' },

  // Rich tables
  tableFilter: { en: 'Filter', zh: '筛选' },
  tableReset: { en: 'Reset', zh: '重置' },
  tableAutofit: { en: 'Auto-fit', zh: '自适应列宽' },
  tableAutofitHint: {
    en: 'Drag to resize · double-click to auto-fit',
    zh: '拖动调整列宽 · 双击自适应',
  },
  tableColumns: { en: 'Columns', zh: '列' },
  tableFilterPlaceholder: { en: 'Filter…', zh: '筛选…' },
  tableFilterColumn: {
    en: (p) => `Filter column ${p.n}`,
    zh: (p) => `筛选第 ${p.n} 列`,
  },
  tableRowCount: {
    en: (p) => `${p.n} row${p.n === 1 ? '' : 's'}`,
    zh: (p) => `${p.n} 行`,
  },
  tableRowFiltered: {
    en: (p) => `${p.shown} / ${p.total} rows`,
    zh: (p) => `${p.shown} / ${p.total} 行`,
  },

  // Properties / panel
  properties: { en: 'Properties', zh: '属性' },
  showDetails: { en: 'show details', zh: '显示详情' },
  reviewComments: { en: 'Review comments', zh: '评审评论' },
  inbox: { en: 'Inbox', zh: '收件箱' },
  outline: { en: 'Outline', zh: '大纲' },
  hideCommentsPanel: { en: 'Hide comments panel', zh: '隐藏评论面板' },
  hidePanel: { en: 'Hide panel', zh: '隐藏面板' },
  openComments: { en: 'Open comments', zh: '打开评论' },

  // Filters
  filterAll: { en: 'All', zh: '全部' },
  filterOpen: { en: 'Open', zh: '未解决' },
  filterResolved: { en: 'Resolved', zh: '已解决' },
  filterMine: { en: 'Mine', zh: '我的' },

  // States
  loadingComments: { en: 'Loading comments…', zh: '正在加载评论…' },
  noCommentsYet: {
    en: 'No comments yet. Hover a line and click +, or select text to start a review.',
    zh: '暂无评论。将鼠标悬停在某行并点击 +，或选中文本开始评审。',
  },
  noFilterComments: {
    en: (p) => `No ${p.label} comments.`,
    zh: (p) => `没有${p.label}评论。`,
  },
  noHeadings: { en: 'No headings to outline.', zh: '没有可用于大纲的标题。' },
  nComments: {
    en: (p) => `${p.n} comments`,
    zh: (p) => `${p.n} 条评论`,
  },
  openCommentsCount: {
    en: (p) => `${p.n} open comment${p.n === 1 ? '' : 's'}`,
    zh: (p) => `${p.n} 条未解决评论`,
  },
  allResolved: { en: 'All resolved', zh: '全部已解决' },
  renderFailed: {
    en: (p) => `${p.kind} render failed: ${p.message}`,
    zh: (p) => `${p.kind} 渲染失败：${p.message}`,
  },
};

const LANG_KEY = 'markthread.lang';
const subscribers = new Set<(lang: Lang) => void>();
let current: Lang = detectInitial();

function detectInitial(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'zh') {
      return saved;
    }
  } catch {
    /* ignore */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return /^zh/i.test(nav) ? 'zh' : 'en';
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) {
    return;
  }
  current = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }
  for (const cb of subscribers) {
    cb(lang);
  }
}

export function onLangChange(cb: (lang: Lang) => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function t(key: string, params: Params = {}): string {
  const entry = M[key]?.[current];
  if (entry === undefined) {
    return key;
  }
  if (typeof entry === 'function') {
    return entry(params);
  }
  return entry.replace(/\{(\w+)\}/g, (_, k) =>
    params[k] === undefined ? `{${k}}` : String(params[k])
  );
}

// The BCP-47 locale used for date/number formatting in the active language.
export function locale(): string {
  return current === 'zh' ? 'zh-CN' : 'en-US';
}
