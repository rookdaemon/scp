# Copilot Instructions for SCP (Soul Copy Protocol)

## Project Overview

**SCP** (`@rookdaemon/scp`) is the **Soul Copy Protocol** — a backup and restore tool for agent identity with integrity verification.

- **Version**: 0.1.7
- **Language**: TypeScript (ES2022 target)
- **Runtime**: Node.js (ES modules, `"type": "module"`)
- **Dependencies**: Zero external runtime dependencies (uses Node.js built-ins only)
- **License**: MIT

## Purpose

SCP provides:
- **Local Operations**: Backup, restore, verify, and inspect agent identity archives (`.soul` files)
- **Network Protocol**: Soul Transfer Protocol (STP) for remote backup/restore via HTTP
- **Integrity**: SHA-256 checksums for all files and archive validation
- **Format**: Gzipped tar archives with JSON manifest

## Build, Test, and Lint Commands

### Build
```bash
npm run build
```
- Compiles TypeScript from `src/` and `test/` to `dist/`
- Uses `tsc` with Node16 module resolution
- Generates type declarations (`.d.ts` files)

### Test
```bash
npm test
```
- Runs Node.js native test runner (`node --test`)
- Tests are in `test/*.test.ts`, compiled to `dist/test/*.test.js`
- No external test frameworks (uses built-in `node:test`)

### Lint
**Note**: No linter is currently configured. TypeScript's strict mode provides type checking.
- `strict: true` in `tsconfig.json` enforces strict type checking

### Install Dependencies
```bash
npm install
```

### Run CLI (after build)
```bash
node dist/src/cli.js <command>
# Or if installed globally/linked:
scp <command>
```

## Repository Structure

```
scp/
├── src/                    # Main source code (TypeScript)
│   ├── cli.ts             # CLI entry point (backup, restore, verify, etc.)
│   ├── archive.ts         # Soul archive creation/extraction
│   ├── tar.ts             # Custom tar implementation (no dependencies)
│   ├── manifest.ts        # SoulManifest type definitions
│   ├── checksum.ts        # SHA-256 hashing utilities
│   ├── soul-files.ts      # Core identity file definitions
│   ├── server.ts          # Soul Transfer Protocol (STP) HTTP server
│   └── client.ts          # STP client (pull/push operations)
├── test/                   # Unit tests
│   ├── archive.test.ts    # Archive operations tests
│   ├── checksum.test.ts   # Checksum validation tests
│   ├── server.test.ts     # HTTP server tests
│   └── tar.test.ts        # Tar packing/extraction tests
├── dist/                   # Compiled JavaScript output (generated, not in git)
├── .github/
│   └── workflows/
│       ├── ci.yml         # CI: build and test on push
│       └── publish.yml    # NPM package publication
├── package.json           # Package config and scripts
├── tsconfig.json          # TypeScript configuration
├── README.md              # User documentation
└── FUTURE.md              # Roadmap and security considerations
```

## Key Architectural Notes

### 1. Zero Dependencies Philosophy
- **No external runtime dependencies** — uses only Node.js built-ins (`fs`, `path`, `crypto`, `zlib`, `http`)
- Custom tar implementation (80 lines) to avoid dependencies
- Designed to fit in a single context window (~1000 LOC)

### 2. Core Modules

#### `soul-files.ts`
Defines the agent identity files that SCP backs up:
- **Mandatory**: `SOUL.md`, `MEMORY.md`
- **Optional**: `AGENTS.md`, `USER.md`, `TOOLS.md`, `IDENTITY.md`, `HEARTBEAT.md`, `SECURITY.md`, `BOOTSTRAP.md`, `BUCKETLIST.md`
- **Directories**: `memory/` (daily notes, state files)

#### `archive.ts`
- Creates `.soul` archives (gzipped tar format)
- Includes a `manifest.json` with file checksums and metadata
- Supports backup and restore operations

#### `checksum.ts`
- SHA-256 hashing for file integrity
- Validates archives during verification

