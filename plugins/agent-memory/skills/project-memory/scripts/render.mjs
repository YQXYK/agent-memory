import { localDate, localStamp, oneLine, truncate } from './lib.mjs';

export const STALE_DAYS = 30;

export const GROUPS = [
  ['待修', '当前仍有问题。接手或改到相关模块前先看这里。'],
  ['规则', '已验证的约束，改动必须遵守。'],
  ['坑', '踩过并已绕开，知道原因就别再踩。'],
  ['失效', '曾经成立、现已不成立。保留是为了防止有人照旧记忆干活。'],
];

export function daysAgo(date, today) {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.round((today - t) / 86400000);
}

export function sortEntries(entries) {
  return [...entries].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

export function findStale(entries, now = new Date()) {
  const today = Date.parse(`${localDate(now)}T00:00:00Z`);
  return sortEntries(entries).filter((e) => {
    if (e.status !== '待修') return false;
    const d = daysAgo(e.date, today);
    return d !== null && d > STALE_DAYS;
  });
}

function row(e) {
  const cells = [
    e.date,
    oneLine(e.title),
    truncate(e.fields['结论'], 160),
    oneLine(e.fields['影响面']),
    oneLine(e.fields['证据']),
    e.agent,
  ];
  return `| ${cells.join(' | ')} |`;
}

function areas(entries) {
  const byArea = new Map();
  for (const e of entries) {
    for (const area of String(e.fields['影响面'] || '').split(/[、,，/\s]+/)) {
      const key = area.trim();
      if (!key) continue;
      if (!byArea.has(key)) byArea.set(key, []);
      byArea.get(key).push(e);
    }
  }
  return byArea;
}

/**
 * 生成 index.md 全文。纯函数：同样的输入永远得到同样的输出，
 * 便于 --check 比对，也便于 MCP 与 CLI 共用。
 */
export function renderIndex({ entries, agents = [], dirName = '.agent-memory', now = new Date() }) {
  const sorted = sortEntries(entries);
  const stale = findStale(sorted, now);
  const out = [];

  out.push('# 项目记忆索引');
  out.push('');
  out.push('> 本文件由 `agent-memory` 生成，**不要手改**。');
  out.push(`> 写结论请改 \`${dirName}/<你的名字>/conclusions.md\`，然后重新运行 \`build\`。`);
  out.push(`> 协议见 \`${dirName}/PROTOCOL.md\`。`);
  out.push('');
  out.push(`生成时间: ${localStamp(now)} · 条目 ${entries.length} 条 · agent ${agents.length} 个`);
  out.push('');

  if (stale.length) {
    out.push('## ⚠ 长期未处理的待修项');
    out.push('');
    for (const e of stale) {
      // 不写"多少天"：那会让索引每天自动变化，build --check 在 CI 里天天误报。
      out.push(`- ${e.date} · ${oneLine(e.title)} · ${e.agent}`);
    }
    out.push('');
  }

  for (const [status, blurb] of GROUPS) {
    const items = sorted.filter((e) => e.status === status);
    out.push(`## ${status}（${items.length}）`);
    out.push('');
    out.push(blurb);
    out.push('');
    if (!items.length) {
      out.push('_暂无_');
      out.push('');
      continue;
    }
    out.push('| 日期 | 标题 | 结论 | 影响面 | 证据 | agent |');
    out.push('|---|---|---|---|---|---|');
    for (const e of items) out.push(row(e));
    out.push('');
  }

  out.push('## 按影响面');
  out.push('');
  const byArea = areas(sorted);
  if (!byArea.size) out.push('_暂无_');
  for (const key of [...byArea.keys()].sort()) {
    const items = byArea.get(key);
    out.push(`- **${key}**（${items.length}）: ${items.map((e) => oneLine(e.title)).join('；')}`);
  }
  out.push('');

  out.push('## agent 目录');
  out.push('');
  out.push('| agent | 结论数 | 最新 | 目录 |');
  out.push('|---|---|---|---|');
  for (const agent of agents) {
    const items = sorted.filter((e) => e.agent === agent);
    out.push(`| ${agent} | ${items.length} | ${items[0] ? items[0].date : '-'} | \`${dirName}/${agent}/\` |`);
  }
  out.push('');

  return out.join('\n');
}

/**
 * 生成时间每次都变，比对前必须剔掉，否则 --check 永远失败。
 */
export function stripVolatile(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/^生成时间:.*$/m, '');
}

export function indexMatches(rendered, previous) {
  if (previous === null || previous === undefined) return false;
  return stripVolatile(rendered) === stripVolatile(previous);
}
