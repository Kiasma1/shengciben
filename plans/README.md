# Animation improvement plans

| # | Plan | Severity | Status |
|---|---|---|---|
| 001 | [补齐临时界面的退出路径](001-complete-surface-exit-paths.md) | MEDIUM | DONE |

## Recommended execution order

1. 001 已完成：对话框（添加/分类/设置）与 Toast 的退出动画已通过 `useExitPresence` + `data-state="closing"` + `@starting-style` 实现（在历史提交中落地，2026-08 核对确认）。主题菜单功能已从代码移除，对应段落废弃。

## Dependencies

- 001：无依赖。
- 后续如增加词条增删或异步 AI 状态动画，应沿用 presence 生命周期模式，不要扩展 001 的范围。
