# 生词本

一个本地优先、AI 辅助的英语单词收藏库。

它只做一件事：把遇到的生词收好，并让查找、分类和核对足够轻松。界面采用无框、无彩色的三栏结构；数据保存在本机，Ollama 准备好后会在后台自动补全内容。

`Windows` · `Electron` · `React` · `TypeScript` · `SQLite` · `Ollama`

![生词本主界面](docs/images/app-overview.jpg)

## 能做什么

- 收藏单词，并记录英式 IPA、词性与中文释义
- 搜索单词、释义、分类、标签和词根
- 用主分类整理主题，用标签建立交叉关系
- 通过本地 Ollama 自动生成 IPA、释义、分类建议和标签
- 将 AI 结果留在“待核对”状态，由用户确认后归档
- 索引本地 HTML 词根辞典，展示可核实的词根并跳转到原文
- 将误删内容暂存到回收站，支持恢复或一键永久清空
- 以 JSON、CSV 或 SQLite 格式导出数据
- 每小时检查一次跨日备份，并保留最近 7 份

## 设计

界面围绕“词”这个核心对象展开：

1. 左栏负责词库与分类。
2. 中栏负责搜索、筛选和选择。
3. 右栏负责查看、核对与编辑。

没有传统菜单栏，也没有装饰性色彩。层级依靠间距、字重、半透明材质和运动反馈建立；动画只用于说明状态变化，并自动尊重系统的“减少动态效果”设置。

## 从源码运行

需要 Node.js 22 或更高版本，以及 Windows 10/11。

```powershell
git clone https://github.com/Kiasma1/shengciben.git
cd shengciben
npm install
npm run dev
```

构建 Windows 安装包：

```powershell
npm run build:win
```

安装包会生成在 `release/` 目录。

## 配置本地 AI

AI 功能完全可选。没有启动 Ollama 时，单词仍会正常收藏并进入等待队列；模型准备好后，应用会自动继续处理。

1. 安装并启动 [Ollama](https://ollama.com/)。
2. 拉取一个支持结构化输出的模型，例如：

   ```powershell
   ollama pull qwen3:8b
   ```

3. 打开“设置”，确认 Ollama 地址为 `http://127.0.0.1:11434`。
4. 选择模型并保存。

生成结果包括英式 IPA、词性、中文释义、分类建议和标签。所有 AI 结果都需要人工核对。

## 配置词根辞典

词根功能不会从网络抓取内容，也不会猜测来源。请在“设置 → 词根辞典”中选择本地的《英语词根词源分类辞典》HTML 文件；应用会建立本地索引，并把匹配结果链接回辞典中的对应位置。

辞典文件不包含在本仓库中。首次选择文件后，已有单词会自动重新匹配词根。

## 数据与隐私

- 词库使用 SQLite 保存在 Electron 的系统用户数据目录中。
- 点击“设置 → 打开数据目录”可以直接查看数据库和备份。
- Ollama 请求默认只发送到本机的 `127.0.0.1`。
- 应用不包含账号、遥测、云同步或在线词典请求。
- 卸载应用不会主动删除词库数据。

## 开发与验证

```powershell
# 类型检查
npm run typecheck

# 自动化测试
npm test

# 生产构建
npm run build
```

词根索引还提供一次确定性随机审计：它会从指定辞典抽取多组各 100 个样本，检查词根、来源锚点、去重和误匹配。

```powershell
npm run test:roots:random -- "D:\path\to\dictionary.html"
```

## 项目结构

```text
src/
├─ main/       Electron 主进程、SQLite、AI 队列与词根索引
├─ preload/    受限 IPC 接口
├─ renderer/   React 界面
└─ shared/     共享 TypeScript 类型
tests/         数据库、导出、队列与词根索引测试
```

## 当前状态

项目目前处于 `0.1.0` 阶段，优先支持 Windows 桌面端。核心的收藏、搜索、分类、AI 补全、词根关联、回收站、导出和备份流程已经可用。

## 许可证

[MIT](LICENSE)
