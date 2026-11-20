# agent-memory

多 agent 协作项目的**分片记忆**：每个 agent 独占写自己名下的目录，工具把各方结论聚合成一份只读索引。

不绑定任何项目、语言、工具或 agent。Codex、Claude Code、Gemini CLI 与支持 Agent Plugins 1.0.0 的客户端可直接装插件，
Cursor/Zed/Claude Desktop 走 MCP，其余 agent 用 CLI 或直接读写 Markdown。

## 为什么这么设计

单一共享记忆文件在多 agent 下必然出问题：两个 agent 同时追加会冲突，一个 agent 的推测会污染另一个的上下文，时间长了没人敢删。这里用两条约束避开：

- **私有写**：`.agent-memory/<agent>/` 只有该 agent 写，零共享写点。
- **聚合读**：`.agent-memory/index.md` 由 `build` 从各目录生成，不是共同追加的文件，永远不会写冲突。

## 目标项目里的目录结构

```
<目标项目根>/.agent-memory/
├── PROTOCOL.md          协议（入库）
├── index.md             聚合索引，插件生成，禁止手改（入库）
├── forbidden.txt        合规拦截正则，默认空（入库）
├── codex/
│   ├── conclusions.md   五字段结构化结论，只增不改（gitignore）
│   └── notes.md         过程流水（gitignore）
└── workbuddy/
```

根下三个文件入库，让换机器、换 agent 后协议和索引立刻可用；各 agent 私有目录不入库，避免把不同人的推理过程混进历史。

> **目录名不能用 `.agents`**：Codex 沙箱把 `.agents`、`.codex`、`.aws` 当受保护配置目录，写入直接 EPERM。默认用 `.agent-memory`，换名用 `--dir`。

## 命令

脚本在 `plugins/agent-memory/skills/project-memory/scripts/`，纯 Node ESM，无第三方依赖，Node 18+ 即可。
统一入口是 `bin/agent-memory.mjs`（安装后即 `agent-memory` 命令）；`scripts/init.mjs` / `build.mjs` / `validate.mjs` 保留为兼容入口。

| 命令 | 作用 |
|---|---|
| `agent-memory init --agent <name>` | 幂等建结构，顺手刷新索引。新 agent 只补建自己目录，不动别人 |
| `agent-memory build` | 聚合生成 `index.md`，按状态分组，标出长期未处理的待修项 |
| `agent-memory validate` | 检查五字段、状态取值、真实日期、标题重复、索引过期，跑合规正则 |
| `agent-memory add` | 追加一条五字段结论并刷新索引（写前自检，失败不落盘） |
| `agent-memory list` | 读结论，支持 `--status` / `--area` 过滤与 `--format json` |
| `agent-memory template` | 输出各 agent 的接入片段，`--list` 查看全部 |
| `agent-memory mcp` | 以 MCP stdio server 方式启动 |

通用参数：

| 参数 | 说明 |
|---|---|
| `--root <path>` | 目标项目根。省略时从 cwd 向上找 `.git` 或记忆目录 |
| `--dir <name>` | 记忆目录名，默认 `.agent-memory`。改过名的项目可省略：工具会自动认出 |
| `--agent <name>` | `init` / `add` 使用，agent 名（小写字母/数字/短横线，≤32） |
| `--check` | `build` 用，只比对不写盘，适合 CI |
| `--strict` | `validate` 用，警告也返回非零，适合 CI |

```bash
node bin/agent-memory.mjs init --agent codex   # 建结构并生成 index.md
node bin/agent-memory.mjs validate --strict    # 自检，CI 用
node bin/agent-memory.mjs list --format json   # 给程序读
```

环境变量可代替常用参数：`AGENT_MEMORY_NAME`、`AGENT_MEMORY_DIR`、`AGENT_MEMORY_ROOT`（空串视为未设置）。
优先级是「命令行 > 环境变量 > 自动探测 > 默认值」，CLI 与 MCP 行为一致。

`init` / `add` 的 agent 名没有默认值：不给 `--agent` 也没设 `AGENT_MEMORY_NAME` 就直接报错，
不会替你猜一个身份往 `codex/` 里写。没给 agent 时 `template` 会保留 `<你的名字>` 占位符。

## 接入一个项目

1. 在项目根运行 `agent-memory init --agent <名字>`（已经 init 过的项目，别的 agent 直接跑同一条命令即可）。
2. 往 `.agent-memory/forbidden.txt` 填该项目的红线正则（没有就留空，不影响使用）。
3. 把对应 agent 的接入片段贴进它的入口文件：`agent-memory template AGENTS --agent <名字>`（Claude 用 `CLAUDE`，Gemini 用 `GEMINI`，Cursor 用 `cursor`，通用系统提示用 `system-prompt`）。
4. 项目 `.gitignore` 加：

```gitignore
.agent-memory/*/
!.agent-memory/*.md
!.agent-memory/forbidden.txt
```

## 安装到 Codex

Codex 从 marketplace 装载插件，仓库内的源码不会被自动发现。在 `~/.codex/config.toml` 加两段：

```toml
[marketplaces.agent-memory-local]
source_type = "local"
source = '<本目录的绝对路径>'

[plugins."agent-memory@agent-memory-local"]
enabled = true
```

