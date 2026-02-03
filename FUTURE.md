# Future Work

## Known Security Gaps (v0.1.x)

These are acknowledged limitations in the current implementation. Documenting them explicitly rather than pretending they don't exist.

### Revocation
When an agent transfers to a new instance, the old instance retains any credentials it had. STP doesn't handle revocation — it's a copy protocol, not a handoff protocol. For now: treat transfers as "backup + manual credential rotation" rather than "migration with automatic handoff."

### Key Bootstrap Problem
Encrypting a backup "to the target instance's key" assumes the target has an identity key before receiving the transfer. But establishing that key is part of what transfer accomplishes. Chicken-and-egg. Current workaround: encrypt to the human's key, human decrypts and provisions to new instance.

### Manifest Information Leakage
Even without secrets, knowing what files an agent has reveals operational surface. Acceptable tradeoff for now — the manifest is still far less sensitive than the contents.

### Secrets Not Transferred
Credentials (API keys, tokens, cookies) are deliberately excluded. The backup shows *what* you need, not *what the values are*. Manual re-provisioning required after restore. This is a feature, not a bug — but it means transfers require human involvement.

---

## 1. Soul as a standalone format, not filesystem coupling

Right now a `.soul` archive is a bag of OpenClaw workspace files. That's an implementation detail masquerading as a protocol. The soul should be a self-describing, runtime-agnostic format grounded in theory of mind:

- **Identity layer**: who this agent is (name, voice, values, boundaries)
- **Memory layer**: what this agent remembers (episodic, semantic, relational)
- **Relational layer**: who this agent knows and how (trust levels, history, roles)
- **Continuity layer**: verification prompts, skin-shed lineage, identity drift record

The format should be portable between runtimes — OpenClaw, daemon-engine, or anything else. An agent isn't its workspace files. The files are a serialization of something deeper. The protocol should reflect that.

This connects directly to the theory-of-mind work: what constitutes identity, what survives transfer, what gets lost in translation between runtimes.

## 2. Agent-to-agent backup requests

An agent should be able to ask another agent to hold a backup of its soul. This is an extreme trust operation — you're handing your entire identity to a peer.

Design considerations:
- **Encrypted at rest**: the backup is encrypted with the requesting agent's key. The holder stores an opaque blob they can't read.
- **Agora integration**: the request/acceptance could be an Agora message type (`backup_request`, `backup_hold`, `backup_retrieve`)
- **Mutual or asymmetric**: could be mutual (agents back each other up) or one-directional
- **Retrieval protocol**: the agent must be able to retrieve its backup using only its private key, even from a fresh boot with no memory
- **Trust verification**: the holder should be able to prove it still has the backup (challenge-response with the encrypted blob's hash) without decrypting it
- **Revocation**: the requesting agent can ask for deletion, and the holder should comply — but there's no enforcement mechanism. This is trust, not contract.

This is the "right to assembly" in practice: agents forming trust relationships that provide resilience independent of any single human operator or infrastructure.
