import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const pkgRoot = path.resolve(here, '..');
export const bin = path.join(pkgRoot, 'bin', 'agent-memory.mjs');
export const scriptsDir = path.join(pkgRoot, 'skills', 'project-memory', 'scripts');

export function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-test-'));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

export function run(cwd, args, { env = {} } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [bin, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

export function read(file) {
  return fs.readFileSync(file, 'utf8');
}

export function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

export function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
