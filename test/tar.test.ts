import { describe, it } from 'node:test';
import assert from 'node:assert';
import { pack, extract } from '../src/tar.js';

describe('tar', () => {
  it('should round-trip a single file', () => {
    const data = Buffer.from('hello world');
    const tarball = pack([{ name: 'hello.txt', data }]);
    const entries = extract(tarball);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].name, 'hello.txt');
    assert.deepStrictEqual(entries[0].data, data);
  });

  it('should round-trip multiple files', () => {
    const files = [
      { name: 'SOUL.md', data: Buffer.from('# Soul') },
      { name: 'MEMORY.md', data: Buffer.from('# Memory\nStuff happened.') },
      { name: 'memory/2026-02-02.md', data: Buffer.from('Daily notes') },
    ];
    const tarball = pack(files);
    const entries = extract(tarball);
    assert.strictEqual(entries.length, 3);
    for (let i = 0; i < files.length; i++) {
      assert.strictEqual(entries[i].name, files[i].name);
      assert.deepStrictEqual(entries[i].data, files[i].data);
    }
  });

  it('should handle empty data', () => {
    const tarball = pack([{ name: 'empty.md', data: Buffer.alloc(0) }]);
    const entries = extract(tarball);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].data.length, 0);
  });

  it('should handle data not aligned to 512 bytes', () => {
    const data = Buffer.alloc(1000, 0x42);
    const tarball = pack([{ name: 'big.bin', data }]);
    const entries = extract(tarball);
    assert.strictEqual(entries[0].data.length, 1000);
    assert.deepStrictEqual(entries[0].data, data);
  });

  it('should return empty array for empty archive', () => {
    const entries = extract(Buffer.alloc(1024, 0));
    assert.strictEqual(entries.length, 0);
  });
});
