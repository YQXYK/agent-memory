所有思考及回答用中文

## 项目记忆

项目记忆在 `.agent-memory/`，是跨会话、跨 agent 的共享结论库。

- **开工先读 `.agent-memory/index.md`**。按状态分组：`待修` 优先；`规则` 和 `坑` 只看与本次改动影响面相关的部分。
- **收工只写 `.agent-memory/codex/conclusions.md`**，追加到末尾，五字段缺一不可。
- 永不修改别人的目录，永不手改 `index.md`。
- 优先用下面的命令，别手写格式（路径相对本仓库根）：

```bash
node plugins/agent-memory/bin/agent-memory.mjs init --agent codex     # 首次，幂等
node plugins/agent-memory/bin/agent-memory.mjs list                   # 读结论
node plugins/agent-memory/bin/agent-memory.mjs add --agent codex ...  # 追加一条并刷新索引
node plugins/agent-memory/bin/agent-memory.mjs validate               # 自检
```

没有命令行时直接读写 Markdown 也可以，格式见 `.agent-memory/PROTOCOL.md`。
