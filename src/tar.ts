/**
 * Minimal tar pack/extract — no dependencies.
 * Supports regular files only (sufficient for soul archives).
 * POSIX ustar format.
 */

const BLOCK = 512;

function padOctal(n: number, len: number): string {
  return n.toString(8).padStart(len - 1, '0') + '\0';
}

function headerChecksum(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    // Treat checksum field (148-155) as spaces
    sum += (i >= 148 && i < 156) ? 32 : header[i];
  }
  return sum;
}

/**
 * Pack entries into a tar buffer (no compression).
 */
export function pack(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const header = Buffer.alloc(BLOCK, 0);

    // name (0, 100)
    header.write(entry.name.slice(0, 100), 0, 100, 'utf8');
    // mode (100, 8)
    header.write(padOctal(0o644, 8), 100, 8, 'utf8');
    // uid (108, 8)
    header.write(padOctal(0, 8), 108, 8, 'utf8');
    // gid (116, 8)
    header.write(padOctal(0, 8), 116, 8, 'utf8');
    // size (124, 12)
    header.write(padOctal(entry.data.length, 12), 124, 12, 'utf8');
    // mtime (136, 12)
    header.write(padOctal(Math.floor(Date.now() / 1000), 12), 136, 12, 'utf8');
    // typeflag (156, 1) — '0' = regular file
    header.write('0', 156, 1, 'utf8');
    // magic (257, 6)
    header.write('ustar\0', 257, 6, 'utf8');
    // version (263, 2)
    header.write('00', 263, 2, 'utf8');

    // Compute checksum
    const cksum = headerChecksum(header);
    header.write(padOctal(cksum, 7), 148, 7, 'utf8');
    header[155] = 0x20; // trailing space

    blocks.push(header);

    // File data + padding to block boundary
    blocks.push(entry.data);
    const remainder = entry.data.length % BLOCK;
    if (remainder > 0) {
      blocks.push(Buffer.alloc(BLOCK - remainder, 0));
    }
  }

  // Two zero blocks = end of archive
  blocks.push(Buffer.alloc(BLOCK * 2, 0));

  return Buffer.concat(blocks);
}

/**
 * Extract entries from a tar buffer (no decompression).
 */
export function extract(tar: Buffer): Array<{ name: string; data: Buffer }> {
  const entries: Array<{ name: string; data: Buffer }> = [];
  let offset = 0;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);

    // Check for zero block (end of archive)
    if (header.every(b => b === 0)) break;

    const name = header.subarray(0, 100).toString('utf8').replace(/\0+$/, '');
    const sizeStr = header.subarray(124, 136).toString('utf8').replace(/\0+$/, '').trim();
    const size = parseInt(sizeStr, 8);

    if (isNaN(size)) break;

    offset += BLOCK;
    const data = Buffer.from(tar.subarray(offset, offset + size));
    entries.push({ name, data });

    // Skip past data + padding
    offset += size;
    const remainder = size % BLOCK;
    if (remainder > 0) offset += BLOCK - remainder;
  }

  return entries;
}
