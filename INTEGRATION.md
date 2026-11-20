# 接入其他 agent

这个插件的核心不是 Codex，是 `.agent-memory/` 目录加一份 Markdown 协议。
任何能读写文件的 agent 都能用；有 shell 或 MCP 的 agent 可以走更省事的工具层。

## 三种接入方式

| 能力 | 方式 | 说明 |
|---|---|---|
| 有 shell + Node | CLI | 调 `agent-memory` 命令，格式与索引由工具保证 |
| 支持 MCP | MCP server | 调 `memory_read` / `memory_append` / `memory_validate`，模型不用拼路径 |
| 只能读写文件 | 纯 Markdown | 直接按 `PROTOCOL.md` 读写，索引靠有工具的一方刷新 |

三种方式共用同一个目录，可以混用。没有 Node 也能用：`conclusions.md` 是纯 Markdown，格式对就行，
`build` 只是把多份文件合成一份视图，不是记忆本身。

`root` / `dir` / `agent` 三个参数在 CLI 与 MCP 里都可省略：`root` 从 cwd 向上找 `.git` 或记忆目录，
`dir` 会自动认出改过名的目录，`agent` 回落到 `AGENT_MEMORY_NAME`。用环境变量固定身份，比让模型每次传参可靠。

## 通用接入片段

贴进目标项目的 `AGENTS.md` / `CLAUDE.md` / `.cursor/rules` / 系统提示词，或该 agent 的等价入口文件。
用 `agent-memory template <名称>` 输出，`--agent <名字>` 替换其中的占位符。

```markdown
## 项目记忆

项目记忆在 `.agent-memory/`，是跨会话、跨 agent 的共享结论库。

- **开工先读 `.agent-memory/index.md`**。按状态分组：`待修` 优先；`规则` 和 `坑` 只看与本次改动影响面相关的部分。
- **收工只写 `.agent-memory/<你的名字>/conclusions.md`**，追加到末尾，五字段缺一不可。
- 永不修改别人的目录，永不手改 `index.md`。
- 协议全文见 `.agent-memory/PROTOCOL.md`。
```

现成模板：

| 模板 | 用于 |
|---|---|
| `AGENTS.md.snippet` | Codex、以及任何读 `AGENTS.md` 的 agent |
| `CLAUDE.md.snippet` | Claude Code |
| `cursor-rules.mdc` | Cursor 的 project rules |
| `system-prompt.snippet.txt` | 没有约定入口文件的 agent，贴进系统提示 |
| `mcp.claude-desktop.json` | Claude Desktop 的 MCP 配置 |
| `mcp.cursor.json` | Cursor 的 MCP 配置 |

## agent 命名

同一个 agent 跨会话固定用同一个名字，不要每次换，否则目录会散成一堆。

建议直接用工具名：`codex`、`claude`、`cursor`、`workbuddy`、`dsh`。
名字只能是小写字母、数字、短横线，最长 32。

## 不共享写点

如果某个 agent 坚持要"统一写一个文件"，那它就是错的。两个进程同时追加同一个文件，在没有锁的情况下必然丢内容。
要么它只写自己目录，要么它不参与。

## 各 agent 的最小配置

**Claude Code**

```bash
/plugin marketplace add YQXYK/agent-memory
/plugin install agent-memory@agent-memory
```

插件自带 MCP server，无需再手写配置。不用插件的话，退回下面的 CLI 方式：

```bash
node <repo>/plugins/agent-memory/bin/agent-memory.mjs init --agent claude
node <repo>/plugins/agent-memory/bin/agent-memory.mjs template CLAUDE --agent claude >> CLAUDE.md
```

**Cursor**

```bash
node <repo>/plugins/agent-memory/bin/agent-memory.mjs init --agent cursor
node <repo>/plugins/agent-memory/bin/agent-memory.mjs template cursor --agent cursor > .cursor/rules/agent-memory.mdc
```

**Claude Desktop / 其他 MCP 客户端**

把 `templates/mcp.claude-desktop.json` 合并进客户端配置，替换绝对路径，并设 `AGENT_MEMORY_NAME`。

**无工具 agent**

把 `templates/system-prompt.snippet.txt` 贴进系统提示，并把 `.agent-memory/PROTOCOL.md` 作为上下文提供。
