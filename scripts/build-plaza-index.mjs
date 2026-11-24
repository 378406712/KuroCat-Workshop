#!/usr/bin/env node
/**
 * Builds community/index.json, community-accessories/index.json, and community-keyboards/index.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scanAndValidateCommunity,
  scanAndValidateAccessories,
  scanAndValidateKeyboards
} from './validate-community.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const skins = scanAndValidateCommunity();
const accs = scanAndValidateAccessories();
const kbs = scanAndValidateKeyboards();
const allErrors = [...skins.errors, ...accs.errors, ...kbs.errors];

if (allErrors.length > 0) {
  console.error('❌ 构建广场索引失败，请先修复以下校验错误：\n');
  for (const err of allErrors) console.error('  - ' + err);
  process.exit(1);
}

const now = new Date().toISOString();
fs.writeFileSync(
  path.join(ROOT, 'community', 'index.json'),
  JSON.stringify({ generatedAt: now, count: skins.entries.length, skins: skins.entries }, null, 2) + '\n',
  'utf8'
);

const accDir = path.join(ROOT, 'community-accessories');
fs.mkdirSync(accDir, { recursive: true });
fs.writeFileSync(
  path.join(accDir, 'index.json'),
  JSON.stringify({ generatedAt: now, count: accs.entries.length, accessories: accs.entries }, null, 2) + '\n',
  'utf8'
);

const kbDir = path.join(ROOT, 'community-keyboards');
fs.mkdirSync(kbDir, { recursive: true });
fs.writeFileSync(
  path.join(kbDir, 'index.json'),
  JSON.stringify({ generatedAt: now, count: kbs.entries.length, keyboards: kbs.entries }, null, 2) + '\n',
  'utf8'
);

console.log(`✨ 已生成广场索引：${skins.entries.length} 款皮肤 + ${accs.entries.length} 款饰品 + ${kbs.entries.length} 款键盘`);
