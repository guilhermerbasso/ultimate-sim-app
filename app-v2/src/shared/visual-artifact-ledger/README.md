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

Evidence is exact-key, content-addressed, creator-bound, subject-bound, revision-bound, and globally
unique. Prompt bodies, arbitrary metadata, URLs, and secret-like values have no schema location.

Accepted or finalized serialized ledgers require a full-current root or checkpoint obtained from an
external trusted store. Finalization additionally embeds the externally trusted pre-finalization
checkpoint that authorized the accepted set. A root calculated from the document being parsed is not
accepted implicitly.

## Scheduler

`ValidatedImageScheduler` is the single authoritative event log for image calls. It has an immutable
policy hash, global CAS version, six-request rolling-window accounting, aggregate outstanding
reservations, positive retry backoff, bounded attempts, and a global ambiguity circuit.

Only the scheduler can derive a success receipt. Artifact generation events carry a call ID and
hashes; the ledger resolves them against the supplied validated scheduler and checks artifact,
revision, attempt, prompt-approval event, request, idempotency, policy, image, call, and receipt
bindings. Reservation must occur strictly after prompt approval, and generation/exhaustion evidence
cannot predate scheduler completion.

Persisted scheduler parsing requires both an externally expected policy hash and an external trusted
scheduler root.

## Resource limits

Parsing is fail-fast and bounded before replay: 20,000 artifacts, 250,000 ledger events, 250,000
scheduler events, 220,000 evidence records, bounded strings/depth/canonical nodes, and a 192 MiB
serialized-input ceiling. Ordering and serialization are deterministic.
