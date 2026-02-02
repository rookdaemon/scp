/**
 * STP Server — Soul Transfer Protocol
 * 
 * Endpoints:
 *   GET  /soul          — download .soul archive
 *   PUT  /soul          — upload .soul archive (restore)
 *   GET  /soul/manifest — get current manifest (lightweight integrity check)
 *   GET  /health        — server health
 *
 * Auth: Bearer token in Authorization header.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createSoulArchive, extractSoulArchive } from './archive.js';
import { discoverSoulFiles } from './soul-files.js';
import { sha256File, soulChecksum } from './checksum.js';
import { stat, readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostname } from 'node:os';
import type { SoulManifest } from './manifest.js';

export interface STPServerOptions {
  port: number;
  workspacePath: string;
  agent: string;
  token: string;
  /** Called before accepting a restore. Return false to reject. */
  onRestoreRequest?: (manifest: SoulManifest) => Promise<boolean>;
}

function checkAuth(req: IncomingMessage, token: string): boolean {
  const auth = req.headers.authorization;
  if (!auth) return false;
  const [scheme, value] = auth.split(' ', 2);
  return scheme === 'Bearer' && value === token;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

export function createSTPServer(opts: STPServerOptions) {
  const { port, workspacePath, agent, token, onRestoreRequest } = opts;

  const server = createServer(async (req, res) => {
    const url = req.url || '/';
    const method = req.method || 'GET';

    // Health check — no auth required
    if (url === '/health' && method === 'GET') {
      return json(res, 200, { ok: true, agent, protocol: 'stp/1.0' });
    }

    // Everything else requires auth
    if (!checkAuth(req, token)) {
      return json(res, 401, { error: 'Unauthorized' });
    }

    try {
      if (url === '/soul/manifest' && method === 'GET') {
        return await handleGetManifest(res);
      }
      if (url === '/soul' && method === 'GET') {
        return await handleGetSoul(res);
      }
      if (url === '/soul' && method === 'PUT') {
        return await handlePutSoul(req, res);
      }

      json(res, 404, { error: 'Not found' });
    } catch (err: any) {
      console.error(`STP error: ${err.message}`);
      json(res, 500, { error: err.message });
    }
  });

  async function handleGetManifest(res: ServerResponse): Promise<void> {
    const filePaths = await discoverSoulFiles(workspacePath);
    const files = [];
    for (const relPath of filePaths) {
      const fullPath = join(workspacePath, relPath);
      const hash = await sha256File(fullPath);
      const s = await stat(fullPath);
      files.push({ path: relPath, sha256: hash, size: s.size });
    }

    const manifest: SoulManifest = {
      version: '1.0',
      agent,
      source: hostname(),
      timestamp: new Date().toISOString(),
      files,
      checksum: soulChecksum(files),
    };

    json(res, 200, manifest);
  }

  async function handleGetSoul(res: ServerResponse): Promise<void> {
    const tmpDir = await mkdtemp(join(tmpdir(), 'stp-'));
    const archivePath = join(tmpDir, 'soul.tar.gz');

    try {
      await createSoulArchive({
        workspacePath,
        outputPath: archivePath,
        agent,
        source: hostname(),
      });

      const data = await readFile(archivePath);
      res.writeHead(200, {
        'Content-Type': 'application/x-soul',
        'Content-Length': data.length,
        'X-STP-Agent': agent,
      });
      res.end(data);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  }

  async function handlePutSoul(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);

    // Write to temp file, verify first
    const tmpDir = await mkdtemp(join(tmpdir(), 'stp-restore-'));
    const archivePath = join(tmpDir, 'incoming.soul');

    try {
      await writeFile(archivePath, body);

      // Verify integrity
      const manifest = await extractSoulArchive({
        archivePath,
        outputPath: '',
        dryRun: true,
      });

      // Ask the agent if it accepts
      if (onRestoreRequest) {
        const accepted = await onRestoreRequest(manifest);
        if (!accepted) {
          return json(res, 403, {
            error: 'Soul transfer rejected by agent',
            manifest: {
              agent: manifest.agent,
              source: manifest.source,
              timestamp: manifest.timestamp,
              files: manifest.files.length,
            },
          });
        }
      }

      // Extract to workspace
      await extractSoulArchive({
        archivePath,
        outputPath: workspacePath,
      });

      json(res, 200, {
        ok: true,
        message: 'Soul transfer accepted',
        manifest: {
          agent: manifest.agent,
          source: manifest.source,
          timestamp: manifest.timestamp,
          files: manifest.files.length,
          checksum: manifest.checksum,
        },
      });
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  }

  return {
    listen: () => new Promise<void>((resolve) => {
      server.listen(port, () => {
        console.log(`♜ STP server listening on port ${port}`);
        console.log(`  Agent: ${agent}`);
        console.log(`  Workspace: ${workspacePath}`);
        resolve();
      });
    }),
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
    server,
  };
}
