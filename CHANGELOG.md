# 变更日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [0.2.1] - 2026-11-20

### 修复

- `--agent` / `--root` / `--dir` 缺值时不再静默取 `true`，统一报错退出（退出码 2）。
- 日期校验按 UTC 回读，`2026-13-45`、`2026-02-30`、`2025-02-29` 被拒，`2024-02-29` 通过。
- `add` 写入前按 `forbidden.txt` 自检，命中 `error` 级规则不落盘；`ERROR:` / `Warn:` 前缀大小写不敏感。
- 标题里的 `|` 会破坏五字段结构，现在写入时转义、解析时还原。
- `--dir` 改名的项目在子目录里也能定位，不必每次手写 `--dir`。
- 非 git 项目里从记忆目录内部调用时能正确回到项目根。
- 向上探测以家目录为边界，不再把 `~/docs/memory` 之类无关目录当成项目记忆区。
- MCP `serverInfo.version` 读不到 `package.json`（路径少一级），实际一直是兜底值。
- MCP `memory_read --format markdown` 在索引过期时返回旧快照，现在返回现算结果。

### 变更

- `init` / `add` 的 agent 名不再默认 `codex`：未显式指定时报错，避免把结论写进别人的目录。
- `AGENT_MEMORY_ROOT` 在 CLI 与 MCP 里都生效（此前文档承诺但代码未读）。
- MCP 的 `agent` 参数可省略，回落到 `AGENT_MEMORY_NAME`。

### 新增

- Claude Code 插件清单 `.claude-plugin/plugin.json`、marketplace 清单与自带 `.mcp.json`。
- 仓库根 `package.json`：`npx github:YQXYK/agent-memory` 与 `npm link` 可用。
- GitHub Actions：Linux/Windows/macOS × Node 18/20/22 跑单元测试，外加端到端冒烟、索引可复现、清单与 LF 检查。

## [0.2.0] - 2026-11-20

### 新增

- 统一 CLI（`init` / `build` / `validate` / `add` / `list` / `template` / `mcp`）。
- 零依赖 MCP stdio server，提供 5 个工具。
- 6 份接入模板，覆盖 AGENTS.md、CLAUDE.md、Cursor rules、系统提示与 MCP 配置。
- `init` 建完结构自动刷新索引（`--no-build` 可关）。
- `validate` 增加索引过期检查与 `--strict`，并忽略编辑器临时文件。
- 33 个 `node:test` 用例。

### 修复

- 长期待修项不再写「N 天」，`build --check` 不会逐日误报。
