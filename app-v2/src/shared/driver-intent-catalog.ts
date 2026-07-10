// Aggregates the pluggable intent catalogues (A racecraft / B management /
// C conditions) into one registry. Adding a new intent = add a rule to one of the
// catalogue files (or register another array here) — the decision core never changes.

import { DriverIntentRegistry, type IntentRule } from './driver-intent'
import { RACECRAFT_INTENT_RULES } from './driver-intent-racecraft'
import { MANAGEMENT_INTENT_RULES } from './driver-intent-management'
import { CONDITIONS_INTENT_RULES } from './driver-intent-conditions'

/** Every registered intent rule, in catalogue order (racecraft → management → conditions). */
export const ALL_INTENT_RULES: IntentRule[] = [
  ...RACECRAFT_INTENT_RULES,
  ...MANAGEMENT_INTENT_RULES,
  ...CONDITIONS_INTENT_RULES
]

/** Build a fresh registry populated with the full default catalogue. */
export function createDefaultIntentRegistry(): DriverIntentRegistry {
  return new DriverIntentRegistry().registerAll(ALL_INTENT_RULES)
}
