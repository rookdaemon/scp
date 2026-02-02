/**
 * Soul archive manifest — the identity card of a backup.
 */
export interface SoulManifest {
  /** Protocol version */
  version: '1.0';
  /** Agent name (from IDENTITY.md or directory name) */
  agent: string;
  /** Source hostname or address */
  source: string;
  /** UTC ISO timestamp of backup */
  timestamp: string;
  /** Files included with their checksums */
  files: FileEntry[];
  /** SHA-256 of all file checksums concatenated (integrity of the whole) */
  checksum: string;
}

export interface FileEntry {
  /** Relative path within the soul archive */
  path: string;
  /** SHA-256 hex digest of file contents */
  sha256: string;
  /** File size in bytes */
  size: number;
}
