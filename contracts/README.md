# Phase 02 contract kernel

This directory is the first additive Phase 02 extension point. It defines the canonical
`RaceOpsEvent` payload, provenance metadata, and the CloudEvents 1.0 profile without wiring them
into the Phase 01 runtime.

## Scope

- Protobuf Edition 2023 sources live under `proto/`.
- `cloudevents/profile-v1.json` preserves CloudEvents standard attribute names/types.
- CloudEvents extensions use only `[a-z0-9]+`; copied 64-bit values are decimal strings while the
  authoritative typed values stay in the Protobuf payload.
- Buf `STANDARD` lint and `FILE` breaking rules are configured in `buf.yaml`.
- `scripts/verify-phase02-contracts.mjs` proves deterministic descriptors and confirms that the
  committed field-reuse fixture fails the breaking-change gate.

No application source, telemetry provider, replay lifecycle, dashboard storage, connector,
network path, or external egress is changed by this slice.

## Validation

```powershell
buf lint contracts
node scripts/verify-phase02-contracts.mjs
```

Set `BUF_BIN` to an explicit Buf executable when it is not available on `PATH`.
