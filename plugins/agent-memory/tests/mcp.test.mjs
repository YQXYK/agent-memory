import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { cleanup, makeProject, read, scriptsDir } from './helpers.mjs';

function startServer({ env = {}, cwd } = {}) {
  const child = spawn(process.execPath, [path.join(scriptsDir, 'mcp.mjs')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd,
    env: { ...process.env, ...env },
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  let buffer = '';
  const pending = new Map();
  const notifications = [];

  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = parseLine(line);
      if (!msg) continue;
      if (msg.id !== undefined && msg.id !== null && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else {
        notifications.push(msg);
      }
    }
  });

  let nextId = 1;
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      setTimeout(() => reject(new Error(`超时: ${method}`)), 5000).unref();
    });

  const notify = (method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  };

  return { child, request, notify, notifications };
}

function payload(res) {
  const body = res.result.content[0].text;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** 子进程被 kill 时可能读到半行，解析失败不该让测试直接崩掉。 */
function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

test('MCP: 初始化、列工具、读写、校验全链路', async () => {
  const root = makeProject();
  const { child, request, notify } = startServer();
  try {
    const init = await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    assert.equal(init.result.protocolVersion, '2024-11-05');
    assert.equal(init.result.serverInfo.name, 'agent-memory');
    assert.ok(init.result.instructions.includes('memory_read'));
    notify('notifications/initialized');

    const list = await request('tools/list', {});
    const names = list.result.tools.map((t) => t.name);
    for (const n of ['memory_init', 'memory_read', 'memory_append', 'memory_build', 'memory_validate']) {
      assert.ok(names.includes(n), `缺少工具 ${n}`);
    }

    const created = payload(
      await request('tools/call', {
        name: 'memory_init',
        arguments: { agent: 'claude', root },
      }),
    );
    assert.equal(created.agent, 'claude');
    assert.ok(created.created.length >= 4);

    const appended = payload(
      await request('tools/call', {
        name: 'memory_append',
        arguments: {
          agent: 'claude',
          root,
          title: 'MCP 可写',
          conclusion: '必须走 MCP',
          evidence: 'mcp.mjs:1',
          impact: '记忆',
          expiry: '协议变更',
        },
      }),
    );
    assert.match(appended.file, /claude[\\/]conclusions\.md/);
    assert.match(read(path.join(root, '.agent-memory', 'claude', 'conclusions.md')), /必须走 MCP/);

    const readBack = payload(await request('tools/call', { name: 'memory_read', arguments: { root } }));
    assert.equal(readBack.total, 1);
    assert.equal(readBack.entries[0].title, 'MCP 可写');

    const filtered = payload(
      await request('tools/call', { name: 'memory_read', arguments: { root, status: '坑' } }),
    );
    assert.equal(filtered.total, 0);

    const badStatus = await request('tools/call', {
      name: 'memory_read',
      arguments: { root, status: '不存在' },
    });
    assert.equal(badStatus.result.isError, true);
    assert.match(payload(badStatus), /只接受/);

    const validated = payload(await request('tools/call', { name: 'memory_validate', arguments: { root } }));
    assert.equal(validated.ok, true);
    assert.equal(validated.entries, 1);
  } finally {
    child.kill();
    cleanup(root);
  }
});

test('MCP: 缺字段返回 isError 且不写文件', async () => {
  const root = makeProject();
  const { child, request } = startServer();
  try {
    await request('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    await request('tools/call', { name: 'memory_init', arguments: { agent: 'codex', root } });
    const file = path.join(root, '.agent-memory', 'codex', 'conclusions.md');
    const before = read(file);

    const res = await request('tools/call', {
      name: 'memory_append',
      arguments: { agent: 'codex', root, title: '只有标题' },
    });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /缺少字段/);
    assert.equal(read(file), before);
  } finally {
    child.kill();
    cleanup(root);
  }
});

test('MCP: 未知工具与未知方法返回 JSON-RPC 错误', async () => {
  const root = makeProject();
  const { child, request } = startServer();
  try {
    await request('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    const badTool = await request('tools/call', { name: 'nope', arguments: {} });
    assert.equal(badTool.error.code, -32602);

    const badMethod = await request('nope/method', {});
    assert.equal(badMethod.error.code, -32601);
  } finally {
    child.kill();
    cleanup(root);
  }
});

test('MCP: 用 AGENT_MEMORY_NAME 时可以不传 agent', async () => {
  const root = makeProject();
  const child = spawn(process.execPath, [path.join(scriptsDir, 'mcp.mjs')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, AGENT_MEMORY_NAME: 'claude' },
  });
  child.stdout.setEncoding('utf8');

  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = parseLine(line);
      if (!msg) continue;
      if (pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  try {
    await request('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    const init = await request('tools/call', { name: 'memory_init', arguments: { root } });
    assert.equal(JSON.parse(init.result.content[0].text).agent, 'claude');

    const appended = await request('tools/call', {
      name: 'memory_append',
      arguments: {
        root,
        title: '不传 agent',
        conclusion: 'c',
        evidence: 'e:1',
        impact: 'i',
        expiry: 'x',
      },
    });
    assert.equal(appended.result.isError, undefined);
    assert.match(read(path.join(root, '.agent-memory', 'claude', 'conclusions.md')), /不传 agent/);
  } finally {
    child.kill();
    cleanup(root);
  }
});

test('MCP: serverInfo 版本来自 package.json', async () => {
  const root = makeProject();
  const { child, request } = startServer();
  try {
    const init = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    assert.equal(init.result.serverInfo.name, 'agent-memory');
    assert.notEqual(init.result.serverInfo.version, '0.2.0-fallback');
    assert.match(init.result.serverInfo.version, /^\d+\.\d+\.\d+/);
  } finally {
    child.kill();
    cleanup(root);
  }
});

test('MCP: 空的记忆环境变量仍能自动探测项目根', async () => {
  const root = makeProject();
  const { child, request } = startServer({
    cwd: root,
    env: { AGENT_MEMORY_ROOT: '', AGENT_MEMORY_DIR: '' },
  });
  try {
    await request('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    const init = payload(
      await request('tools/call', { name: 'memory_init', arguments: { agent: 'gemini' } }),
    );
    // macOS 的 /var 是指向 /private/var 的符号链接，子进程的 cwd 会解析成真实路径。
    assert.equal(init.root, fs.realpathSync(root));

    const readBack = payload(
      await request('tools/call', { name: 'memory_read', arguments: {} }),
    );
    assert.equal(readBack.dir, '.agent-memory');
  } finally {
    child.kill();
    if (child.exitCode === null) {
      await new Promise((resolve) => child.once('exit', resolve));
    }
    cleanup(root);
  }
});

test('MCP: 不传 dir 时能自动认出改名的记忆目录', async () => {
  const root = makeProject();
  const { child, request } = startServer();
  try {
    await request('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    await request('tools/call', {
      name: 'memory_init',
      arguments: { agent: 'claude', root, dir: '.team-memory' },
    });

    const readBack = payload(await request('tools/call', { name: 'memory_read', arguments: { root } }));
    assert.equal(readBack.dir, '.team-memory');
  } finally {
    child.kill();
    cleanup(root);
  }
});

test('MCP: markdown 输出遵守 status 过滤', async () => {
  const root = makeProject();
  const { child, request } = startServer();
  try {
    await request('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    await request('tools/call', { name: 'memory_init', arguments: { agent: 'claude', root } });
    const base = {
      agent: 'claude',
      root,
      conclusion: 'c',
      evidence: 'e:1',
      impact: 'i',
      expiry: 'x',
    };
    await request('tools/call', { name: 'memory_append', arguments: { ...base, title: '规则条目', status: '规则' } });
    await request('tools/call', { name: 'memory_append', arguments: { ...base, title: '待修条目', status: '待修' } });

    const md = await request('tools/call', {
      name: 'memory_read',
      arguments: { root, format: 'markdown', status: '待修' },
    });
    const body = md.result.content[0].text;
    assert.match(body, /待修条目/);
    assert.doesNotMatch(body, /规则条目/);
  } finally {
    child.kill();
    cleanup(root);
  }
});
