import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';

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
 * Expand ~ to home directory.
 */
export function expandTilde(p: string): string {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

/**
 * Soul manifest format (SOUL_MANIFEST.json).
 */
export interface SoulManifestConfig {
  version?: string;
  include?: string[];  // Paths relative to workspace or absolute
  exclude?: string[];  // Glob patterns to exclude
}

/**
 * Try to read SOUL_MANIFEST.json from workspace.
 * Returns null if not found.
 */
async function readSoulManifest(workspacePath: string): Promise<SoulManifestConfig | null> {
  const manifestPath = join(workspacePath, 'SOUL_MANIFEST.json');
  try {
    const content = await readFile(manifestPath, 'utf-8');
    return JSON.parse(content) as SoulManifestConfig;
  } catch {
    return null;
  }
}

/**
 * Discover all soul files in a workspace directory.
 * If SOUL_MANIFEST.json exists, uses it. Otherwise falls back to defaults.
 * Returns objects with relative archive path and absolute source path.
 */
export async function discoverSoulFiles(workspacePath: string): Promise<string[]> {
  const manifest = await readSoulManifest(workspacePath);
  
  if (manifest?.include) {
    return discoverFromManifest(workspacePath, manifest);
  }
  
  return discoverDefaults(workspacePath);
}

/**
 * Discover files from a manifest's include list.
 */
async function discoverFromManifest(workspacePath: string, manifest: SoulManifestConfig): Promise<string[]> {
  const found: string[] = [];
  const excludeSet = new Set(manifest.exclude || []);
  
  for (const entry of manifest.include || []) {
    const expanded = expandTilde(entry);
    const isAbsolute = expanded.startsWith('/');
    const fullPath = isAbsolute ? expanded : join(workspacePath, expanded);
    
    try {
      const s = await stat(fullPath);
      if (s.isFile()) {
        // For absolute paths, store with special prefix
        if (isAbsolute) {
          found.push(`__external__${expanded}`);
        } else {
          found.push(entry);
        }
      } else if (s.isDirectory()) {
        const entries = await walkDir(fullPath, excludeSet);
        for (const filePath of entries) {
          if (isAbsolute) {
            found.push(`__external__${filePath}`);
          } else {
            found.push(relative(workspacePath, filePath));
          }
        }
      }
    } catch {
      // Path doesn't exist, skip with warning
      console.warn(`Warning: manifest path not found: ${entry}`);
    }
  }
  
  return found;
}

/**
 * Discover files using default CORE_FILES and SOUL_DIRS.
 */
async function discoverDefaults(workspacePath: string): Promise<string[]> {
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

async function walkDir(dirPath: string, extraExclude: Set<string> = new Set()): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (EXCLUDE.has(entry.name) || extraExclude.has(entry.name)) continue;
    const full = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = await walkDir(full, extraExclude);
      results.push(...sub);
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}
