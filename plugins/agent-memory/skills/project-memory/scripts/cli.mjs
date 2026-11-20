#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_DIR,
  UsageError,
  localDate,
  parseArgs,
  rel,
  requireValue,
} from './lib.mjs';
import {
  appendConclusion,
  buildIndex,
  checkAgentName,
  initProject,
  resolveContext,
  validateProject,
} from './core.mjs';

const USAGE = `agent-memory — 多 agent 分片项目记忆

用法:
  agent-memory init --agent <名字> [--root <路径>] [--dir <目录名>] [--no-build]
  agent-memory build [--check] [--root <路径>] [--dir <目录名>]
  agent-memory validate [--strict] [--root <路径>] [--dir <目录名>]
  agent-memory add --agent <名字> --title <标题> --conclusion <结论> --evidence <证据>
                   --impact <影响面> --expiry <失效条件>
                   [--status 规则|坑|待修|失效] [--category <分类>] [--date YYYY-MM-DD]
  agent-memory list [--format md|json] [--status <状态>] [--area <影响面>]
  agent-memory template [--list] [<名称>] [--agent <名字>]
  agent-memory mcp

通用参数:
  --root <路径>   项目根。省略时从 cwd 向上找 .git 或记忆目录
  --dir <目录名>  记忆目录名，默认 ${DEFAULT_DIR}

环境变量:
  AGENT_MEMORY_NAME  默认 agent 名（init/add 可省 --agent）
  AGENT_MEMORY_DIR   默认记忆目录名
  AGENT_MEMORY_ROOT  默认项目根
`;

const TEMPLATE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'templates',
);

function context(args) {
  const dirName = requireValue(args, 'dir', process.env.AGENT_MEMORY_DIR || undefined);
  const root = requireValue(args, 'root', process.env.AGENT_MEMORY_ROOT || undefined);
  return resolveContext({ root, dirName });
}

function agentName(args) {
  return requireValue(args, 'agent', process.env.AGENT_MEMORY_NAME || undefined);
}

function printFindings(findings) {
  for (const f of findings) {
    const label = f.severity === 'error' ? 'ERROR' : 'WARN ';
    console.log(`${label} ${f.file}:${f.line}  ${f.message}`);
  }
}

function cmdInit(args) {
  const ctx = context(args);
  const agent = checkAgentName(agentName(args));
  const result = initProject({ ...ctx, agent });
  const show = (f) => rel(ctx.root, f);

  console.log(`根目录: ${ctx.root}`);
  console.log(`agent : ${agent}`);
  for (const f of result.created) console.log(`  新建 ${show(f)}`);
  for (const f of result.kept) console.log(`  保留 ${show(f)}`);

  if (args['no-build'] === true) return 0;

  const built = buildIndex(ctx);
  console.log(`\n索引  : ${rel(ctx.root, built.target)}（${built.written ? '已刷新' : '已是最新'}）`);
  console.log(`\n下一步: 先读 ${ctx.dirName}/index.md，收工前运行 add 追加一条结论。`);
  return 0;
}

function cmdBuild(args) {
  const ctx = context(args);
  if (!fs.existsSync(ctx.base)) {
    console.error(`未找到 ${ctx.base}，先运行 init。`);
    return 2;
  }
  const result = buildIndex({ ...ctx, check: args.check === true });

  if (args.check === true) {
    if (!result.upToDate) {
      console.error('index.md 已过期，请重新运行 build。');
      return 1;
    }
    console.log('index.md 是最新的。');
    return 0;
  }

  console.log(`已生成 ${rel(ctx.root, result.target)}`);
  console.log(
    `  条目 ${result.entries.length} 条，agent ${result.agents.length} 个，长期未处理 ${result.stale.length} 条`,
  );
  if (result.problems.length) {
    console.log(`  格式问题 ${result.problems.length} 条（运行 validate 查看详情）`);
  }
  return 0;
}

function cmdValidate(args) {
  const ctx = context(args);
  if (!fs.existsSync(ctx.base)) {
    console.error(`未找到 ${ctx.base}，先运行 init。`);
    return 2;
  }
  const { findings, entries } = validateProject(ctx);
  const errors = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warn');
  printFindings([...errors, ...warns]);
  console.log(`\n${entries.length} 条结论，${errors.length} 个错误，${warns.length} 个警告。`);
  if (errors.length) return 1;
  if (args.strict === true && warns.length) return 1;
  return 0;
}

function cmdAdd(args) {
  const ctx = context(args);
  const agent = checkAgentName(agentName(args));
  const result = appendConclusion({
    ...ctx,
    agent,
    date: requireValue(args, 'date', localDate()),
    category: requireValue(args, 'category', 'general'),
    title: requireValue(args, 'title'),
    status: requireValue(args, 'status', '规则'),
    conclusion: requireValue(args, 'conclusion'),
    evidence: requireValue(args, 'evidence'),
    impact: requireValue(args, 'impact'),
    expiry: requireValue(args, 'expiry'),
  });
  buildIndex(ctx);
  console.log(`已追加到 ${result.file}`);
  return 0;
}

