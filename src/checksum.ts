import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Compute SHA-256 hex digest of a file.
 */
export async function sha256File(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return sha256(data);
}

/**
 * Compute SHA-256 hex digest of a buffer.
 */
export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Compute the overall soul checksum from individual file checksums.
 * Deterministic: sorts by path, concatenates checksums, hashes the result.
 */
export function soulChecksum(files: Array<{ path: string; sha256: string }>): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const concat = sorted.map(f => f.sha256).join('');
  return sha256(concat);
}
