#!/usr/bin/env node
// 兼容旧入口：等价于 `agent-memory build`。
import { runCli } from './cli.mjs';

process.exitCode = runCli(['build', ...process.argv.slice(2)]);
