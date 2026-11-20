import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indexMatches, renderIndex } from '../skills/project-memory/scripts/render.mjs';

function entry(overrides = {}) {
  return {
    agent: 'codex',
    date: '2026-01-01',
    category: 'test',
    title: '某条待修',
    status: '待修',
    fields: { 结论: '要修', 影响面: 'api', 证据: 'a:1', 失效条件: '修好后' },
    file: '.agent-memory/codex/conclusions.md',
    line: 1,
    ...overrides,
  };
}

test('长期待修项不写天数，索引不会逐日漂移', () => {
  const entries = [entry()];
  const a = renderIndex({ entries, agents: ['codex'], now: new Date('2026-03-01T10:00:00') });
  const b = renderIndex({ entries, agents: ['codex'], now: new Date('2026-04-01T10:00:00') });
  assert.match(a, /长期未处理的待修项/);
  assert.doesNotMatch(a, /\d+ 天/);
  assert.ok(indexMatches(a, b), '跨天渲染应视为一致');
});

test('内容变化时 indexMatches 返回 false', () => {
  const before = renderIndex({ entries: [entry()], agents: ['codex'] });
  const after = renderIndex({ entries: [entry({ title: '改过' })], agents: ['codex'] });
  assert.ok(!indexMatches(after, before));
  assert.ok(!indexMatches(after, null));
});

test('30 天内的待修项不进长期列表', () => {
  const out = renderIndex({
    entries: [entry({ date: '2026-05-01' })],
    agents: ['codex'],
    now: new Date('2026-05-20T10:00:00'),
  });
  assert.doesNotMatch(out, /长期未处理的待修项/);
});
