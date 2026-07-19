# Phase 02 contract kernel

This directory is the first additive Phase 02 extension point. It defines the canonical
`RaceOpsEvent` payload, provenance metadata, the CloudEvents 1.0 profile, and the executable v1
`StintPassport` contract.

## Scope

- Protobuf Edition 2023 sources live under `proto/`.
- `stint_passport.proto` defines the 12-item Passport, roster-bound ownership, explicit item
  resolution states, coverage, expiry, and lifecycle.
- `n-1/` is a separate checked-in descriptor for the only supported legacy migration. V2 never
  treats missing/future v1 fields as an implicit legacy version.
- `cloudevents/profile-v1.json` preserves CloudEvents standard attribute names/types.
- `relay/` defines the optional, provider-neutral ciphertext relay foundation and offline ops manifests.
- CloudEvents extensions use only `[a-z0-9]+`; copied 64-bit values are decimal strings while the
  authoritative typed values stay in the Protobuf payload.
- Buf `STANDARD` lint and `FILE` breaking rules are configured in `buf.yaml`.
- `scripts/verify-phase02-contracts.mjs` proves deterministic descriptors and confirms that the
  committed field-reuse fixture fails the breaking-change gate.

The Passport runtime consumes the bounded Phase 02 tap. It does not add a network path or
external egress.

The relay addition is limited to shared contracts/mocks and a static Settings capability matrix.
No telemetry provider, replay lifecycle, dashboard storage, connector, network path, or external
egress is changed by this slice.

## Validation

```powershell
buf lint contracts
node scripts/generate-phase02-descriptor.mjs
node scripts/generate-phase02-goldens.mjs
node scripts/verify-phase02-contracts.mjs
```

Set `BUF_BIN` to an explicit Buf executable when it is not available on `PATH`.
