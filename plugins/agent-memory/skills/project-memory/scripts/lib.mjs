import fs from 'node:fs';
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
  const raw = name === undefined || name === null || name === '' ? DEFAULT_DIR : String(name);
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
        out[key] = body.slice(eq + 1);
        continue;
      }
      const key = body;
      if (!key) throw new UsageError('参数名不能为空');
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        if (!bools.has(key)) throw new UsageError(`--${key} 需要一个值`);
        out[key] = true;
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
  if (value === true || value === '') throw new UsageError(`--${key} 需要一个值`);
  return String(value);
}

/**
 * 从 cwd 向上找项目根：优先 .git，其次记忆目录本身。
 * dirName 必须一起传，否则改了目录名的项目每次都得手写 --root。
 */
export function findRoot(explicit, dirName = DEFAULT_DIR) {
  if (explicit !== undefined && explicit !== null) {
    if (explicit === true || explicit === '') throw new UsageError('--root 需要一个路径');
    return path.resolve(String(explicit));
  }
  const name = normalizeDirName(dirName);
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    if (fs.existsSync(path.join(dir, name))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
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
      const parts = head.split('|').map((s) => s.trim());
      if (parts.length !== 3) {
        if (head) problems.push({ file, line: i + 1, message: `heading must be "## <date> | <category> | <title>", got "## ${head}"` });
        continue;
      }
      state.entry = {
        file,
        line: i + 1,
        date: parts[0],
        category: parts[1],
        title: parts[2],
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
    const m = /^(error|warn)\s*[:：]\s*(.+)$/.exec(line);
    if (m) { severity = m[1]; pattern = m[2]; }
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
  return t.length <= max ? t : t.slice(0, max - 1) + '…';
}
