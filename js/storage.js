/**
 * DataMend Lab — Local-First Browser Storage & URL Hash State Manager
 * Adheres to APPLICATION_GUIDELINES.md Section B.3 & Part 34.6:
 * - All localStorage accesses safely wrapped in try/catch blocks
 * - Transparent persistence status with one-click explicit deletion
 * - Lossless Base64 JSON URL hash state encoding (#state=...)
 * - Zero external telemetry or network calls.
 */

const STORAGE_KEY_RECIPES = 'datamend_lab_saved_recipes_v1';
const STORAGE_KEY_SETTINGS = 'datamend_lab_ui_settings_v1';

export function loadSavedRecipes() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY_RECIPES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecipeToStorage(recipe) {
  try {
    if (typeof localStorage === 'undefined') return { saved: false, reason: 'localStorage unavailable' };
    const existing = loadSavedRecipes().filter(r => r.recipeId !== recipe.recipeId);
    existing.unshift(recipe);
    localStorage.setItem(STORAGE_KEY_RECIPES, JSON.stringify(existing.slice(0, 25)));
    return { saved: true, count: existing.length };
  } catch (err) {
    return { saved: false, reason: err.message || 'Storage quota exceeded or blocked' };
  }
}

export function clearAllBrowserStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY_RECIPES);
      localStorage.removeItem(STORAGE_KEY_SETTINGS);
    }
    if (typeof window !== 'undefined' && window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    return true;
  } catch {
    return false;
  }
}

export function encodeWorkspaceHashState(stateObj) {
  try {
    const json = JSON.stringify(stateObj);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(json, 'utf-8').toString('base64');
    return `#state=${encodeURIComponent(b64)}`;
  } catch {
    return '';
  }
}

export function decodeWorkspaceHashState(hashStr) {
  try {
    if (!hashStr || !hashStr.includes('state=')) return null;
    const m = /state=([^&]+)/.exec(hashStr);
    if (!m) return null;
    const b64 = decodeURIComponent(m[1]);
    let json;
    if (typeof atob === 'function') {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      json = new TextDecoder().decode(bytes);
    } else {
      json = Buffer.from(b64, 'base64').toString('utf-8');
    }
    return JSON.parse(json);
  } catch {
    return null;
  }
}
