/**
 * Memory of the user's manual COA corrections, keyed by normalized transaction label.
 * Exact-key reuse only (explainable and deterministic); conflicting corrections disable an entry.
 * Persists to localStorage when available, otherwise lives in memory for the page lifetime.
 */
import { normalizeForMatch } from "../engine/sanitizer.js";

const STORAGE_KEY = "ziswaf_learned_v1";
const MAX_ENTRIES = 2000;
const MIN_TOKENS = 2;

let entries = load();

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function load() {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function persist() {
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* memory-only fallback */ }
}

/** Lowercase canonical label without digits/punctuation; "" when too generic to learn from. */
export function normalizeLearnKey(label) {
  const tokens = normalizeForMatch(label)
    .replace(/\d+/g, " ")
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter(token => token.length >= 2);
  return tokens.length >= MIN_TOKENS ? tokens.join(" ") : "";
}

export function learnFromCorrection(label, programId, coa) {
  const key = normalizeLearnKey(label);
  const code = Number(coa);
  if (!key || !Number.isFinite(code) || code <= 0) return;
  const existing = entries[key];
  if (existing) {
    if (existing.coa === code && (existing.programId || null) === (programId || null)) existing.count += 1;
    else existing.conflict = true;
  } else {
    if (Object.keys(entries).length >= MAX_ENTRIES) return;
    entries[key] = { coa: code, programId: programId || null, count: 1, conflict: false };
  }
  persist();
}

/** Returns { key, coa, programId, count } or null (unknown, too generic, or conflicting). */
export function lookupLearned(label) {
  const key = normalizeLearnKey(label);
  const entry = key ? entries[key] : null;
  if (!entry || entry.conflict) return null;
  return { key, coa: entry.coa, programId: entry.programId, count: entry.count };
}

export function clearLearned() {
  entries = {};
  try { storage()?.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export function getLearnedCount() {
  return Object.keys(entries).length;
}
