#!/usr/bin/env node
import { runCli } from '../skills/project-memory/scripts/cli.mjs';

const code = runCli(process.argv.slice(2));
if (code === 'mcp') {
  await import('../skills/project-memory/scripts/mcp.mjs');
} else {
  process.exitCode = code;
}
