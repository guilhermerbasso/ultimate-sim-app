# Optional self-hosted relay foundation runbook

## Status and non-goals

This Wave F slice is an offline foundation: contracts, policy enforcement, deterministic mocks,
operational manifests, tests, and a UI status matrix. It does **not** start a server, bind a port,
resolve DNS, open a socket, provision storage, contact a provider, request a credential, or implement
production cryptography. Local app behavior remains primary and unchanged when network access is denied.

A future self-hosted implementation may place a TLS ingress, replaceable relay adapter, metadata store,
and opaque object store behind the Policy/Egress Gateway. That deployment is not present here.

## Invariants

1. Only allowlisted user documents and synchronization events enter the relay path.
2. Raw telemetry, authoritative `RaceOpsEvent`, evidence ledgers, driving commands, secrets, machine
   settings, raw biometrics, and raw voice/video are denied.
3. D0-D2 follow document/capability policy. D3 additionally requires the exact current granted consent
   epoch, role policy, retention, and capability. Withdrawal advances the epoch and invalidates queued
   or newly submitted stale grants. D4/D5 are blocked.
4. Relay storage receives ciphertext plus public verification metadata, never plaintext, private keys,
   OAuth tokens, stream keys, webhook URLs, or cookies.
5. Every change/snapshot is bound to a versioned canonical tuple containing document and membership/key
   epochs, sender/key IDs, replay counter, causal references, ciphertext/member-envelope hashes, crypto
   profile, and expiry.
6. Every stored/imported record carries an admission-authority signature over the exact envelope digest,
   admission time, accepted policy state, quota limits, and usage before/after the write.
7. Revocation protects future epochs. It cannot erase history already admitted and delivered to an
   authorized device.
8. Cloud/relay failure affects only optional synchronization. Local editing and race-critical behavior
   continue.

## Identity, capability, and key lifecycle

- Device identity envelopes carry public signing/encryption keys, identity epoch, validity, issuer, and
  issuer signature.
- Capability envelopes scope tenant, subject/device, document IDs/kinds, event kinds, rights, maximum
  data class, consent epoch, membership epoch, and expiry.
- Document keys are per-document and per-epoch. Key envelopes are created only for active members.
- Scheduled rotation increments the document key epoch.
- Document membership revocation removes the member and rotates only that document. Global device
  revocation marks the identity revoked, removes it from every document, rotates every affected
  membership/key epoch, and creates envelopes only for survivors.
- Previously admitted signed history remains verifiable after either revocation scope; a revoked device
  cannot submit queued or new envelopes.
- Sender signatures prove authorship; separate gateway admission receipts prove the envelope actually
  passed then-current identity, capability, consent, membership/key, replay, health, and quota checks.
- Missing, malformed, forged, mismatched, or quota-inconsistent admission receipts are quarantined before
  replay watermarks, quota usage, heads, merge, or resync are calculated.
- Treat the adapter's list key as untrusted input: envelope and admission tenants must both exactly match
  the requested tenant, otherwise quarantine the record and block automatic resync.
- Unknown, revoked, expired, bad-signature, stale-membership, stale-key, and replayed envelopes are
  rejected or quarantined before merge.
- The deterministic mock profile models these checks only. A live adapter must use independently reviewed
  production primitives and OS-protected private keys.

## Offline queue and quotas

- Apply an allowed change to the local primary copy first.
- If relay transport is unavailable, queue only the ciphertext envelope.
- Bound storage and queues by full serialized envelope bytes, not ciphertext alone. Also bound each
  envelope plus causal-reference count/bytes. A full queue never removes the local change.
- Revalidate current identity, capability, consent, membership/key epochs, replay counter, provider health,
  and tenant/device/document quotas during flush.
- Sign admission-time policy and quota metadata only after every check passes and before provider storage.
  Provider records without that proof do not consume authenticated quota or replay state.
- Do not retry split-brain, revoked, stale, undeclared, or integrity-failed items automatically. Move them
  to an operator-visible dead letter/quarantine state.
- Quotas exist per tenant, device, document, stored envelope bytes, single-envelope size, causal
  references, and offline queue to limit abuse and denial-of-wallet risk.

