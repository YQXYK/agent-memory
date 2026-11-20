import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { cleanup, makeProject, read, scriptsDir } from './helpers.mjs';

function startServer() {
  const child = spawn(process.execPath, [path.join(scriptsDir, 'mcp.mjs')], {
    stdio: ['pipe', 'pipe', 'pipe'],
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
      const msg = JSON.parse(line);
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
