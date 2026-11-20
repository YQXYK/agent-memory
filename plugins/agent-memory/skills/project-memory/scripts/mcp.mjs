#!/usr/bin/env node
/**
 * 极简 MCP stdio server：只用 JSON-RPC 换行分隔，无第三方依赖。
 * 这样 Claude Code / Cursor / Zed 等支持 MCP 的 agent 都能直接调，
 * 不必各自实现「读哪个文件、写哪个文件」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DEFAULT_DIR, UsageError, localDate, readText } from './lib.mjs';
import {
  appendConclusion,
  buildIndex,
  checkAgentName,
  initProject,
  resolveContext,
  validateProject,
} from './core.mjs';
import { indexMatches } from './render.mjs';

const require = createRequire(import.meta.url);
const pkg = (() => {
  try {
    // scripts/ -> project-memory/ -> skills/ -> 包根
    return require('../../../package.json');
  } catch {
    return { name: 'agent-memory', version: '0.2.0' };
  }
})();

const PROTOCOL_VERSION = '2024-11-05';

const S = {
  type: 'object',
  properties: {
    root: { type: 'string', description: '项目根目录，省略则从 cwd 向上查找' },
    dir: { type: 'string', description: `记忆目录名，默认 ${DEFAULT_DIR}` },
    agent: {
      type: 'string',
      description: 'agent 名（小写字母/数字/短横线）。省略时用 AGENT_MEMORY_NAME 环境变量',
    },
  },
};

// 建议客户端用 AGENT_MEMORY_NAME 固定身份，别让模型每次自己编名字。
function agentOf(args) {
  return checkAgentName(args.agent || process.env.AGENT_MEMORY_NAME);
}

const TOOLS = [
  {
    name: 'memory_init',
    description: '幂等创建记忆目录结构，并刷新索引。不会覆盖已有文件。',
    inputSchema: {
      type: 'object',
      properties: {
        ...S.properties,
        agent: S.properties.agent,
        build: { type: 'boolean', description: '是否顺手刷新 index.md，默认 true' },
      },
      required: [],
    },
  },
  {
    name: 'memory_read',
    description: '读取聚合索引 index.md 与全部结构化结论，开工时先调这个。',
    inputSchema: {
      type: 'object',
      properties: {
        ...S.properties,
        status: { type: 'string', enum: ['规则', '坑', '待修', '失效'], description: '只看某个状态' },
        area: { type: 'string', description: '只看影响面包含该词的条目' },
        format: { type: 'string', enum: ['json', 'markdown'], description: '默认 json' },
      },
    },
  },
  {
    name: 'memory_append',
    description: '往自己的 conclusions.md 追加一条五字段结论，并刷新索引。只追加，不修改。',
    inputSchema: {
      type: 'object',
      properties: {
        ...S.properties,
        agent: S.properties.agent,
        title: { type: 'string', description: '哪个对象 + 什么事' },
        conclusion: { type: 'string', description: '一句话说清必须怎么做 / 绝不能怎么做' },
        evidence: { type: 'string', description: '路径:行号、提交哈希或测试名' },
        impact: { type: 'string', description: '会波及的模块' },
        expiry: { type: 'string', description: '什么情况下这条不再成立' },
        status: { type: 'string', enum: ['规则', '坑', '待修', '失效'], description: '默认 规则' },
        category: { type: 'string', description: '分类，小写字母/数字/短横线，默认 general' },
        date: { type: 'string', description: 'YYYY-MM-DD，默认今天' },
      },
      required: ['title', 'conclusion', 'evidence', 'impact', 'expiry'],
    },
  },
  {
    name: 'memory_build',
    description: '由各 agent 的 conclusions.md 重新聚合生成 index.md。',
    inputSchema: { type: 'object', properties: S.properties },
  },
  {
    name: 'memory_validate',
    description: '校验五字段、状态取值、标题重复、索引过期与 forbidden.txt 合规规则。',
    inputSchema: { type: 'object', properties: S.properties },
  },
];

function ctxOf(args = {}) {
  return resolveContext({
    root: args.root || process.env.AGENT_MEMORY_ROOT,
    dirName: args.dir || process.env.AGENT_MEMORY_DIR || DEFAULT_DIR,
  });
}

function text(value) {
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text: body }] };
}

const HANDLERS = {
  memory_init(args) {
    const ctx = ctxOf(args);
    const agent = agentOf(args);
    const result = initProject({ ...ctx, agent });
    const built = args.build === false ? null : buildIndex(ctx);
    return text({
      root: ctx.root,
      dir: ctx.dirName,
      agent,
      created: result.created,
      kept: result.kept,
      index: built ? { file: built.target, written: built.written } : null,
    });
  },

  memory_read(args) {
    const ctx = ctxOf(args);
    if (!fs.existsSync(ctx.base)) {
      throw new UsageError(`未找到 ${ctx.base}，先调用 memory_init`);
    }
    const { entries, agents } = buildIndex({ ...ctx, check: true });
    const items = entries.filter((e) => {
      if (args.status && e.status !== args.status) return false;
      if (args.area && !String(e.fields['影响面'] || '').includes(args.area)) return false;
      return true;
    });
    if (args.format === 'markdown') {
      const indexFile = path.join(ctx.base, 'index.md');
      const built = buildIndex({ ...ctx, check: true });
      if (!fs.existsSync(indexFile)) return text(built.rendered);
      const current = readText(indexFile);
      // 索引过期时返回现算的结果，别把旧快照当真相喂给模型。
      return text(indexMatches(built.rendered, current) ? current : built.rendered);
    }
    return text({
      root: ctx.root,
      dir: ctx.dirName,
      agents,
      total: items.length,
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
    });
  },

  memory_append(args) {
    const ctx = ctxOf(args);
    const result = appendConclusion({
      ...ctx,
      agent: agentOf(args),
      date: args.date || localDate(),
      category: args.category || 'general',
      title: args.title,
      status: args.status || '规则',
      conclusion: args.conclusion,
      evidence: args.evidence,
      impact: args.impact,
      expiry: args.expiry,
    });
    const built = buildIndex(ctx);
    return text({ file: result.file, index: { file: built.target, written: built.written } });
  },

  memory_build(args) {
    const ctx = ctxOf(args);
    const result = buildIndex(ctx);
    return text({
      file: result.target,
      written: result.written,
      entries: result.entries.length,
      agents: result.agents,
      stale: result.stale.length,
    });
  },

  memory_validate(args) {
    const ctx = ctxOf(args);
    const { findings, entries } = validateProject(ctx);
    return text({
      ok: !findings.some((f) => f.severity === 'error'),
      entries: entries.length,
      findings,
    });
  },
};

function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: pkg.name, version: pkg.version },
        instructions:
          '项目记忆。开工先调 memory_read 读结论；收工只调 memory_append 追加自己验证过的结论。不要修改别人的目录，不要手改 index.md。',
      },
    };
  }
  if (!isRequest) return null;
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

  if (method === 'tools/call') {
    const name = params?.name;
    const handler = HANDLERS[name];
    if (!handler) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: `未知工具: ${name}` } };
    }
    try {
      return { jsonrpc: '2.0', id, result: handler(params?.arguments || {}) };
    } catch (err) {
      const message = err instanceof UsageError ? err.message : `${err.message || err}`;
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: message }], isError: true } };
    }
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `未实现的方法: ${method}` } };
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败' } });
      continue;
    }
    const reply = handle(msg);
    if (reply) send(reply);
  }
});
