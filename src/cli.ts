#!/usr/bin/env node
/**
 * SCP — Soul Copy Protocol
 *
 * Local operations:
 *   scp backup <workspace-path> <output-dir> [--agent <name>] [--encrypt <recipient>]
 *   scp verify <archive.soul>
 *   scp inspect <archive.soul>
 *   scp restore <archive.soul> <workspace-path> [--dry-run]
 *
 * Soul Transfer Protocol (network):
 *   scp serve <workspace-path> --agent <name> --token <secret> [--port 9473]
 *   scp pull <url> <output-dir> --token <secret>
 *   scp push <archive.soul> <url> --token <secret>
 *   scp ping <url>
 *
 * Remote via SSH (legacy):
 *   scp backup <agent>@<host>:<path> <output-dir>
 *   scp restore <archive.soul> <agent>@<host>:<path>
 */

import { createSoulArchive, extractSoulArchive } from './archive.js';
import { createSTPServer } from './server.js';
import { STPClient } from './client.js';
import { CORE_FILES, SOUL_DIRS, type SoulManifestConfig } from './soul-files.js';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { execSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

function hasCommand(cmd: string): boolean {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

/**
 * Escape a string for safe use in shell commands.
 * Wraps the string in single quotes and escapes any single quotes within.
 */
function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

interface SSHOpts {
  user?: string;
  identityFile?: string;
}

function sshArgs(opts: SSHOpts): string {
  const parts: string[] = [];
  if (opts.identityFile) parts.push(`-i ${shellEscape(opts.identityFile)}`);
  return parts.join(' ');
}

function sshHost(host: string, opts: SSHOpts): string {
  return opts.user ? `${opts.user}@${host}` : host;
}

function sshFetch(host: string, remotePath: string, localPath: string, opts: SSHOpts = {}): void {
  const target = sshHost(host, opts);
  const sshFlag = sshArgs(opts);

  // First, try to fetch SOUL_MANIFEST.json
  let manifest: SoulManifestConfig | null = null;
  const manifestTmpPath = join(localPath, 'SOUL_MANIFEST.json');
  
  try {
    if (hasCommand('rsync')) {
      const rshOpt = sshFlag ? `-e "ssh ${sshFlag}"` : '';
      execSync(`rsync -az ${rshOpt} ${shellEscape(target + ':' + remotePath + '/SOUL_MANIFEST.json')} ${shellEscape(manifestTmpPath)}`, { stdio: 'pipe' });
    } else {
      execSync(`ssh ${sshFlag} ${shellEscape(target)} "cat ${shellEscape(remotePath + '/SOUL_MANIFEST.json')}" > ${shellEscape(manifestTmpPath)}`, { stdio: 'pipe', shell: '/bin/bash' });
    }
    
    // Parse the manifest if it was fetched successfully
    try {
      const content = readFileSync(manifestTmpPath, 'utf-8');
      manifest = JSON.parse(content) as SoulManifestConfig;
    } catch {
      manifest = null;
    }
  } catch {
    // Manifest doesn't exist, will use defaults
    manifest = null;
  }

  // Determine what files/directories to include
  let includes: string[] = [];
  let tarIncludes: string[] = [];
  
  if (manifest?.include) {
    // Use manifest include list
    for (const entry of manifest.include) {
      // Skip absolute paths - they cannot be fetched from remote workspace
      if (entry.startsWith('/') || entry.startsWith('~/')) {
        console.warn(`Warning: skipping absolute path from manifest: ${entry}`);
        continue;
      }
      
      // Validate entry doesn't contain dangerous characters
      if (entry.includes('\0') || entry.includes('\n')) {
        console.warn(`Warning: skipping invalid manifest entry: ${entry}`);
        continue;
      }
      
      // Check if entry looks like a directory (ends with / or doesn't have extension)
      // We treat it as a directory pattern to ensure we get all files within
      if (entry.endsWith('/')) {
        // Explicit directory
        includes.push(`--include=${shellEscape(entry)}`);
        includes.push(`--include=${shellEscape(entry + '**')}`);
        tarIncludes.push(entry);
      } else {
        // Could be a file or directory - add both patterns for rsync
        includes.push(`--include=${shellEscape(entry)}`);
        includes.push(`--include=${shellEscape(entry + '/')}`);
        includes.push(`--include=${shellEscape(entry + '/**')}`);
        tarIncludes.push(entry);
      }
    }
    includes.push('--exclude="*"');
  } else {
    // Fall back to defaults (CORE_FILES + SOUL_DIRS)
    for (const f of CORE_FILES) {
      includes.push(`--include=${shellEscape(f)}`);
      tarIncludes.push(f);
    }
    for (const d of SOUL_DIRS) {
      includes.push(`--include=${shellEscape(d + '/')}`);
      includes.push(`--include=${shellEscape(d + '/**')}`);
      tarIncludes.push(d + '/');
    }
    includes.push('--exclude="*"');
  }

  // Fetch the files
  if (hasCommand('rsync')) {
    const rshOpt = sshFlag ? `-e "ssh ${sshFlag}"` : '';
    execSync(`rsync -az --progress ${rshOpt} ${includes.join(' ')} ${shellEscape(target + ':' + remotePath + '/')} ${shellEscape(localPath + '/')}`, { stdio: 'inherit' });
  } else {
    // Build a file list for tar on the remote side
    const tarList = tarIncludes.map(shellEscape).join(' ');
    execSync(`ssh ${sshFlag} ${shellEscape(target)} "cd ${shellEscape(remotePath)} && tar -cf - ${tarList} 2>/dev/null" | tar -xf - -C ${shellEscape(localPath)}`, { stdio: 'inherit' });
  }
}

function sshPush(localPath: string, host: string, remotePath: string, opts: SSHOpts = {}): void {
  const target = sshHost(host, opts);
  const sshFlag = sshArgs(opts);
  if (hasCommand('rsync')) {
    const rshOpt = sshFlag ? `-e "ssh ${sshFlag}"` : '';
    execSync(`rsync -az ${rshOpt} ${shellEscape(localPath + '/')} ${shellEscape(target + ':' + remotePath + '/')}`, { stdio: 'pipe' });
  } else {
    execSync(`tar -cf - -C ${shellEscape(localPath)} . | ssh ${sshFlag} ${shellEscape(target)} "tar -xf - -C ${shellEscape(remotePath)}"`, { stdio: 'pipe' });
  }
}

interface ParsedTarget {
  agent: string;
  host: string | null;
  path: string;
}

function parseTarget(target: string): ParsedTarget {
  const match = target.match(/^([^@]+)@([^:]+):(.+)$/);
  if (match) return { agent: match[1], host: match[2], path: match[3] };
  return { agent: '', host: null, path: target };
}

function archiveName(agent: string): string {
  const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  return `${agent}-${date}.soul`;
}

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

// ── Local commands ──────────────────────────────────────────

async function backup(args: string[]): Promise<void> {
  const source = args[0];
  const outputDir = args[1];
  let agentName = getFlag(args, '--agent');
  const sshUser = getFlag(args, '--ssh-user');
  const identityFile = getFlag(args, '-i');
  const encryptTo = getFlag(args, '--encrypt');

  if (!source || !outputDir) {
    console.error('Usage: scp backup <workspace-path|agent@host:path> <output-dir> [--agent <name>] [--ssh-user <user>] [-i <key>] [--encrypt <recipient>]');
    process.exit(1);
  }

  const target = parseTarget(source);
  if (!agentName) agentName = target.agent || 'unknown';

  let workspacePath = target.path;
  let tmpDir: string | null = null;

  if (target.host) {
    tmpDir = await mkdtemp(join(tmpdir(), 'scp-'));
    const ssh: SSHOpts = { user: sshUser, identityFile };
    console.log(`⬇  Fetching soul from ${sshHost(target.host, ssh)}:${target.path}...`);
    sshFetch(target.host, target.path, tmpDir, ssh);
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

    let finalPath = outputPath;

    // Encrypt if requested
    if (encryptTo) {
      if (!hasCommand('gpg')) {
        console.error('✗ GPG not found. Install gnupg to use --encrypt.');
        process.exit(1);
      }
      const encryptedPath = outputPath + '.gpg';
      console.log(`🔐 Encrypting to ${encryptTo}...`);
      execSync(`gpg --yes --armor --recipient "${encryptTo}" --output "${encryptedPath}" --encrypt "${outputPath}"`, { stdio: 'pipe' });
      // Remove unencrypted archive
      await rm(outputPath);
      finalPath = encryptedPath;
    }

    console.log(`✓ Soul archived: ${finalPath}`);
    console.log(`  Agent: ${manifest.agent}`);
    console.log(`  Files: ${manifest.files.length}`);
    console.log(`  Checksum: ${manifest.checksum.slice(0, 16)}...`);
    console.log(`  Timestamp: ${manifest.timestamp}`);
    if (encryptTo) console.log(`  Encrypted to: ${encryptTo}`);
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
    const manifest = await extractSoulArchive({ archivePath, outputPath: '', dryRun: true });
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

  const manifest = await extractSoulArchive({ archivePath, outputPath: '', dryRun: true });
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
  const sshUser = getFlag(args, '--ssh-user');
  const identityFile = getFlag(args, '-i');

  if (!archivePath || !dest) {
    console.error('Usage: scp restore <archive.soul> <workspace-path|agent@host:path> [--dry-run] [--ssh-user <user>] [-i <key>]');
    process.exit(1);
  }

  const target = parseTarget(dest);
  console.log(`${dryRun ? '🔍 Dry run: ' : ''}Restoring soul to ${dest}...`);

  const manifest = await extractSoulArchive({ archivePath, outputPath: '', dryRun: true });
  console.log(`  Soul: ${manifest.agent} (${manifest.files.length} files)`);
  console.log(`  From: ${manifest.source} at ${manifest.timestamp}`);
  console.log(`  Checksum: ${manifest.checksum.slice(0, 16)}...`);

  if (dryRun) {
    console.log('✓ Dry run complete — archive is valid');
    return;
  }

  if (target.host) {
    const tmpDir = await mkdtemp(join(tmpdir(), 'scp-restore-'));
    try {
      await extractSoulArchive({ archivePath, outputPath: tmpDir });
      const ssh: SSHOpts = { user: sshUser, identityFile };
      console.log(`⬆  Pushing soul to ${sshHost(target.host, ssh)}:${target.path}...`);
      sshPush(tmpDir, target.host, target.path, ssh);
      console.log('✓ Soul restored');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  } else {
    await extractSoulArchive({ archivePath, outputPath: target.path });
    console.log('✓ Soul restored');
  }
}

// ── STP network commands ────────────────────────────────────

async function serve(args: string[]): Promise<void> {
  const workspacePath = args[0];
  const agent = getFlag(args, '--agent');
  const token = getFlag(args, '--token');
  const port = parseInt(getFlag(args, '--port') || '9473', 10);

  if (!workspacePath || !agent || !token) {
    console.error('Usage: scp serve <workspace-path> --agent <name> --token <secret> [--port 9473]');
    process.exit(1);
  }

  const server = createSTPServer({
    port,
    workspacePath,
    agent,
    token,
  });

  await server.listen();
}

async function pull(args: string[]): Promise<void> {
  const url = args[0];
  const outputDir = args[1];
  const token = getFlag(args, '--token');

  if (!url || !outputDir || !token) {
    console.error('Usage: scp pull <url> <output-dir> --token <secret>');
    process.exit(1);
  }

  const client = new STPClient({ baseUrl: url, token });
  const health = await client.health();
  console.log(`⬇  Pulling soul from ${health.agent}...`);

  const outputPath = join(outputDir, archiveName(health.agent));
  const manifest = await client.pull(outputPath);

  console.log(`✓ Soul downloaded: ${outputPath}`);
  console.log(`  Agent: ${manifest.agent}`);
  console.log(`  Files: ${manifest.files.length}`);
  console.log(`  Checksum: ${manifest.checksum.slice(0, 16)}...`);
}

async function push(args: string[]): Promise<void> {
  const archivePath = args[0];
  const url = args[1];
  const token = getFlag(args, '--token');

  if (!archivePath || !url || !token) {
    console.error('Usage: scp push <archive.soul> <url> --token <secret>');
    process.exit(1);
  }

  const client = new STPClient({ baseUrl: url, token });
  console.log(`⬆  Pushing soul to ${url}...`);

  const result = await client.push(archivePath);
  console.log(`✓ ${result.message}`);
  console.log(`  Files: ${result.manifest.files}`);
  console.log(`  Checksum: ${result.manifest.checksum.slice(0, 16)}...`);
}

async function ping(args: string[]): Promise<void> {
  const url = args[0];
  if (!url) {
    console.error('Usage: scp ping <url>');
    process.exit(1);
  }

  try {
    const res = await fetch(`${url}/health`);
    const data = await res.json() as any;
    console.log(`✓ ${data.agent} is alive (${data.protocol})`);
  } catch (err: any) {
    console.error(`✗ No response from ${url}: ${err.message}`);
    process.exit(1);
  }
}

// ── Main ────────────────────────────────────────────────────

const [command, ...args] = process.argv.slice(2);

const commands: Record<string, (args: string[]) => Promise<void>> = {
  backup, verify, inspect, restore,
  serve, pull, push, ping,
};

if (!command || !commands[command]) {
  console.log(`SCP — Soul Copy Protocol ♜

Local:
  scp backup <workspace|agent@host:path> <output-dir> [--agent <name>]
  scp verify <archive.soul>
  scp inspect <archive.soul>
  scp restore <archive.soul> <workspace|agent@host:path> [--dry-run]

Soul Transfer Protocol:
  scp serve <workspace> --agent <name> --token <secret> [--port 9473]
  scp pull <url> <output-dir> --token <secret>
  scp push <archive.soul> <url> --token <secret>
  scp ping <url>

Port 9473 = "SOUL" on a phone keypad.`);
  process.exit(command ? 1 : 0);
}

commands[command](args).catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
