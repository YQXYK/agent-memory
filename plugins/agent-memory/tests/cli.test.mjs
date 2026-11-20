import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { cleanup, makeProject, read, run, scriptsDir, write } from './helpers.mjs';

test('init 幂等，且顺手生成 index.md', () => {
  const root = makeProject();
  try {
    const first = run(root, ['init', '--agent', 'codex']);
    assert.equal(first.code, 0, first.stderr);
    const base = path.join(root, '.agent-memory');
    for (const f of ['PROTOCOL.md', 'forbidden.txt', 'index.md', 'codex/conclusions.md', 'codex/notes.md']) {
      assert.ok(fs.existsSync(path.join(base, f)), `缺少 ${f}`);
    }

    const before = read(path.join(base, 'codex', 'conclusions.md'));
    const second = run(root, ['init', '--agent', 'codex']);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(read(path.join(base, 'codex', 'conclusions.md')), before, '重复 init 不应改内容');
    assert.match(second.stdout, /保留/);
  } finally {
    cleanup(root);
  }
});

test('init 不动其他 agent 的目录', () => {
  const root = makeProject();
  try {
    run(root, ['init', '--agent', 'codex']);
    const other = path.join(root, '.agent-memory', 'claude', 'conclusions.md');
    write(other, '# 结论\n\n## 2026-01-01 | test | 别人的\n- 状态: 规则\n- 结论: 别动\n- 证据: a:1\n- 影响面: b\n- 失效条件: c\n');
    run(root, ['init', '--agent', 'codex']);
    assert.match(read(other), /别动/);
  } finally {
    cleanup(root);
  }
});

test('--agent 缺值时报错，而不是建出 true 目录', () => {
  const root = makeProject();
  try {
    const r = run(root, ['init', '--agent']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /需要一个值/);
    assert.ok(!fs.existsSync(path.join(root, '.agent-memory', 'true')), '不应建出 true/');
  } finally {
    cleanup(root);
  }
});

test('非法 agent 名被拒绝', () => {
  const root = makeProject();
  try {
    for (const name of ['Codex', 'a b', '..', '-x', 'a'.repeat(33)]) {
      const r = run(root, ['init', '--agent', name]);
      assert.equal(r.code, 2, `应拒绝 ${name}`);
    }
  } finally {
    cleanup(root);
  }
});

test('--dir 自定义目录能被 findRoot 认出', () => {
  const root = makeProject();
  try {
    const r = run(root, ['init', '--agent', 'claude', '--dir', '.team-memory']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(root, '.team-memory', 'index.md')));

    const sub = path.join(root, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    const built = run(sub, ['build', '--dir', '.team-memory']);
    assert.equal(built.code, 0, built.stderr);
    assert.match(built.stdout, /\.team-memory[\\/]index\.md/);
  } finally {
    cleanup(root);
  }
});

test('--dir 拒绝越界路径', () => {
  const root = makeProject();
  try {
    for (const dir of ['../escape', '/abs', 'C:/abs', 'a/../../b', '']) {
      const r = run(root, ['init', '--agent', 'codex', '--dir', dir]);
      assert.equal(r.code, 2, `应拒绝 --dir ${dir}`);
    }
  } finally {
    cleanup(root);
  }
});

