'use strict';

const fs = require('fs');
const path = require('path');

const THEMES_DIR = path.join(__dirname, '..', 'themes');
const RENDERER_ASSETS = path.join(__dirname, '..', 'renderer', 'assets');

/**
 * List installed pet themes (future multi-pet picker).
 * @returns {{ id: string, name: string, description: string, preview: string|null }[]}
 */
function listThemes() {
  /** @type {{ id: string, name: string, description: string, preview: string|null }[]} */
  const out = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(THEMES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return out;
  }
  for (const d of dirs) {
    const id = d.name;
    const themePath = path.join(THEMES_DIR, id, 'theme.json');
    let meta = { id, name: id, description: '' };
    try {
      meta = { ...meta, ...JSON.parse(fs.readFileSync(themePath, 'utf8')) };
    } catch {
      /* use defaults */
    }
    const previewCandidates = [
      path.join(THEMES_DIR, id, 'sprites', 'idle.png'),
      path.join(RENDERER_ASSETS, id, 'idle.png'),
      path.join(RENDERER_ASSETS, id, 'frames', 'idle_00.png'),
    ];
    let preview = null;
    for (const p of previewCandidates) {
      if (fs.existsSync(p)) {
        preview = p;
        break;
      }
    }
    out.push({
      id: meta.id || id,
      name: meta.name || id,
      description: meta.description || '',
      preview,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Theme ids are directory names under themes/. Reject path separators and `..`.
 * @param {unknown} themeId
 * @returns {string | null}
 */
function sanitizeThemeId(themeId) {
  const id = String(themeId || '').trim();
  if (!id) return null;
  if (id.includes('..') || id.includes('/') || id.includes('\\') || id.includes('\0')) {
    return null;
  }
  // Only allow simple slug-like ids (matches shipped themes and safe future ones)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) return null;
  return id;
}

/**
 * Resolve a path and ensure it stays under `base` (after realpath where possible).
 * @param {string} base
 * @param {string} candidate
 * @returns {string | null}
 */
function pathUnderBase(base, candidate) {
  const baseResolved = path.resolve(base);
  const resolved = path.resolve(candidate);
  const prefix = baseResolved.endsWith(path.sep) ? baseResolved : baseResolved + path.sep;
  if (resolved === baseResolved || resolved.startsWith(prefix)) return resolved;
  return null;
}

function loadThemeJson(themeId) {
  const id = sanitizeThemeId(themeId) || 'race-crab';
  const themePath = path.join(THEMES_DIR, id, 'theme.json');
  if (!pathUnderBase(THEMES_DIR, themePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(themePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeThemeId(themeId, fallback = 'race-crab') {
  const id = sanitizeThemeId(themeId);
  return id && loadThemeJson(id) ? id : fallback;
}

/**
 * Path to the animations manifest for a theme.
 * @param {string} [themeId]
 * @param {'fluid' | 'static'} [mode] static → classic low-fps packs; fluid → 24fps
 */
function themeAnimationsPath(themeId, mode = 'fluid') {
  const id = sanitizeThemeId(themeId) || 'race-crab';
  const preferStatic = String(mode || '').toLowerCase() === 'static';
  /** @type {string[]} */
  const candidates = preferStatic
    ? [
        path.join(RENDERER_ASSETS, id, 'animations-static.json'),
        path.join(THEMES_DIR, id, 'animations-static.json'),
        // Fall back to fluid/main manifest if a theme has no separate static pack
        path.join(RENDERER_ASSETS, id, 'animations.json'),
        path.join(THEMES_DIR, id, 'animations.json'),
      ]
    : [
        path.join(RENDERER_ASSETS, id, 'animations.json'),
        path.join(THEMES_DIR, id, 'animations.json'),
      ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(
    RENDERER_ASSETS,
    'race-crab',
    preferStatic ? 'animations-static.json' : 'animations.json'
  );
}

/**
 * Absolute path to a theme asset, constrained under renderer assets / themes.
 * @param {string} [themeId]
 * @param {string} [rel]
 * @returns {string}
 */
function themeAssetAbs(themeId, rel) {
  const id = sanitizeThemeId(themeId) || 'race-crab';
  const parts = String(rel || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..');
  const bases = [
    path.join(RENDERER_ASSETS, id),
    path.join(THEMES_DIR, id),
    path.join(THEMES_DIR, id, 'sprites'),
    path.join(RENDERER_ASSETS, 'race-crab'),
  ];
  for (const base of bases) {
    const candidate = path.join(base, ...parts);
    const safe = pathUnderBase(base, candidate);
    if (safe && fs.existsSync(safe)) return safe;
  }
  // Fallback under race-crab assets only (never outside)
  const fallbackBase = path.join(RENDERER_ASSETS, 'race-crab');
  const fallback = path.join(fallbackBase, ...parts);
  return pathUnderBase(fallbackBase, fallback) || path.join(fallbackBase, 'idle.png');
}

module.exports = {
  THEMES_DIR,
  RENDERER_ASSETS,
  listThemes,
  loadThemeJson,
  normalizeThemeId,
  sanitizeThemeId,
  pathUnderBase,
  themeAnimationsPath,
  themeAssetAbs,
};
