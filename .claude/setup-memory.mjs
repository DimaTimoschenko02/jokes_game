#!/usr/bin/env node
// Points Claude Code auto-memory at this repo's .claude/memory/ so project memory
// travels with git. autoMemoryDirectory needs an absolute path (relative not supported),
// so it's written per-machine into the gitignored settings.local.json.
//
// Run once on every machine after cloning/pulling this repo:
//   node .claude/setup-memory.mjs
// Then restart Claude Code in this repo and accept the workspace trust prompt.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const claudeDir = dirname(fileURLToPath(import.meta.url)); // <repo>/.claude
const memoryDir = join(claudeDir, 'memory');
if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });

const settingsPath = join(claudeDir, 'settings.local.json');
let settings = {};
if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    console.error('settings.local.json is not valid JSON — fix it first, aborting.');
    process.exit(1);
  }
}

settings.autoMemoryDirectory = memoryDir;
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

console.log('autoMemoryDirectory ->', memoryDir);
console.log('Restart Claude Code in this repo and accept the trust prompt.');
