import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REQUIRED_FIELDS = ['状态', '结论', '证据', '影响面', '失效条件'];
export const STATUSES = ['规则', '坑', '待修', '失效'];

export const AGENT_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

// 不能用 .agents：Codex 沙箱把它当配置目录，默认只读。
export const DEFAULT_DIR = '.agent-memory';

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.exitCode = 2;
  }
}

export function normalizeDirName(name) {
  const raw =
    name === undefined || name === null || String(name).trim() === '' ? DEFAULT_DIR : String(name);
  const normalized = raw.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    parts.some((p) => p === '' || p === '.' || p === '..')
  ) {
    throw new UsageError(`--dir 不合法: "${raw}"（需要项目内的相对目录名）`);
  }
  return normalized;
}

export function baseDir(root, args) {
  const name = normalizeDirName(args && args.dir !== true ? args.dir : undefined);
  return path.join(root, name);
}

/**
 * 解析 --key value 与布尔开关。
 * 只有显式声明在 booleans 里的参数才允许不带值，否则直接报错，
 * 避免 `--agent` 被静默解析成字符串 "true" 并建出 .agent-memory/true/。
 */
export function parseArgs(argv, { booleans = [] } = {}) {
  const out = { _: [] };
  const bools = new Set(booleans);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        const key = body.slice(0, eq);
        if (!key) throw new UsageError('参数名不能为空');
        const value = body.slice(eq + 1);
        if (bools.has(key)) {
          if (value === 'true') out[key] = true;
          else if (value === 'false') out[key] = false;
          else throw new UsageError(`--${key} 只接受 true 或 false`);
        } else {
          if (value === '') throw new UsageError(`--${key} 需要一个值`);
          out[key] = value;
        }
        continue;
      }
      const key = body;
      if (!key) throw new UsageError('参数名不能为空');
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        if (!bools.has(key)) throw new UsageError(`--${key} 需要一个值`);
        out[key] = true;
      } else if (bools.has(key)) {
        if (next === 'true') out[key] = true;
        else if (next === 'false') out[key] = false;
        // 不是 true/false 时按开关处理，把下一个词留给位置参数；
        // 这样 `template --list AGENTS` 不会被误判成布尔值。
        else out[key] = true;
        if (next === 'true' || next === 'false') i++;
      } else {
        out[key] = next;
        i++;
      }
    } else if (a.startsWith('-') && a.length > 1) {
      const key = a.slice(1);
      if (!bools.has(key)) throw new UsageError(`-${key} 需要一个值（短参数只支持布尔开关）`);
      out[key] = true;
    } else out._.push(a);
  }
  return out;
}

export function requireValue(args, key, fallback) {
  const value = args[key];
  if (value === undefined) return fallback;
  if (value === true || value === false || value === '') throw new UsageError(`--${key} 需要一个值`);
  return String(value);
}

/** 环境变量里的空串等同未设置，避免扩展注入 "" 后误报参数缺值。 */
export function envValue(name) {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}

function samePath(a, b) {
  const relative = path.relative(a, b);
  // Windows 路径大小写不敏感，直接字符串比较会漏掉 C:\Users\A 与 C:\Users\a 这种差异。
  return relative === '' || (process.platform === 'win32' && relative.toLowerCase() === '');
}

/**
 * 从 cwd 向上找项目根：优先 .git，其次记忆目录本身。
 * dirName 必须一起传，否则改了目录名的项目每次都得手写 --root。
 * probe 为真时，还会识别根下任何名字的记忆目录（用户用 --dir 改过名的项目）。
 */