function cmdList(args) {
  const ctx = context(args);
  if (!fs.existsSync(ctx.base)) {
    console.error(`未找到 ${ctx.base}，先运行 init。`);
    return 2;
  }
  const { entries, agents } = buildIndex({ ...ctx, check: true });
  const status = args.status === true ? null : args.status;
  const area = args.area === true ? null : args.area;
  const items = entries.filter((e) => {
    if (status && e.status !== status) return false;
    if (area && !String(e.fields['影响面'] || '').includes(area)) return false;
    return true;
  });

  if (args.format === 'json') {
    console.log(
      JSON.stringify(
        {
          root: ctx.root,
          dir: ctx.dirName,
          agents,
          entries: items.map((e) => ({
            agent: e.agent,
            date: e.date,
            category: e.category,
            title: e.title,
            status: e.status,
            conclusion: e.fields['结论'],
            evidence: e.fields['证据'],
            impact: e.fields['影响面'],
            expiry: e.fields['失效条件'],
            file: e.file,
            line: e.line,
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (!items.length) {
    console.log('_暂无_');
    return 0;
  }
  for (const e of items) {
    console.log(`${e.date} | ${e.status} | ${e.title} | ${e.agent} | ${e.file}:${e.line}`);
  }
  return 0;
}

function cmdTemplate(args) {
  if (!fs.existsSync(TEMPLATE_DIR)) {
    console.error(`未找到模板目录: ${TEMPLATE_DIR}`);
    return 2;
  }
  const names = fs
    .readdirSync(TEMPLATE_DIR)
    .filter((n) => fs.statSync(path.join(TEMPLATE_DIR, n)).isFile())
    .sort();

  const target = args._[0];
  if (!target || args.list === true) {
    for (const n of names) console.log(n);
    return 0;
  }

  const match = findTemplate(names, target);
  if (!match) {
    console.error(`未知模板: ${target}`);
    console.error(`可用: ${names.join(', ')}`);
    return 2;
  }
  // 没给 agent 就保留占位符，让使用者自己填，别替他猜一个身份。
  const agent = args.agent || process.env.AGENT_MEMORY_NAME || null;
  const body = fs
    .readFileSync(path.join(TEMPLATE_DIR, match), 'utf8')
    .replaceAll('<你的名字>', agent ?? '<你的名字>')
    .replaceAll('<你自己的名字>', agent ?? '<你自己的名字>');
  process.stdout.write(body);
  return 0;
}

/**
 * 模板名有歧义：`claude` 既是 CLAUDE.md 片段，也出现在 mcp.claude-desktop.json 里。
 * 按"精确名 → 别名 → 前缀 → 包含"的顺序取第一个，别名表兜住常见叫法。
 */
function findTemplate(names, target) {
  const key = String(target).toLowerCase().replace(/\.(md|mdc|json|txt)$/i, '');
  const aliases = {
    agents: 'AGENTS.md.snippet',
    agent: 'AGENTS.md.snippet',
    claude: 'CLAUDE.md.snippet',
    cursor: 'cursor-rules.mdc',
    rules: 'cursor-rules.mdc',
    prompt: 'system-prompt.snippet.txt',
    'system-prompt': 'system-prompt.snippet.txt',
    mcp: 'mcp.claude-desktop.json',
    'mcp-claude': 'mcp.claude-desktop.json',
    'claude-desktop': 'mcp.claude-desktop.json',
    'mcp-cursor': 'mcp.cursor.json',
  };
  if (aliases[key] && names.includes(aliases[key])) return aliases[key];

  const lowered = names.map((n) => n.toLowerCase());
  const exact = lowered.findIndex((n) => n === String(target).toLowerCase());
  if (exact !== -1) return names[exact];

  const prefix = lowered.findIndex((n) => n.startsWith(`${key}.`) || n.startsWith(`${key}-`));
  if (prefix !== -1) return names[prefix];

  const partial = lowered.findIndex((n) => n.includes(key));
  return partial === -1 ? null : names[partial];
}

function dispatch(argv) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return 0;
  }

  const booleans =
    {
      init: ['no-build', 'help'],
      build: ['check', 'help'],
      validate: ['strict', 'help'],
      add: ['help'],
      list: ['help'],
      template: ['list', 'help'],
      mcp: ['help'],
    }[command] || ['help'];
  const args = parseArgs(rest, { booleans });
  if (args.help === true) {
    console.log(USAGE);
    return 0;
  }

  switch (command) {
    case 'init':
      return cmdInit(args);
    case 'build':
      return cmdBuild(args);
    case 'validate':
      return cmdValidate(args);
    case 'add':
      return cmdAdd(args);
    case 'list':
      return cmdList(args);
    case 'template':
      return cmdTemplate(args);
    case 'mcp':
      return 'mcp';
    default:
      console.error(`未知命令: ${command}\n`);
      console.log(USAGE);
      return 2;
  }
}

export function runCli(argv) {
  try {
    return dispatch(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`错误: ${err.message}`);
      console.error('运行 `agent-memory help` 查看用法。');
      return err.exitCode || 2;
    }
    console.error(`错误: ${err && err.message ? err.message : err}`);
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const code = runCli(process.argv.slice(2));
  if (code === 'mcp') {
    await import('./mcp.mjs');
  } else {
    process.exitCode = code;
  }
}