重启 Codex，插件会自己把源码物化到 `~/.codex/plugins/cache/agent-memory-local/`（带版本子目录）。
**不要手工往 cache 里拷**——那份目录有版本布局约定，手抄的副本会被当成坏条目。

## 安装到 Claude Code

仓库根有 `.claude-plugin/marketplace.json`，可以直接当 marketplace 加：

```bash
/plugin marketplace add YQXYK/agent-memory
/plugin install agent-memory@agent-memory
```

插件自带 `.mcp.json`，装好后 `memory_read` / `memory_append` 等工具即可用。
用 `AGENT_MEMORY_NAME` 固定身份（例如 `claude`），别让模型每次自己编名字。

## 安装到 Gemini CLI

仓库根有 `gemini-extension.json`，可以直接作为扩展安装：

```bash
gemini extensions install https://github.com/YQXYK/agent-memory
```

扩展会加载根目录的 `GEMINI.md` 作为上下文，并自动注册 `agent-memory` MCP server。
默认 agent 名是 `gemini`，可用扩展设置里的 `AGENT_MEMORY_NAME` 覆盖；
扩展设置还支持 `AGENT_MEMORY_DIR` / `AGENT_MEMORY_ROOT`，会一并注入 MCP server。
升级用 `gemini extensions update agent-memory`，卸载用 `gemini extensions uninstall agent-memory`。

## 安装到支持 Agent Plugins 的客户端

`plugins/agent-memory/` 同时是一个符合 [Agent Plugins 1.0.0](https://agent-plugins.org/) 开放标准的插件包：

| 文件 | 作用 |
|---|---|
| `plugin.json` | 插件元数据（名称、版本、作者、许可） |
| `mcp.json` | 声明 `agent-memory` stdio MCP server |
| `skills/project-memory/` | 提供给客户端的项目记忆 skill |

支持该标准的客户端直接加载 `plugins/agent-memory/` 即可，无需为每个厂商维护单独清单。
清单使用 `${PLUGIN_ROOT}` 定位脚本，不绑定安装路径。

## 安装到其他 agent

### 有 shell 的 agent（Claude Code、Cursor、Aider、自研 agent）

直接用 CLI，无需安装：

```bash
node <本目录>/plugins/agent-memory/bin/agent-memory.mjs list
node <本目录>/plugins/agent-memory/bin/agent-memory.mjs add --agent claude ...
```

想当全局命令用，在仓库根跑 `npm link`（或直接 `npx github:YQXYK/agent-memory`），之后直接 `agent-memory`。

### 支持 MCP 的 agent（Claude Desktop、Claude Code、Cursor、Zed）

把 `templates/mcp.claude-desktop.json` 或 `templates/mcp.cursor.json` 的内容合并进该 agent 的 MCP 配置，替换其中的绝对路径。
server 用 stdio，提供五个工具：

| 工具 | 作用 |
|---|---|
| `memory_init` | 建结构并刷新索引 |
| `memory_read` | 读全部结论，可按 `status` / `area` 过滤 |
| `memory_append` | 追加一条结论并刷新索引 |
| `memory_build` | 重新生成索引 |
| `memory_validate` | 格式与合规自检 |

`memory_read` / `memory_append` 的 `agent` 参数决定写进哪个目录，建议用 `AGENT_MEMORY_NAME` 环境变量固定，别让模型每次自己编。
两个参数都可省略：`agent` 省略时读 `AGENT_MEMORY_NAME`，`root` / `dir` 省略时自动探测。

### 只能读写文件的 agent

不需要任何运行时。让它读 `.agent-memory/PROTOCOL.md` 和 `.agent-memory/index.md`，
按协议往 `.agent-memory/<自己的名字>/conclusions.md` 追加即可。`index.md` 会滞后，
下次有工具的一方跑 `build` 就同步了。

## 目录约定

| 文件 | 入库 | 谁写 |
|---|---|---|
| `PROTOCOL.md` | 是 | `init` 生成，之后人工维护 |
| `index.md` | 是 | 只有 `build` 写 |
| `forbidden.txt` | 是 | 人工维护 |
| `<agent>/conclusions.md` | 否 | 只有该 agent 写，只追加 |
| `<agent>/notes.md` | 否 | 只有该 agent 写，随便写 |

## 开发

```bash
node scripts/test.mjs   # node:test，59 个用例，无第三方依赖
```

测试入口会自己收集 `*.test.mjs`，兼容 Node 18/20/22；不要直接写 `node --test <目录>`，
Node 22 会把目录当模块路径解析。Windows PowerShell 若禁止运行 `npm.ps1`，用上面的命令即可，无需 npm。
CI 在 Ubuntu / Windows / macOS × Node 18 / 20 / 22 上跑同一套用例，外加一次端到端冒烟与索引可复现检查。

## 迁移已有记忆

旧工具留下的 `memory/`、`journal/` 之类是**过程流水**，不是结论。原文留在原地（通常已 gitignore），只把其中**你亲自核对过**的约束提炼进 `conclusions.md`。

把流水整段搬进来会让新目录第一天就背上几百 KB 噪音，且没经过验证的判断会变成"结论"。

## 变更日志

见 [CHANGELOG.md](CHANGELOG.md)。版本号在根 `package.json`、插件 `package.json`、Codex / Claude 插件清单、
Claude marketplace、`gemini-extension.json` 与 Agent Plugins 的 `plugin.json` 里保持一致，CI 会校验。
