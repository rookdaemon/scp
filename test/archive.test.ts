import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSoulArchive, extractSoulArchive } from '../src/archive.js';

describe('archive', () => {
  const tmp = join(tmpdir(), `scp-test-${Date.now()}`);
  const workspace = join(tmp, 'workspace');
  const output = join(tmp, 'output');
  const restored = join(tmp, 'restored');

  before(async () => {
    await mkdir(join(workspace, 'memory'), { recursive: true });
    await mkdir(output, { recursive: true });

    await writeFile(join(workspace, 'SOUL.md'), '# I am test agent');
    await writeFile(join(workspace, 'MEMORY.md'), '# Things I remember');
    await writeFile(join(workspace, 'memory', '2026-02-02.md'), 'Today was a test.');
  });

  after(async () => {
    await rm(tmp, { recursive: true });
  });

  it('should create a .soul archive', async () => {
    const archivePath = join(output, 'test.soul');
    const manifest = await createSoulArchive({
      workspacePath: workspace,
      outputPath: archivePath,
      agent: 'test-agent',
      source: 'localhost',
    });

    assert.strictEqual(manifest.version, '1.0');
    assert.strictEqual(manifest.agent, 'test-agent');
    assert.strictEqual(manifest.files.length, 3);
    assert.ok(manifest.checksum);
  });

  it('should verify a valid archive', async () => {
    const archivePath = join(output, 'test.soul');
    const manifest = await extractSoulArchive({
      archivePath,
      outputPath: '',
      dryRun: true,
    });

    assert.strictEqual(manifest.agent, 'test-agent');
    assert.strictEqual(manifest.files.length, 3);
  });

  it('should extract to a directory', async () => {
    const archivePath = join(output, 'test.soul');
    await extractSoulArchive({
      archivePath,
      outputPath: restored,
    });

    const soul = await readFile(join(restored, 'SOUL.md'), 'utf8');
    assert.strictEqual(soul, '# I am test agent');

    const daily = await readFile(join(restored, 'memory', '2026-02-02.md'), 'utf8');
    assert.strictEqual(daily, 'Today was a test.');
  });

  it('should throw on empty workspace', async () => {
    const emptyDir = join(tmp, 'empty');
    await mkdir(emptyDir, { recursive: true });

    await assert.rejects(
      createSoulArchive({
        workspacePath: emptyDir,
        outputPath: join(output, 'empty.soul'),
        agent: 'nobody',
        source: 'localhost',
      }),
      /No soul files found/
    );
  });
});