export function findRoot(explicit, dirName = DEFAULT_DIR, { probe = true } = {}) {
  if (explicit !== undefined && explicit !== null) {
    if (explicit === true || explicit === '') throw new UsageError('--root 需要一个路径');
    const resolved = path.resolve(String(explicit));
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw new UsageError(`--root 指向的目录不存在: ${resolved}`);
    }
    if (!stat.isDirectory()) throw new UsageError(`--root 不是目录: ${resolved}`);
    return resolved;
  }
  const name = normalizeDirName(dirName);
  const cwd = process.cwd();
  // 家目录是硬边界：再往上探测只会捡到与项目无关的目录，把别人的记忆区当成自己的。
  const home = path.resolve(os.homedir());
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    if (fs.existsSync(path.join(dir, name))) return dir;
    // 已经站在记忆目录里（非 git 项目常见）：项目根就是它的父目录。
    if (isMemoryDir(dir)) {
      const parent = path.dirname(dir);
      return parent === dir ? dir : parent;
    }
    if (samePath(dir, home)) return cwd;
    if (probe && detectMemoryDir(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return cwd;
    dir = parent;
  }
}

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  'coverage',
]);

// 向上探测时每一级都要扫一遍子目录，给个上限免得在用户主目录/盘符根上跑很久。
const PROBE_MAX_DEPTH = 3;
const PROBE_LIMIT = 2000;

/**
 * 只认带 PROTOCOL.md 且标题对得上的目录，避免把随便一个含 PROTOCOL.md 的文档目录
 * 当成记忆区。默认目录名优先，其次扫描根下直接子目录。
 */
export function isMemoryDir(dir) {
  const protocol = path.join(dir, 'PROTOCOL.md');
  if (!fs.existsSync(protocol)) return false;
  try {
    return readText(protocol).includes('项目记忆协议');
  } catch {
    return false;
  }
}

export function detectMemoryDir(root) {
  if (isMemoryDir(path.join(root, DEFAULT_DIR))) return DEFAULT_DIR;

  // 广度优先，浅层优先：默认目录之外还支持 docs/memory 这种嵌套目录名。
  let queue = [root];
  let scanned = 0;
  for (let depth = 1; depth <= PROBE_MAX_DEPTH && queue.length; depth++) {
    const next = [];
    const hits = [];
    for (const dir of queue) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        if (!ent.isDirectory() || SKIP_DIRS.has(ent.name)) continue;
        if (++scanned > PROBE_LIMIT) break;
        const child = path.join(dir, ent.name);
        // isMemoryDir 先 stat 再读 PROTOCOL.md，足以排除无关目录；
        // 不能额外要求 index.md，否则 `init --no-build` 改过名的项目永远探测不到。
        if (fs.existsSync(path.join(child, 'PROTOCOL.md')) && isMemoryDir(child)) {
          hits.push(child);
          // 命中记忆区后不再往里扫：agent 目录再多也不该算作候选。
          continue;
        }
        next.push(child);
      }
      if (scanned > PROBE_LIMIT) break;
    }
    if (hits.length === 1) return rel(root, hits[0]);
    if (hits.length > 1) return null;
    if (scanned > PROBE_LIMIT) break;
    queue = next;
  }
  return null;
}

/**
 * 按未转义的分隔符切分：标题里允许出现 `\|`，不能因此把一行切成四段。
 */
export function splitUnescaped(text, sep) {
  const out = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === sep) {
      cur += sep;
      i++;
      continue;
    }
    if (ch === sep) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// 本地日期，不能用 toISOString：那是 UTC，东八区晚上会差一天。
export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 形状对不代表日期存在：2026-13-45 也能过 \d{4}-\d{2}-\d{2}。
 * 这里按 UTC 构造再回读，月份溢出、2 月 30 日都会被挡住。
 */
