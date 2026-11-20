import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isValidDate,
  normalizeDirName,
  parseArgs,
  parseConclusions,
  UsageError,
} from '../skills/project-memory/scripts/lib.mjs';

test('parseArgs 区分布尔开关与需要值的参数', () => {
  assert.deepEqual(parseArgs(['--agent', 'codex'], { booleans: ['check'] }), { _: [], agent: 'codex' });
  assert.deepEqual(parseArgs(['--check'], { booleans: ['check'] }), { _: [], check: true });
  assert.throws(() => parseArgs(['--agent'], { booleans: ['check'] }), UsageError);
  assert.throws(() => parseArgs(['--agent', '--check'], { booleans: ['check'] }), UsageError);
});

test('parseArgs 支持 -- 之后的位置参数', () => {
  assert.deepEqual(parseArgs(['a', '--', '--b', 'c']), { _: ['a', '--b', 'c'] });
});

test('parseArgs 支持 --key=value', () => {
  assert.deepEqual(parseArgs(['--agent=codex', '--dir=.team']), { _: [], agent: 'codex', dir: '.team' });
});

test('normalizeDirName 只接受项目内相对目录', () => {
  assert.equal(normalizeDirName(undefined), '.agent-memory');
  assert.equal(normalizeDirName(' .team-memory/ '), '.team-memory');
  assert.equal(normalizeDirName('memory/v2'), 'memory/v2');
  for (const bad of ['../x', 'a/../b', '/abs', 'C:/x', 'a//b', '.']) {
    assert.throws(() => normalizeDirName(bad), UsageError, `应拒绝 ${bad}`);
  }
});

test('isValidDate 挡住溢出日期但接受闰日', () => {
  for (const ok of ['2024-02-29', '2026-01-01', '2000-02-29']) assert.ok(isValidDate(ok), ok);
  for (const bad of ['2026-13-45', '2026-02-30', '2025-02-29', '2026-1-1', '2026-00-10', 'abcd-01-01']) {
    assert.ok(!isValidDate(bad), bad);
  }
});

test('parseConclusions 解析五字段与状态后缀', () => {
  const text = `# 结论

## 2026-01-02 | data-safety | 某条约束
- 状态: 规则（已修复，防回归）
- 结论: 必须加锁
- 证据: src/a.ts:10
- 影响面: db、api
- 失效条件: 改用事务后
`;
  const { entries, problems } = parseConclusions(text, 'x.md');
  assert.equal(problems.length, 0);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, '规则');
  assert.equal(entries[0].category, 'data-safety');
  assert.equal(entries[0].title, '某条约束');
  assert.equal(entries[0].fields['影响面'], 'db、api');
});

test('parseConclusions 支持字段续行与代码围栏', () => {
  const text = `## 2026-01-02 | test | 多行
- 状态: 坑
- 结论: 第一行
  第二行
- 证据: e:1
- 影响面: i
- 失效条件: x

\`\`\`
## 2026-01-01 | fake | 围栏里的假标题
\`\`\`
`;
  const { entries, problems } = parseConclusions(text, 'x.md');
  assert.equal(problems.length, 0);
  assert.equal(entries.length, 1);
  assert.match(entries[0].fields['结论'], /第二行/);
});

test('parseConclusions 报告缺字段、坏状态、坏分类', () => {
  const text = `## 2026-01-02 | Bad_Cat | 有问题的
- 状态: 也许
- 结论: c
`;
  const { problems } = parseConclusions(text, 'x.md');
  const messages = problems.map((p) => p.message).join('\n');
  assert.match(messages, /missing field: 证据/);
  assert.match(messages, /unknown 状态/);
  assert.match(messages, /bad category/);
});
