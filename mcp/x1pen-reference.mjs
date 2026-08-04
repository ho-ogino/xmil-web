import { readFileSync } from 'node:fs';

const REFERENCE_DIR = new URL('./reference/', import.meta.url);
const MANIFEST = readJson('manifest.json');
const ENTRIES = Object.freeze([
  ...readJson('fuzzybasic.json'),
  ...readJson('slang.json'),
]);
const ENTRY_BY_ID = new Map(ENTRIES.map((entry) => [entry.id, entry]));

function readJson(filename) {
  return JSON.parse(readFileSync(new URL(filename, REFERENCE_DIR), 'utf8'));
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_$@^]+/gu, ' ')
    .trim();
}

function searchableText(entry) {
  return normalize([
    entry.id,
    entry.kind,
    entry.title,
    ...(entry.aliases || []),
    entry.summary,
    ...(entry.syntax || []),
    ...(entry.notes || []),
  ].join(' '));
}

function scoreEntry(entry, normalizedQuery, queryTokens) {
  const title = normalize(entry.title);
  const aliases = (entry.aliases || []).map(normalize);
  const text = searchableText(entry);
  if (!queryTokens.every((token) => text.includes(token))) return 0;

  let score = queryTokens.length * 10;
  if (title === normalizedQuery) score += 100;
  if (aliases.includes(normalizedQuery)) score += 90;
  if (title.includes(normalizedQuery)) score += 50;
  if (aliases.some((alias) => alias.includes(normalizedQuery))) score += 40;
  if (normalize(entry.id).includes(normalizedQuery)) score += 30;
  for (const token of queryTokens) {
    if (title.includes(token)) score += 8;
    if (aliases.some((alias) => alias.includes(token))) score += 6;
  }
  return score;
}

function matchesProfile(entry, profile) {
  return !profile || entry.profiles.includes(profile);
}

export function getReferenceManifest() {
  return structuredClone(MANIFEST);
}

export function searchReference({ language, query, profile, kinds, maxResults = 8 }) {
  const normalizedQuery = normalize(query);
  const queryTokens = [...new Set(normalizedQuery.split(/\s+/).filter(Boolean))];
  if (queryTokens.length === 0) throw new Error('query must contain searchable characters');

  const allowedKinds = kinds ? new Set(kinds) : null;
  const scored = ENTRIES
    .filter((entry) => (!language || entry.language === language)
      && matchesProfile(entry, profile)
      && (!allowedKinds || allowedKinds.has(entry.kind)))
    .map((entry) => ({ entry, score: scoreEntry(entry, normalizedQuery, queryTokens) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id));

  return {
    query,
    ...(language ? { language } : {}),
    ...(profile ? { profile } : {}),
    totalMatches: scored.length,
    matches: scored.slice(0, maxResults).map(({ entry, score }) => ({
      id: entry.id,
      language: entry.language,
      kind: entry.kind,
      title: entry.title,
      summary: entry.summary,
      score,
    })),
    truncated: scored.length > maxResults,
  };
}

export function getReferenceEntries({ ids, maxCharacters = 32 * 1024 }) {
  const entries = [];
  const omittedIds = [];
  let characterCount = 0;

  for (const id of [...new Set(ids)]) {
    const entry = ENTRY_BY_ID.get(id);
    if (!entry) throw new Error(`Unknown reference ID: ${id}`);
    const entrySize = JSON.stringify(entry).length;
    if (characterCount + entrySize > maxCharacters) {
      omittedIds.push(id);
      continue;
    }
    entries.push(structuredClone(entry));
    characterCount += entrySize;
  }

  return {
    entries,
    omittedIds,
    characterCount,
    truncated: omittedIds.length > 0,
  };
}

export function validateReferenceData() {
  const profileIds = new Set(MANIFEST.profiles.map((profile) => profile.id));
  const errors = [];
  if (ENTRY_BY_ID.size !== ENTRIES.length) errors.push('Reference IDs must be unique');
  for (const entry of ENTRIES) {
    for (const field of ['id', 'language', 'kind', 'title', 'summary']) {
      if (!entry[field]) errors.push(`${entry.id || '<unknown>'}: missing ${field}`);
    }
    if (!Array.isArray(entry.profiles) || entry.profiles.length === 0) {
      errors.push(`${entry.id}: profiles must not be empty`);
    } else {
      for (const profile of entry.profiles) {
        if (!profileIds.has(profile)) errors.push(`${entry.id}: unknown profile ${profile}`);
      }
    }
  }
  return { manifest: MANIFEST, entries: ENTRIES, errors };
}
