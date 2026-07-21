# Provider layout fixtures

Synthetic little-endian fixtures for layout regression tests:

- ACC pages follow Kunos Shared Memory v1.8.12 (`#pragma pack(4)`), pinned to the published SDK mirror at commit `2ad4ab9`.
- AMS2 follows the Project CARS 2 shared-memory prefix through `mSequenceNumber`, pinned to v13 commit `b783329` and v14 commit `534ed28`.

The decoders fail closed on shorter buffers or unsupported versions. Fixtures contain invented telemetry values only; they are not game captures.
