# Provider layout fixtures

Synthetic little-endian fixtures for layout regression tests:

- ACC pages follow Kunos Shared Memory v1.8.12 (`#pragma pack(4)`), pinned to the published SDK mirror at commit `2ad4ab9`.
- `ac-static-v1.7.bin` follows the same `SPageFileStatic` layout as the ACC static page — Assetto Corsa and ACC share `Local\acpmf_*` and the struct prefix is byte-identical through `maxFuel` at offset 416. It differs only in `smVersion`, which is the field that tells the two simulators apart. Bytes past AC's real struct end are zero, mirroring what a reader sees when it maps ACC's 820 bytes from AC's smaller section inside the same 4 KiB page.
- AMS2 follows the Project CARS 2 shared-memory prefix through `mSequenceNumber`, pinned to v13 commit `b783329` and v14 commit `534ed28`.

The decoders fail closed on shorter buffers or unsupported versions. Fixtures contain invented telemetry values only; they are not game captures.