export function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1970 || y > 9999) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function readText(file) {
  const text = fs.readFileSync(file, 'utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.replace(/\r\n/g, '\n'), 'utf8');
}

export function rel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function flushEntry(state, entries, problems) {
  const cur = state.entry;
  if (!cur) return;
  for (const f of REQUIRED_FIELDS) {
    if (!cur.fields[f] || !cur.fields[f].trim()) {
      problems.push({ file: cur.file, line: cur.line, message: `missing field: ${f}` });
    }
  }
  if (!STATUSES.includes(cur.status)) {
    problems.push({
      file: cur.file,
      line: cur.line,
      message: `unknown 状态 "${cur.status}" (expected one of ${STATUSES.join(' / ')})`,
    });
  }
  if (!isValidDate(cur.date)) {
    problems.push({
      file: cur.file,
      line: cur.line,
      message: `bad date "${cur.date}" (want a real YYYY-MM-DD date)`,
    });
  }
  if (!AGENT_RE.test(cur.category || '')) {
    problems.push({
      file: cur.file,
      line: cur.line,
      message: `bad category "${cur.category}" (want lowercase a-z 0-9 -)`,
    });
  }
  entries.push(cur);
  state.entry = null;
  state.field = null;
}

export function parseConclusions(text, file) {
  const entries = [];
  const problems = [];
  const state = { entry: null, field: null };
  let inFence = false;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, '');

    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;

    if (line.startsWith('## ')) {
      flushEntry(state, entries, problems);
      const head = line.slice(3).trim();
      const parts = splitUnescaped(head, '|').map((s) => s.trim());
      // 标题里允许有未转义的 |：多出来的段并回标题，比直接报错宽容。
      if (parts.length < 3) {
        if (head) problems.push({ file, line: i + 1, message: `heading must be "## <date> | <category> | <title>", got "## ${head}"` });
        continue;
      }
      state.entry = {
        file,
        line: i + 1,
        date: parts[0],
        category: parts[1],
        title: parts.slice(2).join(' | '),
        fields: {},
        status: '',
      };
      continue;
    }

    if (!state.entry) continue;

    const field = /^[-*]\s*([^:：]{1,12})[:：]\s*(.*)$/.exec(line);
    if (field) {
      const key = field[1].trim();
      state.entry.fields[key] = field[2];
      if (key === '状态') {
        state.entry.status = field[2].trim().split(/[（(\s]/)[0];
      }
      state.field = key;
      continue;
    }

    if (line.trim() && state.field) {
      state.entry.fields[state.field] += '\n' + line.trim();
    }
  }
  flushEntry(state, entries, problems);
  return { entries, problems };
}

export function agentDirs(base) {
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && AGENT_RE.test(d.name))
    .map((d) => d.name)
    .sort();
}

export function loadAll(root, base) {
  const entries = [];
  const problems = [];
  const agents = [];
  for (const agent of agentDirs(base)) {
    const file = path.join(base, agent, 'conclusions.md');
    if (!fs.existsSync(file)) continue;
    agents.push(agent);
    const parsed = parseConclusions(readText(file), rel(root, file));
    for (const e of parsed.entries) entries.push({ ...e, agent });
    problems.push(...parsed.problems);
  }
  return { entries, problems, agents };
}

export function readForbidden(base) {
  const file = path.join(base, 'forbidden.txt');
  if (!fs.existsSync(file)) return [];
  const rules = [];
  const lines = readText(file).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    let severity = 'error';
    let pattern = line;
    const m = /^(error|warn)\s*[:：]\s*(.+)$/i.exec(line);
    if (m) { severity = m[1]; pattern = m[2]; }
    severity = severity.toLowerCase();
    try {
      rules.push({ re: new RegExp(pattern, 'i'), severity, source: pattern, line: i + 1 });
    } catch (err) {
      rules.push({ invalid: true, severity: 'error', source: pattern, line: i + 1, message: err.message });
    }
  }
  return rules;
}

export function oneLine(s) {
  return String(s || '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
}

export function truncate(s, max) {
  const t = oneLine(s);
  if (t.length <= max) return t;
  let cut = t.slice(0, max - 1);
  // 别把转义序列 `\|` 切成孤零零的反斜杠，否则表格列会被吞掉。
  const trailing = /\\+$/.exec(cut);
  if (trailing && trailing[0].length % 2 === 1) cut = cut.slice(0, -1);
  return `${cut}…`;
}
