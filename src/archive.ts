import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { pack, extract } from './tar.js';
import { sha256File, soulChecksum } from './checksum.js';
import { discoverSoulFiles } from './soul-files.js';
import type { SoulManifest, FileEntry } from './manifest.js';

/**
 * Create a .soul archive from a workspace directory.
 */
export async function createSoulArchive(opts: {
  workspacePath: string;
  outputPath: string;
  agent: string;
  source: string;
}): Promise<SoulManifest> {
  const { workspacePath, outputPath, agent, source } = opts;

  const filePaths = await discoverSoulFiles(workspacePath);
  if (filePaths.length === 0) {
    throw new Error('No soul files found in workspace');
  }

  const files: FileEntry[] = [];
  for (const relPath of filePaths) {
    const fullPath = join(workspacePath, relPath);
    const hash = await sha256File(fullPath);
    const s = await stat(fullPath);
    files.push({ path: relPath, sha256: hash, size: s.size });
  }

  const manifest: SoulManifest = {
    version: '1.0',
    agent,
    source,
    timestamp: new Date().toISOString(),
    files,
    checksum: soulChecksum(files),
  };

  // Build tar.gz in memory using our minimal tar implementation
  const entries: Array<{ name: string; data: Buffer }> = [];

  // Add manifest first
  const manifestJson = JSON.stringify(manifest, null, 2);
  entries.push({ name: 'manifest.json', data: Buffer.from(manifestJson) });

  // Add all soul files
  for (const relPath of filePaths) {
    const fullPath = join(workspacePath, relPath);
    const data = await readFile(fullPath);
    entries.push({ name: relPath, data });
  }

  const tarball = pack(entries);

  // gzip and write
  await mkdir(dirname(outputPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const gzip = createGzip({ level: 9 });
    const out = createWriteStream(outputPath);
    out.on('finish', resolve);
    out.on('error', reject);
    gzip.on('error', reject);
    gzip.end(tarball);
    gzip.pipe(out);
  });

  return manifest;
}

/**
 * Extract and verify a .soul archive.
 * Returns the manifest. Throws on integrity failure.
 */
export async function extractSoulArchive(opts: {
  archivePath: string;
  outputPath: string;
  dryRun?: boolean;
}): Promise<SoulManifest> {
  const { archivePath, outputPath, dryRun } = opts;

  // Read and decompress
  const compressed = await readFile(archivePath);
  const decompressed = await new Promise<Buffer>((resolve, reject) => {
    const gunzip = createGunzip();
    const chunks: Buffer[] = [];
    gunzip.on('data', (chunk: Buffer) => chunks.push(chunk));
    gunzip.on('end', () => resolve(Buffer.concat(chunks)));
    gunzip.on('error', reject);
    gunzip.end(compressed);
  });

  const entries = extract(decompressed);

  // Find manifest
  const manifestEntry = entries.find(e => e.name === 'manifest.json');
  if (!manifestEntry) throw new Error('No manifest.json in archive');

  const manifest: SoulManifest = JSON.parse(manifestEntry.data.toString('utf8'));

  // Verify each file's checksum
  for (const file of manifest.files) {
    const entry = entries.find(e => e.name === file.path);
    if (!entry) throw new Error(`Missing file in archive: ${file.path}`);

    const { sha256 } = await import('./checksum.js');
    const hash = sha256(entry.data);
    if (hash !== file.sha256) {
      throw new Error(`Integrity check failed for ${file.path}: expected ${file.sha256}, got ${hash}`);
    }
  }

  // Verify overall checksum
  const computed = soulChecksum(manifest.files);
  if (computed !== manifest.checksum) {
    throw new Error(`Overall soul integrity check failed: expected ${manifest.checksum}, got ${computed}`);
  }

  // Write files if not dry run
  if (!dryRun) {
    await mkdir(outputPath, { recursive: true });

    // Write manifest
    await writeFile(join(outputPath, 'manifest.json'), manifestEntry.data);

    // Write all files
    for (const file of manifest.files) {
      const entry = entries.find(e => e.name === file.path)!;
      const filePath = join(outputPath, file.path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, entry.data);
    }
  }

  return manifest;
}
