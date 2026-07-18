# Optional relay contract v1

This directory documents the provider-neutral, local-first contract for the Wave F relay foundation.
It is not a deployable service and contains no endpoint, port, image, credential, secret, or live
network configuration.

## Executable contract

The strict TypeScript contract and deterministic test-only implementation live in:

- `app-v2/src/shared/relay/contracts.ts`
- `app-v2/src/shared/relay/policy.ts`
- `app-v2/src/shared/relay/mock.ts`
- `app-v2/src/shared/relay/manifests.ts`

`provider-contract.v1.json` is the portable catalog of allowlists and invariants. Example operational
manifests under `manifests/` are documentation fixtures only; production tooling must generate fresh
IDs, digests, timestamps, epochs, and signatures.

## Security boundary

- Local copies remain primary and usable with network denied.
- The relay contract accepts only allowlisted document/synchronization-event kinds.
- D4 secrets and D5 sensitive media/behavioral data are always denied.
- D3 submissions must match the exact current granted document consent epoch.
- Read-only capabilities cannot persist resync markers; only changes/snapshots mutate document heads.
- Replay state is derived from verified unique records, and quotas include full metadata/references.
- Every stored/imported record requires an admission-authority signature bound to the exact envelope,
  admission time, accepted identity/capability/consent epochs, and quota limits/usage.
- Provider-injected records without valid admission proof are quarantined and never influence replay
  watermarks, quota usage, document heads, or resync.
- Relay records contain ciphertext, public identity/capability material, hashes, epochs, counters,
  causal references, sender signatures, and admission receipts; never plaintext or private keys.
- The deterministic mock crypto profile proves validation flow, not cryptographic strength.
- A future live adapter must implement the production crypto profile and pass an independent security
  review before any hosting or credentials are introduced.

See `docs/relay-foundation-runbook.md` for backup, restore, upgrade, rollback, health, resync, and
provider migration procedures.
