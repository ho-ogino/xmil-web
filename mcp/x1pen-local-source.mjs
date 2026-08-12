import { createHash } from 'node:crypto';
import { constants, realpathSync, statSync } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const MAX_LOCAL_SOURCE_BYTES = 512 * 1024;

export class LocalSourceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LocalSourceError';
    this.code = code;
    this.component = 'mcp';
    Object.assign(this, details);
  }
}

function sourceError(code, message, details = {}) {
  return new LocalSourceError(code, message, details);
}

export function canonicalizeAllowedSourceRoots(rootPaths = []) {
  const roots = [];
  for (const rootPath of rootPaths) {
    if (typeof rootPath !== 'string' || rootPath.length === 0) {
      throw new Error('Allowed source roots must be non-empty paths');
    }
    const canonical = realpathSync(resolve(rootPath));
    if (!statSync(canonical).isDirectory()) {
      throw new Error(`Allowed source root is not a directory: ${rootPath}`);
    }
    if (!roots.includes(canonical)) roots.push(canonical);
  }
  return Object.freeze(roots);
}

export function assertSourceRootsConfigured(allowedRoots) {
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
    throw sourceError(
      'SOURCE_ROOT_NOT_CONFIGURED',
      'Local source-file access is disabled because no allowed source root is configured',
      { action: 'Restart x1pen-mcp with one or more --allow-source-root options.' },
    );
  }
}

function isWithinRoot(candidate, root) {
  const child = relative(root, candidate);
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshot(left, right) {
  return sameIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs;
}

const DEFAULT_IO = Object.freeze({ open, realpath, stat });

async function canonicalCandidate(filePath, allowedRoots, io) {
  let candidate;
  try {
    candidate = await io.realpath(resolve(filePath));
  } catch {
    throw sourceError('SOURCE_FILE_NOT_FOUND', 'The local source file does not exist or cannot be resolved');
  }
  if (!allowedRoots.some((root) => isWithinRoot(candidate, root))) {
    throw sourceError('SOURCE_PATH_NOT_ALLOWED', 'The local source file is outside every allowed source root');
  }
  return candidate;
}

async function readBounded(handle, maxBytes) {
  const bytes = Buffer.alloc(maxBytes + 1);
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.read(bytes, offset, bytes.length - offset, null);
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  if (offset > maxBytes) {
    throw sourceError(
      'SOURCE_FILE_TOO_LARGE',
      `The local source file exceeds the ${maxBytes}-byte limit`,
      { limit: maxBytes, actual: offset },
    );
  }
  return bytes.subarray(0, offset);
}

export async function readLocalUtf8Source(filePath, options = {}) {
  const allowedRoots = options.allowedRoots || [];
  const maxBytes = options.maxBytes ?? MAX_LOCAL_SOURCE_BYTES;
  const io = options.io || DEFAULT_IO;
  assertSourceRootsConfigured(allowedRoots);
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw sourceError('SOURCE_PATH_INVALID', 'The local source path must be a non-empty string');
  }

  const candidate = await canonicalCandidate(filePath, allowedRoots, io);
  let handle;
  let before;
  let after;
  let bytes;
  try {
    handle = await io.open(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw sourceError('SOURCE_FILE_NOT_REGULAR', 'The local source path is not a regular file');
    }
    if (before.size > BigInt(maxBytes)) {
      throw sourceError(
        'SOURCE_FILE_TOO_LARGE',
        `The local source file exceeds the ${maxBytes}-byte limit`,
        { limit: maxBytes, actual: Number(before.size) },
      );
    }
    bytes = await readBounded(handle, maxBytes);
    after = await handle.stat({ bigint: true });
  } catch (error) {
    if (error instanceof LocalSourceError) throw error;
    throw sourceError('SOURCE_FILE_READ_FAILED', 'The local source file could not be read safely');
  } finally {
    if (handle) await handle.close().catch(() => {});
  }

  let finalCandidate;
  let finalStat;
  try {
    finalCandidate = await io.realpath(resolve(filePath));
    finalStat = await io.stat(candidate, { bigint: true });
  } catch {
    throw sourceError('SOURCE_FILE_CHANGED', 'The local source file changed while it was being read');
  }
  if (finalCandidate !== candidate || !sameSnapshot(before, after) || !sameIdentity(after, finalStat)) {
    throw sourceError('SOURCE_FILE_CHANGED', 'The local source file changed while it was being read');
  }

  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw sourceError('SOURCE_FILE_INVALID_UTF8', 'The local source file is not valid UTF-8');
  }
  if (source.startsWith('\uFEFF')) source = source.slice(1);
  source = source.replace(/\r\n?/g, '\n');
  if (source.includes('\0')) {
    throw sourceError('SOURCE_FILE_CONTAINS_NUL', 'The local source file contains a NUL character');
  }

  return {
    source,
    byteCount: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
