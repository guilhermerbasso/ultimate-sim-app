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

Every ordinary append and finalization is committed through the same injected shared
`LedgerFinalizationAuthority`. An append transaction compares writability, sequence, root, last-event
hash, registry, and accepted count before storing the event and advancing the head. Finalization
compares that same row, independently requires the exact 16,600 count, complete-event floor, and
checkpoint/event/root coherence, then atomically marks the head finalized. The finalized bit and
head update therefore cannot be interleaved: finalization is uniquely last, while stale instances
replay the authority's committed events or fail CAS.

`DurableLedgerFinalizationAuthority` stores the shared head, append records, and finalization record
in Node's built-in SQLite backend. It requires WAL mode, `synchronous=FULL`, foreign keys, and
`BEGIN IMMEDIATE` writer transactions; unsupported durability fails closed during construction.
SQLite commit/rollback boundaries provide Windows-capable crash and restart recovery without
claiming success after an ignored directory-sync error. Exact operation hashes recover responses
lost after commit, while pre-commit process loss leaves no published head. A rollback exception or
transaction that remains active poisons and closes that connection; only the exact failed operation
may recover through a newly opened, confirmed-autocommit connection. Failure to close or reopen
fails the authority permanently closed.

Each revision must proceed through research, prompt draft, independent prompt QA, scheduler-backed
image generation, independent image QA, implementation, independent render QA, and acceptance.
Rejected or exhausted revisions are immutable. Supersession starts the next contiguous revision with
a link to the complete prior revision root and no copied lifecycle state.

Evidence is exact-key, content-addressed, creator-bound, subject-bound, revision-bound, globally
unique, and accepted only with an injected external evidence attestation. Every event likewise
requires an authenticated-principal attestation bound to its role, payload, prior root, and sequence.
Prompt bodies, arbitrary metadata, URLs, and secret-like values have no schema location.
Attestations and dependency containers must be getter-free own data, cannot be proxies, and are
validated/deep-copied once before verification, hashing, authority commit, or persistence.
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
Reservation operations additionally carry an immutable hash of the prompt-approval plan, artifact,
revision, ledger root/sequence, event, time, prompt, and attestation. The shared authority rechecks
that dependency fence inside the same version/root CAS that admits quota.
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
Canonical hashing uses its own deterministic encoder over validated own enumerable data fields;
proxies, accessors, sparse/custom arrays, symbol fields, and non-plain objects are rejected, while
inherited/prototype `toJSON` hooks are never observed.
