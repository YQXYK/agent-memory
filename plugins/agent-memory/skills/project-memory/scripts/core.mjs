import fs from 'node:fs';
import path from 'node:path';
import {
  AGENT_RE,
  DEFAULT_DIR,
  UsageError,
  agentDirs,
  baseDir,
  detectMemoryDir,
  findRoot,
  isValidDate,
  loadAll,
  normalizeDirName,
  parseConclusions,
  readForbidden,
  readText,
  rel,
  writeText,
} from './lib.mjs';
import { findStale, indexMatches, renderIndex } from './render.mjs';

export const IGNORED_STRAY = /^(\.|~|#)|(~$|\.(swp|swo|tmp|bak|orig|rej|log)$)/i;

export function protocolText(dirName) {
  return `# 项目记忆协议

本目录是**任意项目**都能用的多 agent 共享记忆区。插件不绑定具体项目：目录名、agent 名、合规规则都由使用方决定。

## 0. 怎么接入一个新项目

1. 在项目根运行 \`agent-memory init --agent <你的名字>\`，生成 \`${dirName}/\` 结构。
2. 往 \`forbidden.txt\` 加本项目的红线（没有就留空，不影响使用）。
3. 在项目的 \`AGENTS.md\`（或等价入口文件）里加一句：开工读 \`${dirName}/index.md\`，收工写 \`${dirName}/<agent>/conclusions.md\`。
4. 项目 \`.gitignore\` 加 \`${dirName}/*/\`（私有目录不入库），根下三个文件保留。

四条规则如下。

## 1. 私有写，聚合读

- 每个 agent **只写** \`${dirName}/<自己的名字>/\`，绝不修改别人的目录。
- 根下 \`index.md\` 由插件生成，**任何 agent 都不许手改**。
- 需要读全项目结论时读 \`index.md\`，不要逐个翻别人的目录。

## 2. 结论与过程分开

- \`conclusions.md\`：只放**可复用结论**，每条一个 \`##\` 块，只增不改。
- \`notes.md\`：过程流水、调试记录、临时推测，随便写，不进索引。
- 判断标准：下一个人读到这条，能不能少踩一个坑？不能就别写进 conclusions。

## 3. 结论必须是五字段

\`\`\`markdown
## 2026-01-01 | data-safety | 某个模块的某条约束
- 状态: 规则（已修复，防回归）
- 结论: 一句话说清"必须怎么做 / 绝不能怎么做"
- 证据: 路径/文件:行号，或提交哈希，或测试名
- 影响面: 会波及的模块
- 失效条件: 什么情况下这条不再成立
\`\`\`

- \`## <日期> | <分类> | <标题>\`：分类用短横线小写，标题写"哪个对象 + 什么事"。
- **状态** 只能是四种之一，后缀可以补充说明：
  - \`规则\`：已验证的约束，后续改动必须遵守。
  - \`坑\`：踩过的坑，知道原因，已绕开。
  - \`待修\`：**当前仍然有问题**，读到的人要警惕或接手。
  - \`失效\`：曾经成立，现在不成立（保留是为了防止有人照旧记忆干活）。
- **证据** 必须是可核对的位置：\`路径:行号\`、提交哈希、测试名。没有证据的结论不要写。
- **影响面** 写会波及的模块，方便别人判断"这条跟我有没有关系"。
- **失效条件** 写清什么情况下这条不再成立。写不出来说明你还没想清楚。

## 4. 合规（可选）

\`${dirName}/forbidden.txt\` 里的正则会拦截违规内容。**默认留空**，由使用方按自己项目的红线填。
写记忆时**新写的文字本身**也要过项目红线。
`;
}

export const CONCLUSIONS_HEADER = `# 结论

只追加，每条一个 \`##\` 块，五字段缺一不可。格式见 ../PROTOCOL.md。

`;

export const NOTES_HEADER = `# 过程记录

按时间倒序追加，格式随意。这里的内容不进索引。

`;

export const FORBIDDEN_HEADER = `# 合规拦截规则（validate 使用，正则，大小写不敏感）
# 一行一条，可加前缀 "error:"（默认）或 "warn:"
# 示例：
# error: \\bexample\\.com\\b
`;

/**
 * 未显式给 --dir 时，允许沿用项目里已有的记忆目录名。
 * 否则 `init --dir .mem` 之后所有命令都得手写 --dir，等于半个坑。
 */
export function resolveContext(options = {}) {
  const explicit = options.dirName ? normalizeDirName(options.dirName) : null;
  const root = findRoot(options.root, explicit || DEFAULT_DIR);
  const resolvedName = explicit || detectMemoryDir(root) || DEFAULT_DIR;
  const base = options.base ? path.resolve(String(options.base)) : baseDir(root, { dir: resolvedName });
  return { root, base, dirName: rel(root, base) || resolvedName };
}

export function checkAgentName(agent) {
  if (agent === undefined || agent === null || agent === '') {
    throw new UsageError('缺少 agent 名：用 --agent <名字> 或设置 AGENT_MEMORY_NAME');
  }
  if (typeof agent !== 'string' || !AGENT_RE.test(agent)) {
    throw new UsageError(
      `agent 名不合法: "${agent}"（只允许小写字母、数字、短横线，最长 32）`,
    );
  }
  return agent;
}

/**
 * 幂等建结构。只补建缺失文件，永不覆盖已有内容。
 */
export function initProject({ root, base, dirName, agent }) {
  checkAgentName(agent);
  const created = [];
  const kept = [];

  const ensure = (file, content) => {
    if (fs.existsSync(file)) {
      kept.push(file);
      return;
    }
    writeText(file, content);
    created.push(file);
  };

  fs.mkdirSync(base, { recursive: true });
  ensure(path.join(base, 'PROTOCOL.md'), protocolText(dirName));
  ensure(path.join(base, 'forbidden.txt'), FORBIDDEN_HEADER);

  const dir = path.join(base, agent);
  fs.mkdirSync(dir, { recursive: true });
  ensure(path.join(dir, 'conclusions.md'), CONCLUSIONS_HEADER);
  ensure(path.join(dir, 'notes.md'), NOTES_HEADER);

  return { created, kept, agentDir: dir };
}

export function loadMemory({ root, base }) {
  const { entries, problems, agents } = loadAll(root, base);
  return { entries, problems, agents };
}

export function buildIndex({ root, base, dirName, check = false, now = new Date() }) {
  const { entries, problems, agents } = loadMemory({ root, base });
  const rendered = renderIndex({ entries, agents, dirName, now });
  const target = path.join(base, 'index.md');
  const previous = fs.existsSync(target) ? readText(target) : null;
  const upToDate = indexMatches(rendered, previous);

  if (!check && !upToDate) writeText(target, rendered);

  return {
    target,
    rendered,
    upToDate,
    written: !check && !upToDate,
    entries,
    agents,
    problems,
    stale: findStale(entries, now),
  };
}

function scanRules(root, base, rules, findings) {
  const dirName = rel(root, base);
  const targets = [];
  for (const agent of agentDirs(base)) {
    for (const name of ['conclusions.md', 'notes.md']) {
      const f = path.join(base, agent, name);
      if (fs.existsSync(f)) targets.push(f);
    }
  }
  const protocol = path.join(base, 'PROTOCOL.md');
  if (fs.existsSync(protocol)) targets.push(protocol);

  for (const rule of rules) {
    if (rule.invalid) {
      findings.push({
        severity: 'error',
        file: `${dirName}/forbidden.txt`,
        line: rule.line,
        message: `正则无效: ${rule.message}`,
      });
      continue;
    }
    for (const file of targets) {
      const lines = readText(file).split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = rule.re.exec(lines[i]);
        if (!m) continue;
        findings.push({
          severity: rule.severity,
          file: rel(root, file),
          line: i + 1,
          message: `命中禁用规则 /${rule.source}/ → "${m[0]}"`,
        });
      }
    }
  }
}

