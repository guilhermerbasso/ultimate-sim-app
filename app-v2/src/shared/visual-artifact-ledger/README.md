# Visual artifact governance ledger V2

This folder is a clean event-sourced governance boundary. It does not persist mutable artifact
snapshots and does not perform network, image-generation, credential, environment, URL, or paid-call
work.

## Plan

The canonical plan has 50 styles and 143 concepts:

- 50 dashboards
- 7,150 widgets (`50 × 143`)
- 7,150 ordinary overlays (`50 × 143`)
- at least 500 independent trigger artifacts
- minimum total: **14,850**

IDs and ordering are derived from exact-key, ordinal registries. Finalization compares every expected
ID and binds the plan hash, registry hash, and canonical artifact-set hash.

## Artifact log

`VisualArtifactLedger` assigns every event a global sequence, previous-event SHA-256, and event
SHA-256. Its in-memory indexes update only the affected artifact revision, evidence keys, global
chain, and scheduler receipt lookup. Full replay is intentionally limited to parsing and
finalization.

Each revision must proceed through research, prompt draft, independent prompt QA, scheduler-backed
image generation, independent image QA, implementation, independent render QA, and acceptance.
Rejected or exhausted revisions are immutable. Supersession starts the next contiguous revision with
a link to the complete prior revision root and no copied lifecycle state.

Evidence is exact-key, content-addressed, creator-bound, subject-bound, revision-bound, globally
unique, and accepted only with an injected external evidence attestation. Every event likewise
requires an authenticated-principal attestation bound to its role, payload, prior root, and sequence.
Prompt bodies, arbitrary metadata, URLs, and secret-like values have no schema location.

All serialization and parsing require an opaque root attestation, embedded in the canonical envelope
and verified by an injected trust verifier. Raw root hashes are never authorization, public
plan/event views cannot reconstruct an authenticated envelope, and no unchecked serializable
snapshot API is exported. Finalization additionally embeds a purpose-separated pre-finalization
checkpoint attestation that cannot authorize a stripped, unfinalized envelope.

## Scheduler

`ValidatedImageScheduler` has no production in-memory authority. Every operation must be atomically
committed by an injected shared `SchedulerAuthority`, which owns the durable CAS version, root,
monotonic time, six-request rolling window, outstanding reservations, and global ambiguity circuit.
Forked scheduler instances therefore contend on one external version/root instead of independent
local quota counters.

Only the scheduler can derive a success receipt. Artifact generation events carry a call ID and
hashes; the ledger resolves them against the supplied validated scheduler and checks artifact,
revision, attempt, prompt-approval event, request, idempotency, policy, image, call, and receipt
bindings. Reservation requires an externally attested committed ledger checkpoint proving prompt
approval already exists and binds its approval timestamp as the authority-clock lower bound. Success
additionally requires an externally verified scheduler-service receipt, and the resulting receipt
binds the authority commit root/version. Authority commits are recoverable idempotently by operation
hash when a durable response is lost.
Retry lineage is scoped by plan hash, artifact ID, and revision.

Persisted scheduler parsing requires the expected policy hash, injected authority/verifiers, and an
externally issued scheduler-root attestation.

## Resource limits

The documented maximum is 15,000 artifacts, two revisions per artifact, and three image attempts per
revision. Derived limits are 270,001 ledger events, 270,001 scheduler events, 270,000 evidence
records, pre-commit per-revision/per-attempt byte budgets, derived canonical-node capacity, and a 768 MiB UTF-8
parser ceiling. Parsers accept only byte-for-byte canonical JSON, which also rejects duplicate keys.
