import { describe, expectTypeOf, it } from 'vitest'
import type {
  AuthenticatedPrincipalBinding,
  AuthenticatedPrincipalVerifier,
  LedgerAppendOperation,
  LedgerFinalizationAuthority,
  LedgerFinalizationOperation,
  OpaqueAttestation,
  SchedulerAuthority,
  SchedulerAuthorityCommit,
  SchedulerAuthorityOperation
} from './index'

describe('dependency method types', () => {
  it('preserves exact callable parameters through scheduler and ledger snapshots', () => {
    expectTypeOf<SchedulerAuthority['commit']>().parameters.toEqualTypeOf<
      [SchedulerAuthorityOperation]
    >()
    expectTypeOf<SchedulerAuthority['recover']>().parameters.toEqualTypeOf<
      [SchedulerAuthorityOperation]
    >()
    expectTypeOf<SchedulerAuthority['verifyCommit']>().parameters.toEqualTypeOf<
      [SchedulerAuthorityCommit, SchedulerAuthorityOperation]
    >()
    expectTypeOf<
      AuthenticatedPrincipalVerifier['verifyPrincipal']
    >().parameters.toEqualTypeOf<
      [OpaqueAttestation, AuthenticatedPrincipalBinding]
    >()
    expectTypeOf<
      LedgerFinalizationAuthority['commitAppend']
    >().parameters.toEqualTypeOf<[LedgerAppendOperation]>()
    expectTypeOf<
      LedgerFinalizationAuthority['recoverAppend']
    >().parameters.toEqualTypeOf<[LedgerAppendOperation]>()
    expectTypeOf<
      LedgerFinalizationAuthority['commit']
    >().parameters.toEqualTypeOf<[LedgerFinalizationOperation]>()
    expectTypeOf<
      LedgerFinalizationAuthority['recover']
    >().parameters.toEqualTypeOf<[LedgerFinalizationOperation]>()
  })
})
