# Future Work

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
