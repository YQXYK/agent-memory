#!/usr/bin/env node
// 兼容旧入口：等价于 `agent-memory init`。
import { runCli } from './cli.mjs';

process.exitCode = runCli(['init', ...process.argv.slice(2)]);
