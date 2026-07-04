// ── Optional generated-asset manifest ─────────────────────────────────────────
// The instrument primitives render FULLY without any generated assets (every
// primitive draws procedural SVG). The Python build-time pipeline
// (scripts/gen-instrument-assets.py) can OPTIONALLY emit brand-neutral bezels,
// tick-rings, carbon/brushed textures and a telltale sprite plus a manifest.json.
// This module only describes the manifest shape and offers a safe, side-effect-free
// accessor — nothing here is required for the primitives to work.

export interface InstrumentAsset {
  /** Stable key, e.g. 'bezel-chrome-200'. */
  id: string
  /** Asset kind. */
  kind: 'bezel' | 'tickring' | 'texture' | 'sprite'
  /** Public path/URL relative to the renderer (e.g. assets/instruments/...). */
  src: string
  /** Format. */
  format: 'svg' | 'png'
  width?: number
  height?: number
  /** Free-form metadata (sweepDeg, material, segments…). */
  meta?: Record<string, string | number | boolean>
}

export interface InstrumentAssetManifest {
  version: number
  generatedAt?: string
  /** All assets keyed by id. */
  assets: Record<string, InstrumentAsset>
}

/**
 * Resolve an optional, runtime-provided manifest. Primitives never call this on the
 * mandatory render path — it exists so a host that DID run the pipeline can pass the
 * loaded manifest in and look assets up. Returns null when nothing is provided.
 */
export function getInstrumentAsset(
  manifest: InstrumentAssetManifest | null | undefined,
  id: string
): InstrumentAsset | null {
  if (!manifest || !manifest.assets) return null
  return manifest.assets[id] ?? null
}

/** True when a manifest exposes at least one asset of the given kind. */
export function hasInstrumentAssets(
  manifest: InstrumentAssetManifest | null | undefined,
  kind?: InstrumentAsset['kind']
): boolean {
  if (!manifest || !manifest.assets) return false
  const list = Object.values(manifest.assets)
  return kind ? list.some((a) => a.kind === kind) : list.length > 0
}