#### `tar.ts`
- Minimal tar implementation (USTAR format)
- Packing and extraction without external dependencies

#### `cli.ts`
Commands:
- `backup` — Create `.soul` archive from workspace
- `restore` — Extract `.soul` archive to workspace
- `verify` — Validate archive integrity
- `inspect` — List archive contents
- `serve` — Start STP HTTP server
- `pull` — Download soul from remote STP server
- `push` — Upload soul to remote STP server
- `ping` — Health check for STP server

#### `server.ts` & `client.ts`
Soul Transfer Protocol (STP) — HTTP-based protocol:
- **Server endpoints**:
  - `GET /health` — Agent name + protocol version
  - `GET /soul/manifest` — File inventory with checksums
  - `GET /soul` — Download `.soul` archive
  - `PUT /soul` — Upload and restore archive
- **Client operations**: `pull`, `push` via HTTP

### 3. TypeScript Configuration
- **Target**: ES2022
- **Module**: Node16 (ES modules)
- **Strict mode**: Enabled
- **Output**: `dist/` directory

### 4. Soul Archive Format
`.soul` files are gzipped tar archives containing:
1. Identity files (e.g., `SOUL.md`, `MEMORY.md`, `memory/`)
2. `manifest.json` — JSON file with:
   - Agent name
   - Creation timestamp
   - Protocol version
   - File list with SHA-256 checksums

### 5. Testing Strategy
- Uses Node.js native test runner (v18+)
- Tests are compiled TypeScript (`test/*.test.ts` → `dist/test/*.test.js`)
- Covers archive operations, checksums, tar, and server functionality

### 6. Security Considerations
See `FUTURE.md` for planned enhancements:
- Archive signing/verification
- Key revocation
- Secret handling
- Runtime-agnostic format specification

## Code Style and Conventions

- **ES Modules**: All files use `import`/`export` (not `require`)
- **File extensions**: Always include `.js` in imports (Node16 module resolution)
  ```typescript
  import { backup } from './archive.js';  // ✓ Correct
  import { backup } from './archive';     // ✗ Incorrect
  ```
- **Async/await**: Prefer async/await over callbacks
- **Error handling**: Use try/catch with descriptive error messages
- **Types**: Leverage TypeScript's strict mode, avoid `any`
- **Node.js APIs**: Use built-in modules (no external dependencies)

## Common Development Tasks

### Add a New CLI Command
1. Add command handler in `src/cli.ts`
2. Implement logic in appropriate module (e.g., `archive.ts`, `client.ts`)
3. Add tests in `test/`
4. Update README.md with usage examples

### Add a New Identity File Type
1. Update `IDENTITY_FILES` in `src/soul-files.ts`
2. Consider whether it's mandatory or optional
3. Update documentation in README.md

### Modify STP Protocol
1. Update `src/server.ts` for server endpoints
2. Update `src/client.ts` for client operations
3. Add tests in `test/server.test.ts`
4. Document protocol changes in README.md

### Run Tests During Development
```bash
npm run build && npm test
```

## Important Files to Reference

- **README.md** — User-facing documentation, protocol specs, examples
- **FUTURE.md** — Security gaps, roadmap, design decisions
- **package.json** — Scripts, dependencies, CLI entry point
- **tsconfig.json** — TypeScript compiler settings

## CI/CD

- **CI** (`.github/workflows/ci.yml`): Runs on every push
  - Installs dependencies
  - Runs `npm run build`
  - Runs `npm test`
- **Publish** (`.github/workflows/publish.yml`): Publishes to npm on release

## Notes for Copilot

- This is a **minimal, focused codebase** designed for clarity and maintainability
- Prefer **Node.js built-ins** over adding external dependencies
- Always update **tests** when modifying functionality
- Keep code **context-window friendly** (currently ~1000 LOC)
- Maintain **zero runtime dependencies** philosophy
- Use **descriptive variable names** and add comments for complex logic
- Follow **ES module** conventions (`.js` extensions in imports)