export function validateProject({ root, base, dirName, now = new Date() }) {
  const findings = [];
  const dirLabel = rel(root, base) || dirName;

  if (!fs.existsSync(path.join(base, 'PROTOCOL.md'))) {
    findings.push({ severity: 'error', file: `${dirLabel}/PROTOCOL.md`, line: 1, message: '缺少协议文件' });
  }
  if (!fs.existsSync(path.join(base, 'index.md'))) {
    findings.push({ severity: 'warn', file: `${dirLabel}/index.md`, line: 1, message: '索引不存在，运行 build 生成' });
  }

  const { entries, problems, agents } = loadMemory({ root, base });
  for (const p of problems) {
    findings.push({ severity: 'error', file: p.file, line: p.line, message: p.message });
  }

  for (const agent of agentDirs(base)) {
    const dir = path.join(base, agent);
    const stray = fs.readdirSync(dir).filter(
      (n) => !['conclusions.md', 'notes.md'].includes(n) && !IGNORED_STRAY.test(n),
    );
    for (const n of stray) {
      findings.push({
        severity: 'warn',
        file: `${dirLabel}/${agent}/${n}`,
        line: 1,
        message: '非约定文件，agent 目录只应有 conclusions.md 与 notes.md',
      });
    }
    if (!fs.existsSync(path.join(dir, 'conclusions.md'))) {
      findings.push({ severity: 'warn', file: `${dirLabel}/${agent}/`, line: 1, message: '缺少 conclusions.md' });
    }
  }

  const seen = new Map();
  for (const e of entries) {
    const key = `${e.category}::${e.title}`;
    if (seen.has(key)) {
      findings.push({
        severity: 'warn',
        file: e.file,
        line: e.line,
        message: `与 ${seen.get(key)} 标题重复（${e.title}），后写的若取代前者，应把前者状态改为 失效`,
      });
    } else {
      seen.set(key, `${e.file}:${e.line}`);
    }
  }

  const indexFile = path.join(base, 'index.md');
  if (fs.existsSync(indexFile)) {
    const expected = renderIndex({ entries, agents, dirName: dirLabel, now });
    if (!indexMatches(expected, readText(indexFile))) {
      findings.push({
        severity: 'warn',
        file: `${dirLabel}/index.md`,
        line: 1,
        message: '索引已过期，运行 build 重新生成',
      });
    }
  }

  scanRules(root, base, readForbidden(base), findings);
  return { findings, entries, agents };
}

