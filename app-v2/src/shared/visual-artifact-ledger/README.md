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
- approved release contract: 45 trigger families / 2,250 triggers / **16,600 total**

IDs and ordering are derived from exact-key, ordinal registries. Finalization compares every expected
ID and binds the plan hash, registry hash, and canonical artifact-set hash. Only the approved exact
16,600-artifact contract may receive a finalization event; 14,850-floor and 16,650/17,000 headroom
plans remain constructible but non-finalizable.

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
Every verifier is synchronous and succeeds only by returning the primitive boolean `true`; promises,
thenables, truthy objects/strings/numbers, and `false` fail closed.
Verifier implementations are trusted in-process code and must be isolated by the host if their own
execution is adversarial; the module contains the effects of return-type mistakes and ordinary
rejected Promises.

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
Reservations carry an authority-time lease. Capacity is released only by an authority-committed
manual cancellation or lease-expiry event; caller timestamps never expire reservations, and
cancel/expiry transitions replay through the same CAS/root chain. A released pre-dispatch attempt
may be reserved again; at most 200 release/replacement transitions are retained globally so the
documented maximum scheduler state remains below the runtime string ceiling. New reservations are
refused once their worst-case release can no longer be guaranteed; existing reservations may always
cancel or expire.

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

The supported bound is 17,000 artifacts (eight 50-artifact trigger families beyond the approved
16,600 contract), two revisions per artifact, and three image attempts per revision. Derived limits
are 306,001 ledger events, 306,401 scheduler events, 306,000 evidence records, 80-character identifiers,
24-character plan IDs, 88-character ASCII
attestations, and pre-commit per-revision/per-attempt budgets. Plan, envelope, and event-separator
JSON framing are included. The single-string parser/serializer ceiling is derived at runtime as 85%
of Node/V8 `MAX_STRING_LENGTH`, with both UTF-16 character and UTF-8 byte checks before allocation.
Parsers accept only byte-for-byte canonical JSON, which also rejects duplicate keys.
