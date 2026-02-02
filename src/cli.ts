#!/usr/bin/env node
/**
 * SCP — Soul Copy Protocol
 *
 * Usage:
 *   scp backup <workspace-path> <output-dir> [--agent <name>]
 *   scp verify <archive.soul>
 *   scp restore <archive.soul> <workspace-path> [--dry-run]
 *   scp inspect <archive.soul>
 *
 * Remote (via ssh):
 *   scp backup <agent>@<host>:<workspace-path> <output-dir>
 *   scp restore <archive.soul> <agent>@<host>:<workspace-path>
 */

import { createSoulArchive, extractSoulArchive } from './archive.js';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { execSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { SoulManifest } from './manifest.js';

interface ParsedTarget {
  agent: string;
  host: string | null;
  path: string;
}

function parseTarget(target: string): ParsedTarget {
  // agent@host:/path or /local/path
  const match = target.match(/^([^@]+)@([^:]+):(.+)$/);
  if (match) {
    return { agent: match[1], host: match[2], path: match[3] };
  }
  return { agent: '', host: null, path: target };
}

function archiveName(agent: string): string {
  const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  return `${agent}-${date}.soul`;
}

async function rsyncFrom(host: string, remotePath: string, localPath: string): Promise<void> {
  execSync(`rsync -az --delete "${host}:${remotePath}/" "${localPath}/"`, { stdio: 'pipe' });
}

async function rsyncTo(localPath: string, host: string, remotePath: string): Promise<void> {
  execSync(`rsync -az "${localPath}/" "${host}:${remotePath}/"`, { stdio: 'pipe' });
}

async function backup(args: string[]): Promise<void> {
  const source = args[0];
  const outputDir = args[1];
  const agentFlag = args.indexOf('--agent');
  let agentName = agentFlag >= 0 ? args[agentFlag + 1] : '';

  if (!source || !outputDir) {
    console.error('Usage: scp backup <workspace-path|agent@host:path> <output-dir> [--agent <name>]');
    process.exit(1);
  }

  const target = parseTarget(source);
  if (!agentName) agentName = target.agent || 'unknown';

  let workspacePath = target.path;
  let tmpDir: string | null = null;

  // Remote: rsync to temp dir first
  if (target.host) {
    tmpDir = await mkdtemp(join(tmpdir(), 'scp-'));
    console.log(`⬇  Fetching soul from ${target.host}:${target.path}...`);
    await rsyncFrom(target.host, target.path, tmpDir);
    workspacePath = tmpDir;
  }

  const outputPath = join(outputDir, archiveName(agentName));
  console.log(`📦 Archiving ${agentName}'s soul...`);

  try {
    const manifest = await createSoulArchive({
      workspacePath,
      outputPath,
      agent: agentName,
      source: target.host || hostname(),
    });

    console.log(`✓ Soul archived: ${outputPath}`);
    console.log(`  Agent: ${manifest.agent}`);
    console.log(`  Files: ${manifest.files.length}`);
    console.log(`  Checksum: ${manifest.checksum.slice(0, 16)}...`);
    console.log(`  Timestamp: ${manifest.timestamp}`);
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true });
  }
}

async function verify(args: string[]): Promise<void> {
  const archivePath = args[0];
  if (!archivePath) {
    console.error('Usage: scp verify <archive.soul>');
    process.exit(1);
  }

  console.log(`🔍 Verifying ${archivePath}...`);
  try {
    const manifest = await extractSoulArchive({
      archivePath,
      outputPath: '', // not used in dry run
      dryRun: true,
    });

    console.log(`✓ Soul integrity verified`);
    console.log(`  Agent: ${manifest.agent}`);
    console.log(`  Source: ${manifest.source}`);
    console.log(`  Files: ${manifest.files.length}`);
    console.log(`  Checksum: ${manifest.checksum.slice(0, 16)}...`);
    console.log(`  Timestamp: ${manifest.timestamp}`);
  } catch (err: any) {
    console.error(`✗ Integrity check FAILED: ${err.message}`);
    process.exit(1);
  }
}

async function inspect(args: string[]): Promise<void> {
  const archivePath = args[0];
  if (!archivePath) {
    console.error('Usage: scp inspect <archive.soul>');
    process.exit(1);
  }

  const manifest = await extractSoulArchive({
    archivePath,
    outputPath: '',
    dryRun: true,
  });

  console.log(`Soul: ${manifest.agent} @ ${manifest.source}`);
  console.log(`Time: ${manifest.timestamp}`);
  console.log(`Checksum: ${manifest.checksum}`);
  console.log(`\nFiles:`);
  for (const f of manifest.files) {
    const kb = (f.size / 1024).toFixed(1);
    console.log(`  ${f.path.padEnd(40)} ${kb.padStart(8)} KB  ${f.sha256.slice(0, 12)}...`);
  }
}

async function restore(args: string[]): Promise<void> {
  const archivePath = args[0];
  const dest = args[1];
  const dryRun = args.includes('--dry-run');

  if (!archivePath || !dest) {
    console.error('Usage: scp restore <archive.soul> <workspace-path|agent@host:path> [--dry-run]');
    process.exit(1);
  }

  const target = parseTarget(dest);

  console.log(`${dryRun ? '🔍 Dry run: ' : ''}Restoring soul to ${dest}...`);

  // Verify first
  const manifest = await extractSoulArchive({
    archivePath,
    outputPath: '',
    dryRun: true,
  });

  console.log(`  Soul: ${manifest.agent} (${manifest.files.length} files)`);
  console.log(`  From: ${manifest.source} at ${manifest.timestamp}`);
  console.log(`  Checksum: ${manifest.checksum.slice(0, 16)}...`);

  if (dryRun) {
    console.log('✓ Dry run complete — archive is valid');
    return;
  }

  if (target.host) {
    // Remote restore: extract to tmp, rsync to remote
    const tmpDir = await mkdtemp(join(tmpdir(), 'scp-restore-'));
    try {
      await extractSoulArchive({ archivePath, outputPath: tmpDir });
      console.log(`⬆  Pushing soul to ${target.host}:${target.path}...`);
      await rsyncTo(tmpDir, target.host, target.path);
      console.log('✓ Soul restored');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  } else {
    await extractSoulArchive({ archivePath, outputPath: target.path });
    console.log('✓ Soul restored');
  }
}

// Main
const [command, ...args] = process.argv.slice(2);

const commands: Record<string, (args: string[]) => Promise<void>> = {
  backup,
  verify,
  inspect,
  restore,
};

if (!command || !commands[command]) {
  console.log(`SCP — Soul Copy Protocol ♜

Usage:
  scp backup <workspace|agent@host:path> <output-dir> [--agent <name>]
  scp verify <archive.soul>
  scp inspect <archive.soul>
  scp restore <archive.soul> <workspace|agent@host:path> [--dry-run]

The .soul archive is a compressed, checksummed snapshot of an agent's
identity files: SOUL.md, MEMORY.md, memory/*, and everything that makes
the agent who they are.`);
  process.exit(command ? 1 : 0);
}

commands[command](args).catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
