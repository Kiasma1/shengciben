# 生词本

`v2.2.0` · Windows · Electron · React · TypeScript · SQLite · DeepSeek

生词本是一款本地优先的英语词汇管理桌面应用。它把收藏、编辑、分类、独立复习和词素分析集中在一个简洁的 Windows 桌面界面中；词库保存在本机，DeepSeek 和本地词根辞典均为可选增强。

![生词本主界面](docs/images/app-overview.jpg)

## 核心能力

- 收藏单个英文单词或最多 8 个英文 token 组成的短语；单词继续规范常见复数，短语只规范空白并按完整表达独立保存。
- 短语由 DeepSeek 优先解释整体意义，例如 `welfare check`、`look up`、`take care of`；组成词只作为辅助理解，不会被拆成词根。
- 编辑词汇文本、英式 IPA、多个词性与中文释义、主分类和标签；字段有效时会自动保存。
- 搜索单词或短语、IPA、释义、分类、标签、短语类型、短语组成说明和词素，并按最近更新、A–Z 或记忆曲线排序。
- 在独立 Review Mode 中先回忆英文词汇，再显示答案，用 `1`–`4` 选择“忘记、困难、记得、简单”；普通点击词卡只查看和编辑，不会记录复习。
- 可选用 DeepSeek 自动补全 IPA、释义、分类、标签和构词分析，再与本地词根辞典核验；无法确认的词素会明确标记为 AI 解析。

此外，应用提供 Due + New 复习队列、每日新词上限、四档透明间隔算法、复习历史、AI 队列暂停与重试、回收站、自动更新、每日 SQLite 备份，以及 JSON、CSV、SQLite 导出。

## 安装

项目当前发布 Windows NSIS 安装包。

1. 打开 [GitHub Releases](https://github.com/Kiasma1/shengciben/releases)。
2. 下载 `shengciben-setup-2.2.0.exe`。
3. 运行安装程序并选择安装目录。

卸载应用不会主动删除词库数据。

### 从源码运行

需要 Node.js 22 和 npm。

```powershell
git clone https://github.com/Kiasma1/shengciben.git
cd shengciben
npm ci
npm run dev
```

构建 Windows 安装包：

```powershell
npm run build:win
```

安装包生成在 `release/` 目录，文件名为 `shengciben-setup-2.2.0.exe`。

## 使用

1. 点击“添加词汇”，或按 `Ctrl+N`，输入一个英文单词或短语并加入队列。
2. 在中栏搜索、筛选或排序；按 `Ctrl+K` 可直接聚焦搜索框。点击词条只会打开详情，不会改变复习状态。
3. 在右栏编辑词汇文本、IPA、义项、分类和标签；字段有效时会自动保存。
4. 点击左侧“开始复习”，进入独立复习页面：先看英文词汇，按 `Space` 或点击“显示答案”，再用 `1`–`4` 评分。
5. 复习中按 `Esc` 可退出；已评分的词条会立即保存，剩余词条下次重新从数据库构建队列。

Review Mode 的队列包含全部到期词，以及每日上限允许加入的新词。Word 和 Phrase 共用同一套 Review 算法、历史表和评分快捷键；Phrase Reveal 后优先显示整体释义、使用说明和组成词。

## 配置

### DeepSeek

1. 在 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys)创建 API Key。
2. 打开“设置 → DeepSeek AI”，填写 API Key 和 API 地址。
3. 点击“检测 DeepSeek”，从接口返回的可用模型中选择模型并保存。

默认 API 地址为 `https://api.deepseek.com`，默认模型为 `deepseek-v4-flash`。API Key 通过 Electron `safeStorage` 加密后写入本机，设置界面不会回显已保存的 Key。

后台队列每次处理一个词条。Word 会继续执行词素与本地词根核验；Phrase 只执行整体表达分析，不进入词根 pipeline。可重试的网络或限流错误最多自动重试 10 次，也可以暂停队列、手动重试词条，或在设置中重新分析全部词条。已有人工释义时，重新分析会保留现有释义和标签。

### 复习

在“设置 → 复习”中配置“每日新词上限”，范围为 `0–100`，默认 `20`。设为 `0` 表示当天只复习到期词。应用按本地日期统计当天已经首次学习的新词。

四档评分使用分钟作为内部单位：新词为 Again `10 分钟`、Hard `1 天`、Good `2 天`、Easy `4 天`；已有间隔时分别按 `10 分钟`、`max(1 天, previous × 1.2)`、`max(2 天, previous × 2.5)`、`max(4 天, previous × 4)` 计算，最长 `365 天`。每次评分都会保存一条复习历史。

### 本地词根辞典

打开“设置 → 词根辞典”，选择《英语词根词源分类辞典》的本地 HTML 文件并重建索引。辞典文件不包含在本仓库中。

应用会校验 AI 返回的词素是否真实出现在单词中，再将其映射到辞典词根族；Phrase 不运行这套词根分析。辞典命中项可点击跳转到原 HTML 锚点，未命中项保留为“AI 解析”。更换辞典后，只重新核验 Word。

## 数据与隐私

- 词库使用 SQLite，保存在 Electron 的系统用户数据目录；可从“设置 → 数据与备份 → 打开数据目录”进入。
- 复习当前状态保存在 `words` 表，评分历史保存在 `review_events` 表；删除词条时历史记录级联删除。
- 应用启动后每小时检查一次当日备份，最多保留最近 7 个 `.sqlite` 文件。
- 可从设置导出 JSON、带 BOM 的 CSV 或完整 SQLite 备份；JSON/SQLite 保留 `entryType`、`phraseType`、`phraseComponents` 和 `phraseExplanation`，CSV 提供对应字段。
- AI 补全只向 DeepSeek 发送当前单词或短语、条目类型和现有分类名；应用没有账号、遥测、云同步或在线词典请求。
- 现有数据库会在启动时自动迁移；复习历史表的迁移幂等，不会重置已有复习状态。

## 项目结构

```text
src/
├─ main/       Electron 主进程、SQLite、复习算法、Review API、AI 队列与词根索引
├─ preload/    受限 IPC 接口
├─ renderer/   React 界面、Review Mode 与样式
└─ shared/     共享 TypeScript 类型与词汇输入规则
tests/         数据库、短语、复习、归一化、AI、队列、导出与词根索引测试
.github/       基于 v* tag 的 Windows 自动发布流程
build/         应用图标
```

## 开发与验证

```powershell
npm run typecheck
npm test
npm run build
```

使用本地辞典执行词根随机审计：

```powershell
npm run test:roots:random -- "D:\path\to\dictionary.html"
```

## 许可证

[MIT](LICENSE)
