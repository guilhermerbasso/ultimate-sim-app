# ADR — Responsible AI and accessibility cue evolution

- **Status:** Accepted for foundation; target-user validation remains blocked/pending
- **Scope:** F2-08 semantic accessibility cues
- **Last updated:** 2026-07-18

## Context

Accessibility profiles are user-selected presentation policies for existing semantic alerts. They are not diagnoses, medical recommendations, gameplay automation, or evidence that a cohort has validated the product. Raw detector prose is not a safe speech contract because it can mix languages, units, and implementation wording.

## Decision

1. Route bounded semantic keys plus typed context; localize immediately before caption or speech.
2. Never infer disability, hearing, vision, fatigue, health, or preferred profile.
3. Keep all profiles and speech local. No telemetry, profile, or cue leaves the device.
4. Fail closed until the persisted profile is ready. Startup alerts may be bounded and queued, but cannot actuate cue hardware under defaults that have not loaded.
5. Treat caption, symbol, and LED as one visual sensory channel. Critical redundancy requires another independent auditory or tactile channel.
6. Respect explicit modality-off choices. Critical routing reports degraded redundancy rather than silently restoring a disabled caption or audio channel.
7. Reduced-motion profiles replace repeated haptic bursts with one sustained pulse and use only the actual supported steady SIM-X lamp/OLED output.
8. Preview uses isolated speech and simulated hardware. It cannot cancel live critical speech or send device commands.
9. Persist mutations serially with protocol/revision checks. Stale writers are rejected and must reload.
10. Automated tests establish deterministic software behavior only. Blind/low-vision and Deaf/HoH cohort outcomes require preregistered target-user testing before any validation claim.

## Evolution log

| Date | Change | Reason |
|---|---|---|
| 2026-07-17 | Added semantic manifests, selectable profiles, local persistence, preview, and multimodal adapters. | Establish the F2-08 foundation. |
| 2026-07-18 | Replaced taught LED color/strobe claims with the actual steady device lamp plus OLED token. | Preview and hardware behavior must match. |
| 2026-07-18 | Added modality policies, manifest inheritance, independent sensory-channel checks, and explicit-off preservation. | Caption plus symbol is not independent redundancy. |
| 2026-07-18 | Added per-modality visual/haptic/speech queues and isolated preview/live speech channels. | A persistent critical caption must not suppress later flags or cancel other modalities. |
| 2026-07-18 | Added semantic localization, versioned broadcasts, serialized saves, and readiness-gated startup routing. | Prevent mixed-language speech, lost rapid edits, and unsafe startup defaults. |

## Verification and accountability

Regression tests cover reduced-motion patterns, truthful preview/hardware parity, semantic localization, caption-off behavior, modality arbitration, revision conflicts, rapid-edit serialization, preview speech isolation, replay boundaries, and startup readiness. Findings remain appealable through normal issue/PR review, and this ADR must evolve whenever modality capabilities or supported hardware protocols change.
