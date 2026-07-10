'use strict';

const fs = require('fs');
const path = require('path');

const THEMES_DIR = path.join(__dirname, '..', 'themes');
const RENDERER_ASSETS = path.join(__dirname, '..', 'renderer', 'assets');

/** Cached metadata keeps state pushes and dashboard snapshots off the disk. */
let themesCache = null;
const themeJsonCache = new Map();

/**
 * List installed pet themes (future multi-pet picker).
 * @returns {{ id: string, name: string, description: string, preview: string|null }[]}
 */
function listThemes() {
  if (themesCache) return themesCache.map((theme) => ({ ...theme }));
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
  themesCache = out;
  return out.map((theme) => ({ ...theme }));
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
  if (themeJsonCache.has(id)) {
    const cached = themeJsonCache.get(id);
    return cached ? { ...cached } : null;
  }
  const themePath = path.join(THEMES_DIR, id, 'theme.json');
  if (!pathUnderBase(THEMES_DIR, themePath)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(themePath, 'utf8'));
    themeJsonCache.set(id, meta);
    return { ...meta };
  } catch {
    themeJsonCache.set(id, null);
    return null;
  }
}

/**
 * Clear cached theme metadata after an installed theme changes on disk.
 * @param {string} [themeId] omit to clear every cached theme
 */
function invalidateThemeCache(themeId) {
  themesCache = null;
  const id = sanitizeThemeId(themeId);
  if (id) themeJsonCache.delete(id);
  else themeJsonCache.clear();
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

/**
 * Base directory for renderer-owned animation assets. The renderer resolves
 * all manifest-relative frame URLs from this one trusted directory URL.
 * @param {string} [themeId]
 * @returns {string}
 */
function themeAssetBase(themeId) {
  const id = sanitizeThemeId(themeId) || 'race-crab';
  const candidate = path.join(RENDERER_ASSETS, id);
  const safe = pathUnderBase(RENDERER_ASSETS, candidate);
  try {
    if (safe && fs.statSync(safe).isDirectory()) return safe;
  } catch {
    /* use shipped fallback */
  }
  return path.join(RENDERER_ASSETS, 'race-crab');
}

module.exports = {
  THEMES_DIR,
  RENDERER_ASSETS,
  listThemes,
  loadThemeJson,
  invalidateThemeCache,
  normalizeThemeId,
  sanitizeThemeId,
  pathUnderBase,
  themeAnimationsPath,
  themeAssetBase,
  themeAssetAbs,
};
