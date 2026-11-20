#!/usr/bin/env node
/**
 * 跨平台测试入口。
 *
 * 不能直接写 `node --test <目录>`：Node 18/20 把目录展开成测试文件，
 * Node 22 起把参数当模块路径解析，直接 MODULE_NOT_FOUND。
 * 这里先收集 *.test.mjs，再把文件列表交给 `node --test`，三个大版本行为一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = process.argv.slice(2);
const dirs = targets.length ? targets : ['plugins/agent-memory/tests'];

const files = [];
for (const dir of dirs) {
  const abs = path.resolve(repoRoot, dir);
  if (!fs.existsSync(abs)) {
    console.error(`测试目录不存在: ${abs}`);
    process.exit(1);
  }
  for (const name of fs.readdirSync(abs).sort()) {
    if (name.endsWith('.test.mjs')) files.push(path.join(abs, name));
  }
}

if (!files.length) {
  console.error(`没有找到 *.test.mjs: ${dirs.join(', ')}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: repoRoot,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
