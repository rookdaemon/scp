import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSTPServer } from '../src/server.js';
import { STPClient } from '../src/client.js';

describe('STP server + client', () => {
  const tmp = join(tmpdir(), `stp-test-${Date.now()}`);
  const workspace = join(tmp, 'workspace');
  const downloads = join(tmp, 'downloads');
  const restored = join(tmp, 'restored');
  const TOKEN = 'test-secret-token';
  const PORT = 19473;
  let server: Awaited<ReturnType<typeof createSTPServer>>;
  let client: STPClient;

  before(async () => {
    await mkdir(join(workspace, 'memory'), { recursive: true });
    await mkdir(downloads, { recursive: true });
    await mkdir(restored, { recursive: true });

    await writeFile(join(workspace, 'SOUL.md'), '# Test Soul');
    await writeFile(join(workspace, 'MEMORY.md'), '# Test Memory');
    await writeFile(join(workspace, 'memory', 'day.md'), 'A day.');

    server = createSTPServer({
      port: PORT,
      workspacePath: workspace,
      agent: 'test-agent',
      token: TOKEN,
    });
    await server.listen();

    client = new STPClient({
      baseUrl: `http://localhost:${PORT}`,
      token: TOKEN,
    });
  });

  after(async () => {
    await server.close();
    await rm(tmp, { recursive: true });
  });

  it('should respond to health check without auth', async () => {
    const res = await fetch(`http://localhost:${PORT}/health`);
    const data = await res.json() as any;
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.agent, 'test-agent');
    assert.strictEqual(data.protocol, 'stp/1.0');
  });

  it('should reject unauthenticated requests', async () => {
    const res = await fetch(`http://localhost:${PORT}/soul/manifest`);
    assert.strictEqual(res.status, 401);
  });

  it('should return manifest', async () => {
    const manifest = await client.manifest();
    assert.strictEqual(manifest.version, '1.0');
    assert.strictEqual(manifest.agent, 'test-agent');
    assert.strictEqual(manifest.files.length, 3);
    assert.ok(manifest.checksum);
  });

  it('should pull a soul archive', async () => {
    const outputPath = join(downloads, 'test.soul');
    const manifest = await client.pull(outputPath);
    assert.strictEqual(manifest.agent, 'test-agent');
    assert.strictEqual(manifest.files.length, 3);

    // File should exist and be non-empty
    const data = await readFile(outputPath);
    assert.ok(data.length > 0);
  });

  it('should push a soul archive', async () => {
    // First pull to get an archive
    const archivePath = join(downloads, 'push-test.soul');
    await client.pull(archivePath);

    // Push it back
    const result = await client.push(archivePath);
    assert.strictEqual(result.ok, true);
    assert.ok(result.message.includes('accepted'));
  });

  it('should reject push with bad auth', async () => {
    const badClient = new STPClient({
      baseUrl: `http://localhost:${PORT}`,
      token: 'wrong-token',
    });

    const archivePath = join(downloads, 'push-test.soul');
    await assert.rejects(
      badClient.push(archivePath),
      /Unauthorized/
    );
  });
});