## Health and resync

| Status | Meaning | Action |
|---|---|---|
| `local-only` | Relay unavailable with no queued ciphertext | Continue locally; no race-critical alert. |
| `offline-queueing` | Local work continues and bounded ciphertext is queued | Preserve order; revalidate on flush. |
| `healthy` | One provider writer, no quarantine, queue empty | Normal optional sync. |
| `degraded` | Queue or quarantine needs attention | Inspect receipts and current grants/epochs. |
| `split-brain` | Multiple provider writers/generations are visible | Freeze relay writes and automatic resync. |

Resync compares verified local and relay heads. Pull or push a strict subset; deterministically merge
concurrent verified heads. Verification requires both sender authenticity and gateway admission proof.
Any quarantined integrity/authenticity/admission failure or split brain blocks automatic resync. Restore
one authoritative provider generation, verify the ciphertext digest/cursors/receipts, then generate a
fresh resync plan.

Read-only grants never write resync markers. A stored marker requires `document:append`, and only
document changes/snapshots can mutate document heads.

## Backup and restore

1. Pause relay writes only; keep local editing available.
2. Require one healthy writer generation.
3. Export the provider-neutral ciphertext snapshot and `usa.relay.backup/v1` manifest.
4. Verify object count, ciphertext bytes, cursor range, document IDs, records digest, and receipt presence.
5. Verify `includesPlaintext=false`, `includesPrivateKeys=false`, and `networkRequired=false`.
6. Store any optional recovery package separately from relay data; recovery is explicit opt-in.
7. For a restore drill, import into an empty isolated adapter, verify the same records digest/count, then
   cryptographically verify every admission receipt before health/resync planning and activation.
8. A conflicting non-empty destination is a hard stop unless its digest already matches exactly.

Loss of all authorized device keys without an opt-in recovery package is intentionally irrecoverable.

## Upgrade

1. Generate `usa.relay.upgrade/v1` referencing a verified backup and rollback manifest.
2. Record current app/provider contract versions and key/membership epochs.
3. Apply schema changes to an isolated copy.
4. Verify count, cursors, ciphertext digests, envelope/admission validation, single-writer health, and
   resync plans.
5. Resume writes only after retaining the rollback checkpoint.

No version change in this foundation requires a download or external endpoint.

## Rollback

1. Freeze relay writes, not local editing.
2. Use `usa.relay.rollback/v1` to select the prior app/provider contract and verified backup.
3. Restore ciphertext and admission receipts, then verify digest, count, cursors, key/membership epochs,
   admission signatures, and exactly one writer.
4. Generate a resync plan before releasing the offline queue.
5. Reject queued envelopes whose grants, consent, signer, membership, or key epoch became stale.

## Provider migration

1. Require provider contract `usa.relay.provider/v1` at source and destination.
2. Block migration if the source is split-brain.
3. Create and verify a source backup without mutating source records.
4. Import into an empty destination.
5. Compare destination object count and records digest with the source backup, then verify every migrated
   admission receipt before making the destination authoritative.
6. Record a provider migration manifest and keep source read-only until the rollback window closes.
7. Reissue no identities or document keys merely because the storage provider changed.

## Deterministic failure evidence

`app-v2/src/shared/relay/relay-foundation.test.ts` covers:

- compromised relay ciphertext/member-key-envelope quarantine;
- undeclared fields and prohibited data classes/event kinds;
- replay rejection;
- verified-only replay watermarks plus duplicate-envelope quarantine;
- stale key rejection plus document/global revocation and rotation;
- stale/withdrawn D3 consent rejection during submission and queue flush;
- tenant, full-envelope, reference, and offline-queue quota denial;
- authenticated admission receipts with policy/quota metadata;
- quarantine of directly inserted envelopes rejected for signer revocation, withdrawn D3 consent, or size;
- offline local-first queue/flush;
- split-brain health and blocked resync;
- ciphertext-only backup/restore plus upgrade/rollback manifests;
- provider-neutral migration without source mutation.

`RelayCapabilityStatusMatrix.test.ts` proves the UI performs no IPC or network request and explicitly
shows live hosting, endpoints, credentials, and production cryptography as unconfigured.
