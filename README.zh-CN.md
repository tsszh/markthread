# MarkThread

[English](README.md) | 简体中文

> 让人来评审 Markdown，再把反馈交还给 AI 智能体。

漂亮地渲染 Markdown，**并且**逐行评审它——支持图表、行内评论、交互式表格和一键
裁决标签。它有两种形态，共享同一套渲染／评论引擎：

1. **独立 Web 应用** —— 在浏览器中粘贴或上传 Markdown，得到带图表的精美预览，并
   添加评审评论。无需安装，完全在客户端运行，还可作为 PWA 安装到手机主屏幕。
   **[▶ 试用在线 Demo](https://tsszh.github.io/markthread/)**
2. **VS Code / Cursor 扩展** —— 在编辑器旁打开自定义的「Review Preview」，并提供
   与可共享 sidecar 文件同步的原生行内（gutter）评论。

> 核心工作流是产出一份干净、带行号引用的评审，可直接粘贴给 AI 智能体（或分享给
> 队友）。

## 截图

独立 Web 应用 —— 渲染后的 Markdown 与实时评论收件箱并排（裁决标签、逐行上下文、过滤器）：

![MarkThread Web 应用：渲染后的 Markdown 与评论收件箱](docs/screenshots/web-overview.png)

<details>
<summary><b>更多截图</b> —— 图表、交互式表格、单元格与会话评论</summary>

<br />

<table>
<tr>
<td width="50%" valign="top">

**图表与示意图** —— ECharts、Obsidian Charts 与 Mermaid 在客户端渲染。

<img alt="MarkThread 渲染 ECharts 面积图与 Obsidian 柱状图" src="docs/screenshots/web-charts.png" />

</td>
<td width="50%" valign="top">

**交互式表格** —— 排序、带实时行数的按列过滤、显示/隐藏列、自动适配、拖拽缩放、重置。

<img alt="MarkThread 交互式表格：工具栏、Status 过滤与实时行数" src="docs/screenshots/web-table.png" />

</td>
</tr>
<tr>
<td width="50%" valign="top">

**单元格评论** —— 将会话锚定到单个表格单元格；它会带着 `Table … row … column …` 地址出现在收件箱中。

<img alt="MarkThread 锚定到单个表格单元格的评论会话" src="docs/screenshots/web-cell-comment.png" />

</td>
<td width="50%" valign="top">

**会话式评审** —— 聚焦的评论会话，含引用的源文本、裁决与行内回复框。

<img alt="聚焦的 MarkThread 评论会话与回复编辑器" src="docs/screenshots/web-comment.png" />

</td>
</tr>
</table>

> **移动端 / PWA：** MarkThread 完全自适应，并可安装到 iOS/Android 主屏幕。在手机上打开 **[在线 Demo](https://tsszh.github.io/markthread/)** 即可看到移动端布局（堆叠的应用栏、滑入式评论抽屉、安全区域适配）。

</details>

## 功能

### 丰富的渲染

- 与 VS Code 内置预览保持一致：GitHub 风格的提示框
  （Note / Tip / Important / Warning / Caution）、YAML frontmatter 的
  **Properties** 表、highlight.js 语法高亮，以及浮动目录（TOC）。
- **长 URL 与文件路径自动换行**以适应列宽，而不会撑出整页的横向滚动条；短词仍保持
  在同一行。代码块保留自身内部的横向滚动。
- 居中的「纸张」阅读版心，适合长文阅读，配有编辑式的小节标记，以及工具栏下方的
  阅读进度细线。

### 图表与示意图（客户端渲染）

- ` ```mermaid ` —— 流程图、时序图等。
- ` ```echarts ` —— [Apache ECharts](https://echarts.apache.org/) 配置
  （JSON，或 JS 对象字面量 / `option = …`）。
- ` ```chart ` —— [Obsidian Charts](https://github.com/phibr0/obsidian-charts)
  的 YAML 规范（`bar` / `line` / `pie` / `doughnut` / `radar` / `polarArea`）。

### 交互式表格

Markdown 表格会被就地升级为交互式网格，**且不丢失其原生结构**，因此逐单元格评论
依然可用：

- **排序** —— 点击表头在 升序 → 降序 → 原始顺序 之间循环。
- **过滤** —— 每列的过滤行（漏斗开关）筛选行，并实时显示行数。
- **显示／隐藏列** —— **Columns** 菜单可切换单独的列。
- **自动适配（Auto-fit）** —— 一键让每列适配其内容宽度；双击某列的调整手柄可只
  适配该列。
- **缩放** —— 从列的右边缘拖动改变列宽，或从首单元格底边拖动改变行高。
- **重置（Reset）** —— 恢复原始顺序、列宽与可见性。
- 宽表格拥有**自己的横向滚动条**，不会撑破页面；得益于稳定的逐行身份标识，评论
  标记在排序与过滤后仍锚定在其单元格上。

### 评审与评论

- **逐行评论** —— 悬停任意块即可显示 💬 按钮，添加锚定到该源代码行的评论（记录行号
  与行文本）。
- **选区评论** —— 选中任意短语，评论编辑器会自动打开，锚定到引用的文本。
- **表格单元格评论** —— 单元格角落的标记会打开同一会话弹窗；单元格会话引用精确的
  `Table N (L<line>), row R, column C (Header)` 地址。
- **一键裁决标签** —— 一键插入的固定裁决（`👍 Looks good`、`🛠️ Please fix` 等），
  可配置，以彩色状态徽标显示。
- **评论收件箱** —— 按 All / Open / Resolved / Mine 过滤，跳转到会话，切换到
  **Outline** 视图，并可一键**复制**整份评审到剪贴板。
- **键盘** —— 在编辑器中，**Enter** 保存，**Shift+Enter** 换行，**Esc** 取消。

### 外观与语言

- **暗色模式**，外加可切换的**强调色调色板**（Oxblood、Graphite ink、Pine green、
  Terracotta、Petrol teal）。主题提供 **跟随系统 / 浅色 / 深色**。选择按浏览器持久化。
- **实时页宽** —— 从工具栏循环 窄 → 中 → 宽 → 全宽；无需保存步骤。
- **剪贴板预览页签** —— 第三个视图（Read / Source / **Clipboard**）显示「Share
  review」复制的确切纯文本，并带一键复制按钮。
- **English / 简体中文 切换** —— 就地切换整个界面语言（无需刷新），默认跟随浏览器
  语言；不会改动你撰写的 Markdown 与已保存的裁决标签。

### 移动端与可安装（PWA）

- **添加到主屏幕（iOS / Android）。** 应用图标、Web manifest 与 Apple 元标签让独立
  应用以全屏的独立应用形式启动——没有浏览器外壳——同时仍是同一个网页。
- **移动端自适应 UI** —— 在应用栏、面板、悬浮按钮与提示中处理安全区域（刘海／home
  指示条）；自适应应用栏；纯图标的表格工具栏；全宽设置弹窗；以及 16px 输入框以避免
  iOS 聚焦缩放。
- **触摸手势** —— 滑动打开／关闭评论抽屉（表格／代码滚动区域除外）。
- **可靠复制** —— iOS 友好的剪贴板，带 `execCommand` 回退，复制失败时给出明确错误而
  非默默失败。

## 使用

### 方式 A —— 独立 Web 应用（免安装）

打开 **[在线 Demo](https://tsszh.github.io/markthread/)**，或在本地运行（见
[开发](#开发)）。然后：

1. **粘贴** Markdown 到顶部文本框（或 **Upload .md**），点击 **Render**。首次访问时
   会加载一个组件**展示**示例，让你立刻体验每一种块。
2. **添加评论**：悬停某行点击 💬，或选中文本对短语评论。用裁决标签快速回复。表格可
   从其工具栏排序、过滤、缩放并隐藏列。
3. **持久化**：评论保存在 `localStorage`，按文档分桶。加载*不同*的文档会从空白开始；
   重新打开已知文档（或刷新页面）会恢复它及其评论。
4. **分享**：**Export JSON** 写出 `{ markdown, threads }` 文件；**Import JSON** 再次
   加载它。**Share review** 复制一份可读、带行号引用的摘要。一切都留在你的浏览器内。

> **作为应用安装（iOS / Android）：** 在 Safari（或 Chrome）中打开在线 Demo，然后
> **分享 → 添加到主屏幕**。MarkThread 会以全屏独立应用启动，布局会适配刘海与 home
> 指示条。

### 方式 B —— VS Code / Cursor 扩展

安装 `.vsix`（**Extensions: Install from VSIX**，见 [打包](#打包)），然后打开任意
Markdown 文件：

- **自定义评审预览**：点击编辑器标题栏的 **Open Review Preview** 按钮（或从命令面板
  运行）。你将在编辑器旁获得与 Web 应用相同的 图表 + 交互式表格 + 行内评论 体验。
- **原生行内评论**：悬停编辑器的 gutter 在任意行添加评论；**Enter** 提交，
  **Shift+Enter** 换行。在预览中撰写的行级评论会与 gutter 保持同步。
- **评审面板**（活动栏）：评论按 文件 → 会话 → 评论 分组，提供 Copy Review /
  Save-to-file 操作、Clear-all 链接、展开／折叠控件，以及可编辑的 快速回复 +
  复制格式 + **外观**（语言／主题／强调色／页宽）设置区。
- **复制到剪贴板**是主工作流：结构化、带行号引用的评审文本，随时可粘贴给 AI。
- **团队可共享存储**：*Save to file* 写出同级的 `<file>.markthread.json`；重新打开
  文件时自动加载，可提交后与团队共享。

## 命令

| 命令 | 说明 |
| --- | --- |
| `MarkThread: Open Review Preview` | 在编辑器旁打开自定义的 图表 + 评论 预览 |
| `MarkThread: Copy Review to Clipboard` | 复制带文件、行号、引用源行与评论文本的结构化块 |
| `MarkThread: Save Review Comments to File` | 写出同级的 `<file>.markthread.json` sidecar |
| `MarkThread: Load Review Comments from File` | 按需从 sidecar 重新加载评论 |
| `MarkThread: Clear All Review Comments` | 清除所有会话并删除当前文件的 sidecar |

## 开发

```bash
npm install
npm run compile     # esbuild 打包 + tsc 对测试做类型检查
npm run watch       # 保存时重建（扩展 + webview + 独立应用）
npm run lint
npm test            # VS Code 无头集成测试
npm run preview     # 构建后启动独立 Web 应用
npm run package     # 构建 .vsix
```

在 VS Code/Cursor 中按 **F5** 启动扩展开发宿主（Extension Development Host）。

### 架构

一套渲染／评论核心通过轻量的宿主适配器在三个目标间共享，因此 Web 应用与 VS Code
预览行为一致：

- `src/renderer/markdownRenderer.ts` —— 同构的 Markdown → HTML（为每个块标注
  `data-source-line` 用于评论锚定）。
- `src/renderer/charts.ts` —— 纯 ECharts / Obsidian-Charts 解析器（有单元测试）。
- `src/renderer/previewClient.ts` —— 浏览器 UI（图表、交互式表格、悬停 💬、选区
  评论、会话、裁决标签）。
- `src/renderer/hostAdapter.ts` —— 客户端与其宿主之间的契约。
- `src/renderer/standaloneMain.ts` / `webviewMain.ts` —— 两个宿主适配器
  （`localStorage` 与 VS Code `postMessage`）。
- `src/previewPanel.ts` —— VS Code webview 面板 + gutter／sidecar 同步。

`npm run preview` 会在 `http://localhost:4173` 提供自包含的
`dist/standalone/index.html`（JS 与 CSS 内联）。

## 在线 Web 应用（GitHub Pages）

独立 Web 应用由 [`.github/workflows/pages.yml`](.github/workflows/pages.yml) 在每次
推送到 `main` 时部署到 GitHub Pages：

> **<https://tsszh.github.io/markthread/>**

一次性设置（仓库所有者）：**Settings → Pages → Build and deployment →
Source = "GitHub Actions"**。该工作流构建 `dist/standalone` 并发布；页面是单个可
离线使用的文件。

## 安全说明

预览会渲染你提供的 Markdown。有两点是有意为之、值得了解：

- 渲染器允许原始 HTML（与 VS Code 自身预览一致），且独立页面不施加 CSP，因此粘贴
  不受信任的 Markdown 可能在**你自己的**浏览器标签页中执行嵌入的 HTML（self-XSS）。
  只粘贴你信任的内容。VS Code webview 由严格的 CSP 沙箱保护。
- ` ```echarts ` 块可能使用 JS 对象字面量，它通过 `new Function` 求值。这会运行图表
  块中的代码——同样地，只渲染你信任的内容。仅含 JSON 的 ECharts 配置不会被求值。

## 打包

```bash
npm run package
```

生成 `markthread-<version>.vsix`，可通过 **Extensions: Install from VSIX** 安装。
向 `main` 推送版本号变更也会自动创建附带 `.vsix` 的 GitHub Release（见
[`.github/workflows/release.yml`](.github/workflows/release.yml)）。

## 测试

- **核心逻辑**：`src/test/suite/extension.test.ts` 覆盖 `formatStructured`、sidecar
  序列化／解析 + 往返、评论跟踪与面板模型。
- **渲染器／图表**：`src/test/suite/preview.test.ts` 覆盖 `data-source-line` 标注、
  自定义围栏、ECharts/Obsidian-Charts 解析与选区存储 schema。
- **手动**：`npm run preview` 并在浏览器中实际操作 Web 应用。

## 面向 AI 智能体

参见 [AGENTS.md](AGENTS.md)，其中包含面向编码智能体与生成式搜索引擎的项目结构化
概览（目的、能力、文件地图与约定）。

## 许可证

MIT
