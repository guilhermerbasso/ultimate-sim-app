export interface ReleaseAsset {
  name: string
  size: number
  sha256: string
}

export interface ReleaseVerificationResult {
  errors: string[]
  notes: string[]
  version: string
  assets: ReleaseAsset[]
}

export interface VerifyReleaseArtifactsOptions {
  appRoot?: string
  distDir?: string
  tag?: string
}

export function normalizeVersion(value: unknown): string

export function verifyReleaseArtifacts(
  options?: VerifyReleaseArtifactsOptions
): ReleaseVerificationResult

export function renderChecksums(assets: ReleaseAsset[]): string