function oneLineField(value) {
  return String(value || '').replace(/\r?\n/g, ' ').trim();
}

// 标题里的 | 是分隔符，必须转义，否则整条结论的标题会被截断成多段。
function headingField(value) {
  return oneLineField(value).replace(/\|/g, '\\|');
}

/**
 * 追加一条五字段结论。写入前先用同一套解析器自检，
 * 避免把格式错误的内容写进只增不改的文件。
 */
export function appendConclusion({ root, base, agent, date, category, title, status, conclusion, evidence, impact, expiry }) {
  checkAgentName(agent);
  const required = { 状态: status, 结论: conclusion, 证据: evidence, 影响面: impact, 失效条件: expiry };
  for (const [key, value] of Object.entries(required)) {
    if (!oneLineField(value)) throw new UsageError(`缺少字段: ${key}`);
  }
  if (!isValidDate(String(date))) throw new UsageError(`日期应为真实存在的 YYYY-MM-DD: ${date}`);
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(String(category))) {
    throw new UsageError(`分类应为小写字母/数字/短横线: ${category}`);
  }
  if (!oneLineField(title)) throw new UsageError('标题不能为空');

  const block = [
    `## ${date} | ${category} | ${headingField(title)}`,
    `- 状态: ${oneLineField(status)}`,
    `- 结论: ${oneLineField(conclusion)}`,
    `- 证据: ${oneLineField(evidence)}`,
    `- 影响面: ${oneLineField(impact)}`,
    `- 失效条件: ${oneLineField(expiry)}`,
    '',
  ].join('\n');

  const parsed = parseConclusions(block, '<new entry>');
  if (parsed.problems.length) {
    throw new UsageError(`结论格式不合法: ${parsed.problems[0].message}`);
  }

  // 协议要求新写的文字本身也过红线，所以 add 在落盘前就拦，而不是等 validate 事后报。
  const hits = [];
  for (const rule of readForbidden(base)) {
    if (rule.invalid) {
      throw new UsageError(`${rel(root, path.join(base, 'forbidden.txt'))}:${rule.line} 正则无效: ${rule.message}`);
    }
    if (rule.severity !== 'error') continue;
    const m = rule.re.exec(block);
    if (m) hits.push(`/${rule.source}/ → "${m[0]}"`);
  }
  if (hits.length) {
    throw new UsageError(`命中项目禁用规则，未写入: ${hits.join('；')}`);
  }

  const dir = path.join(base, agent);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'conclusions.md');
  if (!fs.existsSync(file)) writeText(file, CONCLUSIONS_HEADER);
  const previous = readText(file);
  const separator = previous.endsWith('\n\n') ? '' : previous.endsWith('\n') ? '\n' : '\n\n';
  fs.appendFileSync(file, `${separator}${block}`, 'utf8');

  return { file: rel(root, file), block };
}