test('add 追加五字段结论并刷新索引', () => {
  const root = makeProject();
  try {
    run(root, ['init', '--agent', 'codex']);
    const r = run(root, [
      'add',
      '--agent', 'codex',
      '--title', '索引只读',
      '--conclusion', '禁止手改 index.md',
      '--evidence', 'scripts/render.mjs:1',
      '--impact', '记忆目录',
      '--expiry', '生成方式改变',
    ]);
    assert.equal(r.code, 0, r.stderr);
    const text = read(path.join(root, '.agent-memory', 'codex', 'conclusions.md'));
    assert.match(text, /## \d{4}-\d{2}-\d{2} \| general \| 索引只读/);
    for (const f of ['状态', '结论', '证据', '影响面', '失效条件']) {
      assert.match(text, new RegExp(`- ${f}: `), `缺少字段 ${f}`);
    }
    assert.match(read(path.join(root, '.agent-memory', 'index.md')), /索引只读/);
  } finally {
    cleanup(root);
  }
});

test('add 缺字段时不写文件', () => {
  const root = makeProject();
  try {
    run(root, ['init', '--agent', 'codex']);
    const file = path.join(root, '.agent-memory', 'codex', 'conclusions.md');
    const before = read(file);
    const r = run(root, ['add', '--agent', 'codex', '--title', '只有标题']);
    assert.equal(r.code, 2);
    assert.equal(read(file), before, '失败时不应写入');
  } finally {
    cleanup(root);
  }
});

test('add 拒绝不存在的日期', () => {
  const root = makeProject();
  try {
    run(root, ['init', '--agent', 'codex']);
    const file = path.join(root, '.agent-memory', 'codex', 'conclusions.md');
    const before = read(file);
    const r = run(root, [
      'add', '--agent', 'codex', '--date', '2026-02-30',
      '--title', 't', '--conclusion', 'c', '--evidence', 'e:1', '--impact', 'i', '--expiry', 'x',
    ]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /真实存在/);
    assert.equal(read(file), before);
  } finally {
    cleanup(root);
  }
});

test('build --check 能识别过期索引', () => {
  const root = makeProject();
  try {
    run(root, ['init', '--agent', 'codex']);
    assert.equal(run(root, ['build', '--check']).code, 0);

    const file = path.join(root, '.agent-memory', 'codex', 'conclusions.md');
    fs.appendFileSync(
      file,
      '\n## 2026-02-02 | test | 新条目\n- 状态: 规则\n- 结论: c\n- 证据: e:1\n- 影响面: i\n- 失效条件: x\n',
      'utf8',
    );
    const stale = run(root, ['build', '--check']);
    assert.equal(stale.code, 1);
    assert.match(stale.stderr, /过期/);
  } finally {
    cleanup(root);
  }
});

test('validate 能识别假日期', () => {
  const root = makeProject();
  try {
    run(root, ['init', '--agent', 'codex']);
    const file = path.join(root, '.agent-memory', 'codex', 'conclusions.md');
    for (const bad of ['2026-13-45', '2026-02-30', '2025-02-29']) {
      write(file, `## ${bad} | test | 坏日期\n- 状态: 规则\n- 结论: c\n- 证据: e:1\n- 影响面: i\n- 失效条件: x\n`);
      const r = run(root, ['validate']);
      assert.equal(r.code, 1, `${bad} 应报错`);
      assert.match(r.stdout, /bad date/);
    }
    for (const good of ['2024-02-29', '2026-01-01', '2026-12-31']) {
      write(file, `## ${good} | test | 好日期\n- 状态: 规则\n- 结论: c\n- 证据: e:1\n- 影响面: i\n- 失效条件: x\n`);
      const r = run(root, ['validate']);
      assert.equal(r.code, 0, `${good} 不应报错：${r.stdout}`);
    }
  } finally {
    cleanup(root);
  }
});

test('validate 报告过期索引，--strict 让警告也失败', () => {
  const root = makeProject();
  try {
    run(root, ['init', '--agent', 'codex']);
    const file = path.join(root, '.agent-memory', 'codex', 'conclusions.md');
    fs.appendFileSync(
      file,
      '\n## 2026-02-02 | test | 未刷新\n- 状态: 规则\n- 结论: c\n- 证据: e:1\n- 影响面: i\n- 失效条件: x\n',
      'utf8',
    );
    const r = run(root, ['validate']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /索引已过期/);

    const strict = run(root, ['validate', '--strict']);
    assert.equal(strict.code, 1);
  } finally {
    cleanup(root);
  }
});

test('validate 忽略编辑器临时文件，但报告真实杂项', () => {
  const root = makeProject();
  try {
    run(root, ['init', '--agent', 'codex']);
    const dir = path.join(root, '.agent-memory', 'codex');
    for (const n of ['.DS_Store', '.conclusions.md.swp', 'notes.md~', '#notes.md#']) {
      write(path.join(dir, n), 'x');
    }
    assert.doesNotMatch(run(root, ['validate']).stdout, /非约定文件/);

    write(path.join(dir, 'scratch.md'), 'x');
    assert.match(run(root, ['validate']).stdout, /非约定文件/);
  } finally {
    cleanup(root);
  }
});

test('validate 拦截 forbidden.txt 规则', () => {
  const root = makeProject();
  try {
    run(root, ['init', '--agent', 'codex']);
    write(path.join(root, '.agent-memory', 'forbidden.txt'), 'error: \\bsecret-token\\b\n');
    write(
      path.join(root, '.agent-memory', 'codex', 'conclusions.md'),
      '## 2026-01-01 | test | 泄露\n- 状态: 规则\n- 结论: secret-token\n- 证据: e:1\n- 影响面: i\n- 失效条件: x\n',
    );
    const r = run(root, ['validate']);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /命中禁用规则/);
  } finally {
    cleanup(root);
  }
});

