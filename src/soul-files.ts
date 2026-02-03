import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

/**
 * Core workspace files that define an agent's identity.
 * These are always included if they exist.
 */
export const CORE_FILES = [
  'SOUL.md',
  'MEMORY.md',
  'AGENTS.md',
  'USER.md',
  'TOOLS.md',
  'IDENTITY.md',
  'HEARTBEAT.md',
  'SECURITY.md',
  'BOOTSTRAP.md',
  'BUCKETLIST.md',
] as const;

/**
 * Directories to include recursively.
 */
export const SOUL_DIRS = [
  'memory',
  'skills',
] as const;

/**
 * Files/patterns to always exclude from backups.
 */
const EXCLUDE = new Set([
  '.git',
  'node_modules',
  'dist',
  '.env',
]);

/**
 * Secrets patterns — lines matching these are redacted in config files.
 */
export const SECRET_PATTERNS = [
  /api[_-]?key/i,
  /token/i,
  /password/i,
  /secret/i,
  /app[_-]?password/i,
  /credential/i,
];

/**
 * Discover all soul files in a workspace directory.
 * Returns paths relative to the workspace root.
 */
export async function discoverSoulFiles(workspacePath: string): Promise<string[]> {
  const found: string[] = [];

  // Check core files
  for (const file of CORE_FILES) {
    const full = join(workspacePath, file);
    try {
      const s = await stat(full);
      if (s.isFile()) found.push(file);
    } catch {
      // doesn't exist, skip
    }
  }

  // Recurse into soul directories
  for (const dir of SOUL_DIRS) {
    const dirPath = join(workspacePath, dir);
    try {
      const entries = await walkDir(dirPath);
      for (const entry of entries) {
        const rel = relative(workspacePath, entry);
        found.push(rel);
      }
    } catch {
      // directory doesn't exist, skip
    }
  }

  return found;
}

async function walkDir(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (EXCLUDE.has(entry.name)) continue;
    const full = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = await walkDir(full);
      results.push(...sub);
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}
