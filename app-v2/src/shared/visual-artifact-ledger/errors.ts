export type GovernanceErrorCode =
  | 'SCHEMA'
  | 'CARDINALITY'
  | 'INTEGRITY'
  | 'LIFECYCLE'
  | 'TRUST'
  | 'POLICY'
  | 'CAS'
  | 'QUOTA'
  | 'CIRCUIT'
  | 'RECEIPT'
  | 'FINALIZATION'

export class VisualArtifactGovernanceError extends Error {
  readonly code: GovernanceErrorCode

  constructor(code: GovernanceErrorCode, message: string) {
    super(message)
    this.name = 'VisualArtifactGovernanceError'
    this.code = code
  }
}

export function fail(code: GovernanceErrorCode, message: string): never {
  throw new VisualArtifactGovernanceError(code, message)
}
