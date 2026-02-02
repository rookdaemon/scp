import { describe, it } from 'node:test';
import assert from 'node:assert';
import { sha256, soulChecksum } from '../src/checksum.js';

describe('checksum', () => {
  it('should compute sha256 of a string', () => {
    const hash = sha256('hello');
    assert.strictEqual(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('should compute sha256 of a buffer', () => {
    const hash = sha256(Buffer.from('hello'));
    assert.strictEqual(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('should compute deterministic soul checksum', () => {
    const files = [
      { path: 'b.md', sha256: 'bbb' },
      { path: 'a.md', sha256: 'aaa' },
    ];
    const c1 = soulChecksum(files);
    const c2 = soulChecksum([...files].reverse());
    assert.strictEqual(c1, c2); // order-independent
  });

  it('should produce different checksums for different content', () => {
    const c1 = soulChecksum([{ path: 'a.md', sha256: 'aaa' }]);
    const c2 = soulChecksum([{ path: 'a.md', sha256: 'bbb' }]);
    assert.notStrictEqual(c1, c2);
  });
});
