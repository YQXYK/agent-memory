---
name: project-memory
description: 项目根有 .agent-memory/ 目录时使用。读取跨会话、跨 agent 的项目结论（约束、坑、待修项），并在收工时把自己验证过的结论追加到 .agent-memory/<自己名字>/conclusions.md。适用于接手陌生代码、改动涉及历史决策、排查"这行为什么这么写"、或需要留下结论给下一个 agent 的场景。不含日常代码修改。
---

# 项目记忆

`<skill-dir>` 是本 SKILL.md 所在目录，脚本都在 `scripts/` 下。用 `node` 运行（Windows 上若 `node` 不在 PATH，用 Codex 自带的 node）。

统一入口是 `scripts/cli.mjs`（或包里的 `agent-memory` 命令）。下面的 `agent-memory` 都指这个入口。

## 开工：先读索引，不要翻目录

1. 读 `.agent-memory/index.md`。这是所有 agent 结论的聚合视图，按状态分组：
   - **待修** 优先看：当前仍有问题，可能就是你这次要处理的。
   - **规则** 和 **坑** 只看跟你这次改动的影响面相关的部分。
   - **失效** 只在你怀疑某条旧记忆还成立时看。
2. 需要某条的完整上下文时，再去读 `.agent-memory/<agent>/conclusions.md` 对应的 `##` 块。
3. 需要结构化读取（按状态/影响面过滤）时：

```bash
node <skill-dir>/scripts/cli.mjs list --status 待修
node <skill-dir>/scripts/cli.mjs list --format json
```

4. `index.md` 不存在或已过期时刷新：

```bash
node <skill-dir>/scripts/cli.mjs build
```

## 收工：只往自己目录追加

**只写 `.agent-memory/<你的名字>/conclusions.md`，永不修改别人的目录，永不手改 `index.md`。**

首次使用先建自己的目录（幂等，已存在则不动任何文件）：

```bash
node <skill-dir>/scripts/cli.mjs init --agent <你的名字>
```

`<你的名字>` 用小写字母、数字、短横线，例如 `codex`、`workbuddy`、`dsh`。同一个 agent 跨会话用同一个名字，不要每次换。

项目若把记忆目录改了名（默认 `.agent-memory`），所有命令都加 `--dir <目录名>`。

追加用命令（会校验五字段并自动刷新索引）：

```bash
node <skill-dir>/scripts/cli.mjs add --agent <你的名字> \
  --title "某个模块的某条约束" \
  --conclusion "必须怎么做 / 绝不能怎么做" \
  --evidence "src/a.ts:42" \
  --impact "db、api" \
  --expiry "改用事务后" \
  --status 规则 --category data-safety
```

也可以手工追加，格式（五字段缺一不可，追加到文件末尾）：

```markdown
## 2026-01-01 | data-safety | 某个模块的某条约束
- 状态: 规则（已修复，防回归）
- 结论: 一句话说清"必须怎么做 / 绝不能怎么做"
- 证据: 路径/文件:行号，或提交哈希，或测试名
- 影响面: 会波及的模块
- 失效条件: 什么情况下这条不再成立
```

手工写完运行 `build` 刷新索引，再运行 `validate` 自检。

## 写什么、不写什么

**写**：改了但看不出来的约束、花时间才查清的根因、会被后人"顺手优化"掉的防御性代码、当前仍未修的坑。

**不写**：这次改了哪些文件（git 有）、代码本身能读出来的东西（命名、结构）、没验证的猜测、`notes.md` 里已有的过程细节。

判断标准：**下一个人读到这条，能不能少踩一个坑？** 不能就别写。

## 状态怎么选

| 状态 | 含义 |
|---|---|
| `规则` | 已验证的约束，后续改动必须遵守 |
| `坑` | 踩过、知道原因、已绕开 |
| `待修` | **当前仍然有问题**，读到的人要警惕或接手 |
| `失效` | 曾经成立，现在不成立（保留以防有人照旧记忆干活） |

旧的结论被推翻时**不要删**，把它改成 `失效` 并补一句为什么。删除会让别人重复踩坑。

## validate

```bash
node <skill-dir>/scripts/cli.mjs validate
```

检查五字段完整性、状态取值、真实日期、标题重复、索引是否过期，以及 `.agent-memory/forbidden.txt` 里的合规规则。
`ERROR` 必须修；`WARN` 看情况。CI 里加 `--strict` 让警告也失败。

## 其他 agent 怎么用

同一个记忆目录，三种接入方式任选：

| 方式 | 适合 | 用法 |
|---|---|---|
| CLI | 有 shell 的 agent | `agent-memory read/append/validate` |
| MCP | Claude Code、Cursor、Zed 等 | `node scripts/mcp.mjs`，工具名 `memory_read` / `memory_append` / `memory_validate` |
| 纯 Markdown | 只能读写文件的 agent | 直接按 `PROTOCOL.md` 读写 |

## 边界

- 这个技能只维护记忆，不改业务代码，不替你判断技术方案。
- 记忆里的结论**不是当前代码的真相**。冲突时以代码和测试为准，并把那条结论改成 `失效`。
- 不要为了"留痕"把 CHANGELOG/TODO 的内容抄进来。那些文档是给人看的，这里是给 agent 看的。
