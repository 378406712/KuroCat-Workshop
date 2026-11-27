#!/usr/bin/env node
/**
 * Validates every community submission under:
 *   1) community/<slug>/              (Skins Plaza)
 *   2) community-accessories/<slug>/  (Accessories Plaza)
 * Zero third-party dependencies (Node 18+).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const COMMUNITY_DIR = path.join(ROOT, 'community');
const ACCESSORIES_DIR = path.join(ROOT, 'community-accessories');
const KEYBOARDS_DIR = path.join(ROOT, 'community-keyboards');

// Skin rules come from the workshop's own spec.js (the same validateRawSkin the editor uses, kept in step with the
// desktop parser in KuroCat/shared/SkinSpec.hpp), so a limit or a new field only has to change in one place.
const Spec = (() => {
  const ctx = { console, atob: (s) => Buffer.from(s, 'base64').toString('binary') };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'spec.js'), 'utf8'), ctx, { filename: 'spec.js' });
  return ctx.KuroSpec;
})();

const DECO_ANCHORS = new Set(['headTop', 'face', 'neck', 'tailTip']);
const KB_COLOR_KEYS = ['mouseBody', 'mouseBorder', 'wheel', 'base', 'deck', 'key', 'keyBorder', 'accent'];
const ALLOWED_PREVIEWS = ['preview.gif', 'preview.webp', 'preview.png', 'preview.jpg', 'preview.jpeg'];
const MAX_SKIN_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
const MAX_ACCESSORY_BYTES = 1024 * 1024;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;
const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function checkPngBuffer(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  if (!buf || buf.length < 24 || !buf.subarray(0, 8).equals(sig) || buf.subarray(12, 16).toString('ascii') !== 'IHDR') {
    return null;
  }
  return { bytes: buf.length, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function checkBase64Png(str) {
  if (typeof str !== 'string') return null;
  const clean = str.replace(/^data:image\/png;base64,/, '').replace(/\s+/g, '');
  if (!clean || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  return checkPngBuffer(Buffer.from(clean, 'base64'));
}

export function validateKurocatObject(raw) {
  const res = Spec.validateRawSkin(raw);
  if (!res.ok) return `skin.kurocat：${res.error}`;
  // Plaza-only: sticker and preview images are checked byte-for-byte here.
  for (let i = 0; i < (raw.decorations || []).length; i++) {
    const info = checkBase64Png(raw.decorations[i].png);
    if (!info) return `decorations[${i}].png 必须是有效的 base64 PNG`;
    if (info.bytes > MAX_ACCESSORY_BYTES || info.width > 1024 || info.height > 1024) {
      return `decorations[${i}].png 超过 1 MB 或 1024×1024 限制`;
    }
  }
  if (raw.preview != null) {
    const info = checkBase64Png(raw.preview);
    if (!info || info.bytes > 512 * 1024) return 'preview 必须是 ≤ 512 KB 的 base64 PNG';
  }
  return null;
}

function validateCommonMeta(meta, prefix, errors) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    errors.push(`${prefix}/meta.json: 必须是 JSON 对象`);
    return null;
  }
  const title = typeof meta.title === 'string' ? meta.title.trim() : '';
  const author = typeof meta.author === 'string' ? meta.author.trim() : '';
  const description = typeof meta.description === 'string' ? meta.description.trim() : '';
  if (!title || title.length > 40) errors.push(`${prefix}/meta.json: title 必填且不超过 40 字`);
  if (!author || author.length > 40) errors.push(`${prefix}/meta.json: author 必填且不超过 40 字`);
  if (!description || description.length > 180) errors.push(`${prefix}/meta.json: description 必填且不超过 180 字`);
  let authorUrl = '';
  if (meta.authorUrl != null && meta.authorUrl !== '') {
    if (typeof meta.authorUrl !== 'string' || !/^https?:\/\/\S+$/i.test(meta.authorUrl.trim())) {
      errors.push(`${prefix}/meta.json: authorUrl 必须是 http(s):// 开头的链接`);
    } else {
      authorUrl = meta.authorUrl.trim();
    }
  }
  const tags = Array.isArray(meta.tags)
    ? meta.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 6)
    : [];
  if (tags.length === 0) errors.push(`${prefix}/meta.json: 请至少提供 1 个 tags 标签`);
  for (const t of tags) {
    if (t.length > 16) errors.push(`${prefix}/meta.json: 标签 "${t}" 超过 16 字`);
  }
  let createdAt = typeof meta.createdAt === 'string' ? meta.createdAt.trim() : '';
  if (createdAt && !/^\d{4}-\d{2}-\d{2}$/.test(createdAt)) {
    errors.push(`${prefix}/meta.json: createdAt 格式应为 YYYY-MM-DD`);
  }
  if (!createdAt) createdAt = new Date().toISOString().slice(0, 10);
  return { title, author, authorUrl, description, tags, createdAt };
}

export function scanAndValidateCommunity() {
  const errors = [];
  const entries = [];
  if (!fs.existsSync(COMMUNITY_DIR)) return { entries, errors: ['缺少 community/ 目录'] };

  for (const d of fs.readdirSync(COMMUNITY_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) {
      if (d.name !== 'index.json' && d.name !== 'README.md' && d.name !== '.DS_Store') {
        errors.push(`community/${d.name}: 请放进单独子目录 community/<英文短名>/`);
      }
      continue;
    }
    const slug = d.name;
    const dirPath = path.join(COMMUNITY_DIR, slug);
    if (!SLUG_RE.test(slug)) {
      errors.push(`community/${slug}: 目录名仅支持小写字母、数字和连字符（2–49 字符）`);
      continue;
    }
    const files = fs.readdirSync(dirPath).filter((f) => f !== '.DS_Store');
    const skinFile = path.join(dirPath, 'skin.kurocat');
    const metaFile = path.join(dirPath, 'meta.json');
    if (!fs.existsSync(skinFile)) { errors.push(`community/${slug}: 缺少 skin.kurocat`); continue; }
    if (!fs.existsSync(metaFile)) { errors.push(`community/${slug}: 缺少 meta.json`); continue; }

    let previewFile = null;
    for (const f of files) {
      if (f === 'skin.kurocat' || f === 'meta.json') continue;
      if (ALLOWED_PREVIEWS.includes(f)) {
        if (previewFile) errors.push(`community/${slug}: 只能提供一个预览文件`);
        previewFile = f;
      } else {
        errors.push(`community/${slug}/${f}: 不允许的额外文件`);
      }
    }

    const skinStat = fs.statSync(skinFile);
    if (skinStat.size > MAX_SKIN_BYTES) {
      errors.push(`community/${slug}/skin.kurocat: 超过 2 MB 上限`);
      continue;
    }
    let skinObj;
    try { skinObj = JSON.parse(fs.readFileSync(skinFile, 'utf8')); }
    catch (e) { errors.push(`community/${slug}/skin.kurocat: JSON 解析失败 (${e.message})`); continue; }
    const skinErr = validateKurocatObject(skinObj);
    if (skinErr) { errors.push(`community/${slug}/skin.kurocat: ${skinErr}`); continue; }

    let rawMeta;
    try { rawMeta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); }
    catch (e) { errors.push(`community/${slug}/meta.json: JSON 解析失败 (${e.message})`); continue; }
    const meta = validateCommonMeta(rawMeta, `community/${slug}`, errors);
    if (!meta) continue;

    let previewType = null;
    if (previewFile) {
      const pStat = fs.statSync(path.join(dirPath, previewFile));
      if (pStat.size > MAX_PREVIEW_BYTES) errors.push(`community/${slug}/${previewFile}: 预览文件超过 5 MB 上限`);
      previewType = path.extname(previewFile).slice(1).toLowerCase();
    }

    const decos = Array.isArray(skinObj.decorations) ? skinObj.decorations : [];
    const pal = skinObj.palette || {};
    const paletteSummary = [pal.body, pal.belly, pal.points, pal.iris].filter((c) => c && HEX_RE.test(c));

    entries.push({
      slug,
      ...meta,
      skinPath: `./community/${slug}/skin.kurocat`,
      previewPath: previewFile ? `./community/${slug}/${previewFile}` : null,
      previewType,
      decorationCount: decos.length,
      regionCount: Array.isArray(skinObj.regions) ? skinObj.regions.length : 0,
      sizeBytes: skinStat.size,
      paletteSummary: [...new Set(paletteSummary)].slice(0, 4)
    });
  }

  entries.sort((a, b) => (b.createdAt.localeCompare(a.createdAt) || a.slug.localeCompare(b.slug)));
  return { entries, errors };
}

export function scanAndValidateAccessories() {
  const errors = [];
  const entries = [];
  if (!fs.existsSync(ACCESSORIES_DIR)) return { entries, errors };

  for (const d of fs.readdirSync(ACCESSORIES_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) {
      if (d.name !== 'index.json' && d.name !== 'README.md' && d.name !== '.DS_Store') {
        errors.push(`community-accessories/${d.name}: 请放进单独子目录 community-accessories/<英文短名>/`);
      }
      continue;
    }
    const slug = d.name;
    const dirPath = path.join(ACCESSORIES_DIR, slug);
    if (!SLUG_RE.test(slug)) {
      errors.push(`community-accessories/${slug}: 目录名仅支持小写字母、数字和连字符（2–49 字符）`);
      continue;
    }
    const files = fs.readdirSync(dirPath).filter((f) => f !== '.DS_Store');
    const pngFile = path.join(dirPath, 'accessory.png');
    const metaFile = path.join(dirPath, 'meta.json');
    if (!fs.existsSync(pngFile)) { errors.push(`community-accessories/${slug}: 缺少 accessory.png`); continue; }
    if (!fs.existsSync(metaFile)) { errors.push(`community-accessories/${slug}: 缺少 meta.json`); continue; }

    let previewFile = null;
    for (const f of files) {
      if (f === 'accessory.png' || f === 'meta.json') continue;
      if (ALLOWED_PREVIEWS.includes(f)) {
        if (previewFile) errors.push(`community-accessories/${slug}: 只能提供一个额外预览文件`);
        previewFile = f;
      } else {
        errors.push(`community-accessories/${slug}/${f}: 不允许的额外文件`);
      }
    }

    const buf = fs.readFileSync(pngFile);
    const info = checkPngBuffer(buf);
    if (!info) { errors.push(`community-accessories/${slug}/accessory.png: 不是有效的 PNG 文件`); continue; }
    if (info.bytes > MAX_ACCESSORY_BYTES || info.width > 1024 || info.height > 1024) {
      errors.push(`community-accessories/${slug}/accessory.png: 须 ≤ 1 MB 且 ≤ 1024×1024`);
      continue;
    }

    let rawMeta;
    try { rawMeta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); }
    catch (e) { errors.push(`community-accessories/${slug}/meta.json: JSON 解析失败 (${e.message})`); continue; }
    const meta = validateCommonMeta(rawMeta, `community-accessories/${slug}`, errors);
    if (!meta) continue;

    if (!DECO_ANCHORS.has(rawMeta.anchor)) {
      errors.push(`community-accessories/${slug}/meta.json: anchor 必须是 headTop / face / neck / tailTip 之一`);
      continue;
    }
    const num = (v, def, lo, hi) => (typeof v === 'number' && Number.isFinite(v)) ? Math.min(hi, Math.max(lo, v)) : def;
    const offsetX = num(rawMeta.offsetX, 0, -120, 120);
    const offsetY = num(rawMeta.offsetY, 0, -120, 120);
    const scale = num(rawMeta.scale, 1, 0.05, 4);
    const rotation = num(rawMeta.rotation, 0, -180, 180);

    if (previewFile) {
      const pStat = fs.statSync(path.join(dirPath, previewFile));
      if (pStat.size > MAX_PREVIEW_BYTES) errors.push(`community-accessories/${slug}/${previewFile}: 超过 5 MB 上限`);
    }

    entries.push({
      slug,
      ...meta,
      anchor: rawMeta.anchor,
      offsetX,
      offsetY,
      scale,
      rotation,
      pngPath: `./community-accessories/${slug}/accessory.png`,
      previewPath: previewFile ? `./community-accessories/${slug}/${previewFile}` : null,
      width: info.width,
      height: info.height,
      sizeBytes: info.bytes
    });
  }

  entries.sort((a, b) => (b.createdAt.localeCompare(a.createdAt) || a.slug.localeCompare(b.slug)));
  return { entries, errors };
}

export function scanAndValidateKeyboards() {
  const errors = [];
  const entries = [];
  if (!fs.existsSync(KEYBOARDS_DIR)) return { entries, errors };

  for (const d of fs.readdirSync(KEYBOARDS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) {
      if (d.name !== 'index.json' && d.name !== 'README.md' && d.name !== '.DS_Store') {
        errors.push(`community-keyboards/${d.name}: 请放进单独子目录 community-keyboards/<英文短名>/`);
      }
      continue;
    }
    const slug = d.name;
    const dirPath = path.join(KEYBOARDS_DIR, slug);
    if (!SLUG_RE.test(slug)) {
      errors.push(`community-keyboards/${slug}: 目录名仅支持小写字母、数字和连字符（2–49 字符）`);
      continue;
    }
    const files = fs.readdirSync(dirPath).filter((f) => f !== '.DS_Store');
    const kbFile = path.join(dirPath, 'keyboard.json');
    const metaFile = path.join(dirPath, 'meta.json');
    if (!fs.existsSync(kbFile)) { errors.push(`community-keyboards/${slug}: 缺少 keyboard.json`); continue; }
    if (!fs.existsSync(metaFile)) { errors.push(`community-keyboards/${slug}: 缺少 meta.json`); continue; }

    let previewFile = null;
    for (const f of files) {
      if (f === 'keyboard.json' || f === 'meta.json') continue;
      if (ALLOWED_PREVIEWS.includes(f)) {
        if (previewFile) errors.push(`community-keyboards/${slug}: 只能提供一个额外预览文件`);
        previewFile = f;
      } else {
        errors.push(`community-keyboards/${slug}/${f}: 不允许的额外文件`);
      }
    }

    const kbStat = fs.statSync(kbFile);
    if (kbStat.size > 128 * 1024) {
      errors.push(`community-keyboards/${slug}/keyboard.json: 超过 128 KB 上限`);
      continue;
    }
    let kbObj;
    try { kbObj = JSON.parse(fs.readFileSync(kbFile, 'utf8')); }
    catch (e) { errors.push(`community-keyboards/${slug}/keyboard.json: JSON 解析失败 (${e.message})`); continue; }

    if (!kbObj || typeof kbObj !== 'object' || kbObj.formatVersion !== 1) {
      errors.push(`community-keyboards/${slug}/keyboard.json: formatVersion 必须为 1`);
      continue;
    }
    if (!kbObj.colors || typeof kbObj.colors !== 'object') {
      errors.push(`community-keyboards/${slug}/keyboard.json: 缺少 colors 对象`);
      continue;
    }
    let colorOk = true;
    for (const key of KB_COLOR_KEYS) {
      if (!HEX_RE.test(kbObj.colors[key] || '')) {
        errors.push(`community-keyboards/${slug}/keyboard.json: colors.${key} 必须是 #RRGGBB 或 #RRGGBBAA`);
        colorOk = false;
      }
    }
    if (!colorOk) continue;

    let rawMeta;
    try { rawMeta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); }
    catch (e) { errors.push(`community-keyboards/${slug}/meta.json: JSON 解析失败 (${e.message})`); continue; }
    const meta = validateCommonMeta(rawMeta, `community-keyboards/${slug}`, errors);
    if (!meta) continue;

    if (previewFile) {
      const pStat = fs.statSync(path.join(dirPath, previewFile));
      if (pStat.size > MAX_PREVIEW_BYTES) errors.push(`community-keyboards/${slug}/${previewFile}: 超过 5 MB 上限`);
    }

    entries.push({
      slug,
      ...meta,
      keyboardPath: `./community-keyboards/${slug}/keyboard.json`,
      previewPath: previewFile ? `./community-keyboards/${slug}/${previewFile}` : null,
      colors: {
        mouseBody: kbObj.colors.mouseBody,
        mouseBorder: kbObj.colors.mouseBorder,
        wheel: kbObj.colors.wheel,
        base: kbObj.colors.base,
        deck: kbObj.colors.deck,
        key: kbObj.colors.key,
        keyBorder: kbObj.colors.keyBorder,
        accent: kbObj.colors.accent,
        darkText: kbObj.colors.darkText !== false
      },
      sizeBytes: kbStat.size
    });
  }

  entries.sort((a, b) => (b.createdAt.localeCompare(a.createdAt) || a.slug.localeCompare(b.slug)));
  return { entries, errors };
}

// CLI execution
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const skins = scanAndValidateCommunity();
  const accs = scanAndValidateAccessories();
  const kbs = scanAndValidateKeyboards();
  const allErrors = [...skins.errors, ...accs.errors, ...kbs.errors];
  if (allErrors.length > 0) {
    console.error('❌ 广场投稿校验失败：\n');
    for (const err of allErrors) console.error('  - ' + err);
    process.exit(1);
  }
  console.log(`✅ 校验通过！共 ${skins.entries.length} 款皮肤 + ${accs.entries.length} 款饰品 + ${kbs.entries.length} 款键盘符合 KuroCat v1 规范。`);
}