test('旧入口脚本仍然可用', () => {
  const root = makeProject();
  try {
    execFileSync(process.execPath, [path.join(scriptsDir, 'init.mjs'), '--agent', 'codex'], { cwd: root });
    execFileSync(process.execPath, [path.join(scriptsDir, 'build.mjs')], { cwd: root });
    const out = execFileSync(process.execPath, [path.join(scriptsDir, 'validate.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.match(out, /0 个错误/);
  } finally {
    cleanup(root);
  }
});

test('help 与未知命令', () => {
  const root = makeProject();
  try {
    assert.match(run(root, ['help']).stdout, /用法:/);
    const unknown = run(root, ['nope']);
    assert.equal(unknown.code, 2);
  } finally {
    cleanup(root);
  }
});

test('init --no-build 不生成索引，build 之后才有', () => {
  const root = makeProject();
  try {
    const r = run(root, ['init', '--agent', 'codex', '--no-build']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(root, '.agent-memory', 'index.md')));
    assert.equal(run(root, ['build']).code, 0);
    assert.ok(fs.existsSync(path.join(root, '.agent-memory', 'index.md')));
  } finally {
    cleanup(root);
  }
});

test('build 不接受需要值的参数缺值', () => {
  const root = makeProject();
  try {
    run(root, ['init', '--agent', 'codex']);
    assert.equal(run(root, ['build', '--root']).code, 2);
    assert.equal(run(root, ['list', '--status']).code, 2);
  } finally {
    cleanup(root);
  }
});

test('template 别名不歧义，且能替换 agent 名', () => {
  const root = makeProject();
  try {
    const claude = run(root, ['template', 'claude', '--agent', 'claude']);
    assert.equal(claude.code, 0, claude.stderr);
    assert.match(claude.stdout, /CLAUDE\.md|claude\/conclusions\.md/);
    assert.doesNotMatch(claude.stdout, /"mcpServers"/, 'claude 不应解析成 MCP 配置');

    const cursor = run(root, ['template', 'cursor', '--agent', 'cursor']);
    assert.match(cursor.stdout, /alwaysApply/);

    const prompt = run(root, ['template', 'system-prompt', '--agent', 'dsh']);
    assert.match(prompt.stdout, /\.agent-memory\/dsh\/conclusions\.md/);
    assert.match(prompt.stdout, /dsh/, '--agent 应替换占位符');

    const agents = run(root, ['template', 'AGENTS.md.snippet', '--agent', 'codex']);
    assert.match(agents.stdout, /agent-memory init --agent codex/);
  } finally {
    cleanup(root);
  }
});
