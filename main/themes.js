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

function loadThemeJson(themeId) {
  const id = themeId || 'race-crab';
  const themePath = path.join(THEMES_DIR, id, 'theme.json');
  try {
    return JSON.parse(fs.readFileSync(themePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeThemeId(themeId, fallback = 'race-crab') {
  const id = String(themeId || '').trim();
  return id && loadThemeJson(id) ? id : fallback;
}

function themeAnimationsPath(themeId) {
  const id = themeId || 'race-crab';
  const candidates = [
    path.join(RENDERER_ASSETS, id, 'animations.json'),
    path.join(THEMES_DIR, id, 'animations.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(RENDERER_ASSETS, 'race-crab', 'animations.json');
}

function themeAssetAbs(themeId, rel) {
  const id = themeId || 'race-crab';
  const safe = String(rel || '')
    .replace(/\\/g, '/')
    .replace(/\.\./g, '');
  const parts = safe.split('/').filter(Boolean);
  const candidates = [
    path.join(RENDERER_ASSETS, id, ...parts),
    path.join(THEMES_DIR, id, ...parts),
    path.join(THEMES_DIR, id, 'sprites', ...parts),
    path.join(RENDERER_ASSETS, 'race-crab', ...parts),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(RENDERER_ASSETS, 'race-crab', ...parts);
}

module.exports = {
  THEMES_DIR,
  listThemes,
  loadThemeJson,
  normalizeThemeId,
  themeAnimationsPath,
  themeAssetAbs,
};
