#!/usr/bin/env node
// 兼容旧入口：等价于 `agent-memory validate`。
import { runCli } from './cli.mjs';

process.exitCode = runCli(['validate', ...process.argv.slice(2)]);
