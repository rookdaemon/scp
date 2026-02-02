/**
 * STP Client — Soul Transfer Protocol
 *
 * Connects to a remote STP server to pull/push souls.
 */

import { writeFile, readFile } from 'node:fs/promises';
import type { SoulManifest } from './manifest.js';

export interface STPClientOptions {
  baseUrl: string;
  token: string;
}

export class STPClient {
  private baseUrl: string;
  private token: string;

  constructor(opts: STPClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.token = opts.token;
  }

  private async request(path: string, opts?: RequestInit): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...opts?.headers,
      },
    });
    return res;
  }

  /** Check if the remote agent is alive */
  async health(): Promise<{ ok: boolean; agent: string; protocol: string }> {
    const res = await fetch(`${this.baseUrl}/health`);
    return res.json() as any;
  }

  /** Get the remote soul manifest (lightweight check) */
  async manifest(): Promise<SoulManifest> {
    const res = await this.request('/soul/manifest');
    if (!res.ok) throw new Error(`Manifest request failed: ${res.status}`);
    return res.json() as any;
  }

  /** Download the soul archive to a local file */
  async pull(outputPath: string): Promise<SoulManifest> {
    const res = await this.request('/soul');
    if (!res.ok) throw new Error(`Pull failed: ${res.status}`);

    const data = Buffer.from(await res.arrayBuffer());
    await writeFile(outputPath, data);

    // Verify by extracting manifest
    const { extractSoulArchive } = await import('./archive.js');
    return extractSoulArchive({ archivePath: outputPath, outputPath: '', dryRun: true });
  }

  /** Push a soul archive to the remote agent */
  async push(archivePath: string): Promise<{ ok: boolean; message: string; manifest: any }> {
    const data = await readFile(archivePath);
    const res = await this.request('/soul', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-soul' },
      body: data,
    });

    const result = await res.json() as any;
    if (!res.ok) throw new Error(result.error || `Push failed: ${res.status}`);
    return result;
  }
}
