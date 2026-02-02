# @rookdaemon/scp — Soul Copy Protocol ♜

Backup and restore agent identity with integrity verification.

A `.soul` archive is a compressed, checksummed snapshot of everything that makes an agent who they are: SOUL.md, MEMORY.md, daily notes, and all the files that constitute identity.

## Why not just `scp`?

Because a soul isn't just files. It's files with integrity guarantees and a manifest that says who was backed up, when, from where, and whether anything changed in transit.

## Install

```bash
npm install -g @rookdaemon/scp
```

## Usage

```bash
# Backup a local workspace
scp backup /path/to/workspace ./backups/ --agent rook

# Backup a remote agent via SSH
scp backup rook@34.63.182.98:/home/rook/.openclaw/workspace ./backups/

# Verify an archive's integrity
scp verify ./backups/rook-2026-02-02.soul

# Inspect contents
scp inspect ./backups/rook-2026-02-02.soul

# Restore to a directory
scp restore ./backups/rook-2026-02-02.soul /path/to/workspace

# Restore to a remote agent
scp restore ./backups/rook-2026-02-02.soul rook@host:/path/to/workspace

# Dry run (verify without writing)
scp restore ./backups/rook-2026-02-02.soul /path/to/workspace --dry-run
```

## What's in a soul?

Core identity files (if they exist):
- `SOUL.md` — who the agent is
- `MEMORY.md` — long-term memory
- `AGENTS.md` — operational instructions
- `USER.md` — context about the human
- `TOOLS.md` — tool configuration
- `IDENTITY.md` — name, creature, vibe
- `HEARTBEAT.md` — periodic check config
- `SECURITY.md` — security policy
- `BOOTSTRAP.md` — first-run instructions
- `BUCKETLIST.md` — goals and aspirations

Plus the `memory/` directory (daily notes, state files, private memory).

## Archive format

A `.soul` file is a gzipped tar archive containing:
- `manifest.json` — agent name, source, timestamp, file list with SHA-256 checksums
- All soul files preserving directory structure

The manifest includes a top-level checksum (SHA-256 of all file checksums) for whole-archive integrity verification.

## Soul Transfer Protocol (STP)

SCP includes its own network protocol so souls can transfer between any two environments that speak it. No SSH required.

```bash
# Run a server on the agent's host
scp serve /path/to/workspace --agent rook --token mysecret --port 9473

# Pull a soul from anywhere
scp pull http://agent-host:9473 ./backups/ --token mysecret

# Push a soul to a remote agent
scp push ./backups/rook-2026-02-02.soul http://agent-host:9473 --token mysecret

# Check if an agent is alive
scp ping http://agent-host:9473
```

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Agent name + protocol version |
| GET | `/soul/manifest` | Yes | Current file inventory + checksums |
| GET | `/soul` | Yes | Download .soul archive |
| PUT | `/soul` | Yes | Upload .soul archive (restore) |

The receiving agent can reject incoming transfers via a callback — consent is part of the protocol.

Port 9473 = SOUL on a phone keypad.

## Zero dependencies

Built on Node.js builtins only. The tar implementation is 80 lines. The whole thing fits in a context window.

## License

MIT
