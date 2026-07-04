import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  parsePiperVoiceId,
  isValidPiperVoiceId,
  PIPER_VOICE_CATALOG,
  SHERPA_TTS_MODELS_BASE,
  piperVoiceApproxBytes,
  sherpaVoiceBundleBytes,
  sherpaVoiceBundleUrl
} from '../../shared/spotter'
import { resolveVoiceModelPath } from './piper'

// Tests for neural-TTS voice-ID parsing and catalog integrity.
// These run in a Node environment with NO binary dependency.

describe('parsePiperVoiceId', () => {
  it('extracts id from piper: prefix', () => {
    expect(parsePiperVoiceId('piper:en_US-amy-low')).toBe('en_US-amy-low')
    expect(parsePiperVoiceId('piper:pt_BR-faber-medium')).toBe('pt_BR-faber-medium')
  })

  it('returns null for OS voices', () => {
    expect(parsePiperVoiceId('')).toBeNull()
    expect(parsePiperVoiceId('OS David Desktop - English (United States)')).toBeNull()
    expect(parsePiperVoiceId('com.apple.speech.synthesis.voice.joana')).toBeNull()
  })

  it('returns null for unrelated strings', () => {
    expect(parsePiperVoiceId('os:something')).toBeNull()
    expect(parsePiperVoiceId('piperx:en_US-amy-low')).toBeNull()
  })

  it('handles edge cases', () => {
    expect(parsePiperVoiceId('piper:')).toBe('')
    expect(parsePiperVoiceId('piper:piper:nested')).toBe('piper:nested')
  })
})

describe('PIPER_VOICE_CATALOG', () => {
  it('has at least one pt-BR and one en-US voice', () => {
    const ptBR = PIPER_VOICE_CATALOG.filter((v) => v.lang === 'pt-BR')
    const enUS = PIPER_VOICE_CATALOG.filter((v) => v.lang === 'en-US')
    expect(ptBR.length).toBeGreaterThanOrEqual(1)
    expect(enUS.length).toBeGreaterThanOrEqual(1)
  })

  it('all catalog ids round-trip through parsePiperVoiceId', () => {
    for (const voice of PIPER_VOICE_CATALOG) {
      const voiceURI = `piper:${voice.id}`
      expect(parsePiperVoiceId(voiceURI)).toBe(voice.id)
    }
  })

  it('installed defaults to false in static catalog', () => {
    for (const voice of PIPER_VOICE_CATALOG) {
      expect(voice.installed).toBe(false)
    }
  })

  it('catalog ids follow piper naming convention', () => {
    for (const voice of PIPER_VOICE_CATALOG) {
      // e.g. "en_US-amy-low" or "pt_BR-faber-medium"
      expect(voice.id).toMatch(/^[a-z]{2}_[A-Z]{2}-.+-(low|medium|high)$/)
    }
  })

  it('each voice name is non-empty', () => {
    for (const voice of PIPER_VOICE_CATALOG) {
      expect(voice.name.length).toBeGreaterThan(0)
    }
  })
})

describe('isValidPiperVoiceId', () => {
  it('accepts all catalog ids', () => {
    for (const voice of PIPER_VOICE_CATALOG) {
      expect(isValidPiperVoiceId(voice.id)).toBe(true)
    }
  })

  it('rejects path traversal sequences', () => {
    expect(isValidPiperVoiceId('../etc/passwd')).toBe(false)
    expect(isValidPiperVoiceId('voices/../../secret')).toBe(false)
    expect(isValidPiperVoiceId('..\\windows\\system32')).toBe(false)
    expect(isValidPiperVoiceId('en_US-amy-low/../evil')).toBe(false)
  })

  it('rejects path separator variants', () => {
    expect(isValidPiperVoiceId('en_US/amy/low')).toBe(false)
    expect(isValidPiperVoiceId('en_US\\amy\\low')).toBe(false)
  })

  it('rejects unknown voice ids not in catalog', () => {
    expect(isValidPiperVoiceId('')).toBe(false)
    expect(isValidPiperVoiceId('en_US-unknown-low')).toBe(false)
    expect(isValidPiperVoiceId('piper:en_US-amy-low')).toBe(false) // full URI, not just id
  })

  it('round-trips: parsePiperVoiceId result is always valid', () => {
    for (const voice of PIPER_VOICE_CATALOG) {
      const parsed = parsePiperVoiceId(`piper:${voice.id}`)
      expect(parsed).not.toBeNull()
      expect(isValidPiperVoiceId(parsed!)).toBe(true)
    }
  })
})

describe('sherpaVoiceBundleUrl (download-on-demand URL derivation)', () => {
  it('builds the .tar.bz2 sherpa bundle URL from a voice id', () => {
    expect(sherpaVoiceBundleUrl('pt_BR-faber-medium')).toBe(
      `${SHERPA_TTS_MODELS_BASE}/vits-piper-pt_BR-faber-medium.tar.bz2`
    )
  })

  it('handles en_US ids', () => {
    expect(sherpaVoiceBundleUrl('en_US-lessac-medium')).toBe(
      `${SHERPA_TTS_MODELS_BASE}/vits-piper-en_US-lessac-medium.tar.bz2`
    )
  })

  it('derives a resolvable bundle URL for every catalog voice', () => {
    for (const voice of PIPER_VOICE_CATALOG) {
      const url = sherpaVoiceBundleUrl(voice.id)
      expect(url).not.toBeNull()
      expect(url!.endsWith(`vits-piper-${voice.id}.tar.bz2`)).toBe(true)
    }
  })

  it('returns null for malformed ids (no bogus URL)', () => {
    expect(sherpaVoiceBundleUrl('')).toBeNull()
    expect(sherpaVoiceBundleUrl('faber-medium')).toBeNull()
    expect(sherpaVoiceBundleUrl('pt_BR-faber')).toBeNull() // missing quality
    expect(sherpaVoiceBundleUrl('pt_BR-faber-ultra')).toBeNull() // bad quality
  })
})

describe('sherpaVoiceBundleBytes (.tar.bz2 download total)', () => {
  it('returns a positive bundle size for every catalog voice', () => {
    for (const voice of PIPER_VOICE_CATALOG) {
      expect(sherpaVoiceBundleBytes(voice.id)).toBeGreaterThan(1_000_000)
    }
  })

  it('returns 0 for unknown voices', () => {
    expect(sherpaVoiceBundleBytes('en_US-nope-low')).toBe(0)
  })
})

describe('piperVoiceApproxBytes (size lookup)', () => {
  it('returns the catalog size for known voices', () => {
    expect(piperVoiceApproxBytes('pt_BR-faber-medium')).toBeGreaterThan(1_000_000)
    expect(piperVoiceApproxBytes('pt_BR-edresson-low')).toBeGreaterThan(1_000_000)
  })

  it('returns 0 for unknown voices', () => {
    expect(piperVoiceApproxBytes('en_US-nope-low')).toBe(0)
  })

  it('every catalog voice declares a positive onnxBytes', () => {
    for (const voice of PIPER_VOICE_CATALOG) {
      expect(piperVoiceApproxBytes(voice.id)).toBeGreaterThan(0)
    }
  })
})

describe('catalog includes the higher-quality voices', () => {
  it('keeps existing ids AND adds en_US-lessac-medium + en_US-amy-medium', () => {
    const ids = PIPER_VOICE_CATALOG.map((v) => v.id)
    expect(ids).toContain('pt_BR-faber-medium')
    expect(ids).toContain('pt_BR-edresson-low')
    expect(ids).toContain('en_US-amy-low')
    expect(ids).toContain('en_US-ryan-medium')
    expect(ids).toContain('en_US-lessac-medium')
    expect(ids).toContain('en_US-amy-medium')
  })

  it('the default pt-BR voice (faber-medium) leads the catalog', () => {
    expect(PIPER_VOICE_CATALOG[0].id).toBe('pt_BR-faber-medium')
  })
})

describe('catalog includes the new pt-BR voices (cadu + jeff)', () => {
  it('adds pt_BR-cadu-medium and pt_BR-jeff-medium', () => {
    const ids = PIPER_VOICE_CATALOG.map((v) => v.id)
    expect(ids).toContain('pt_BR-cadu-medium')
    expect(ids).toContain('pt_BR-jeff-medium')
  })

  it('catalog now has FOUR distinct pt-BR voices (no longer all identical)', () => {
    const ptIds = PIPER_VOICE_CATALOG.filter((v) => v.lang === 'pt-BR').map((v) => v.id)
    expect(ptIds).toEqual(
      expect.arrayContaining(['pt_BR-faber-medium', 'pt_BR-cadu-medium', 'pt_BR-jeff-medium', 'pt_BR-edresson-low'])
    )
    expect(new Set(ptIds).size).toBe(ptIds.length) // all distinct
  })

  it('derives the verified sherpa .tar.bz2 bundle URL for cadu', () => {
    expect(sherpaVoiceBundleUrl('pt_BR-cadu-medium')).toBe(
      `${SHERPA_TTS_MODELS_BASE}/vits-piper-pt_BR-cadu-medium.tar.bz2`
    )
  })

  it('derives the verified sherpa .tar.bz2 bundle URL for jeff', () => {
    expect(sherpaVoiceBundleUrl('pt_BR-jeff-medium')).toBe(
      `${SHERPA_TTS_MODELS_BASE}/vits-piper-pt_BR-jeff-medium.tar.bz2`
    )
  })

  it('declares a positive extracted-onnx size for cadu + jeff', () => {
    // Used for the 90% size-verify gate after extraction (~63 MB models).
    expect(piperVoiceApproxBytes('pt_BR-cadu-medium')).toBeGreaterThan(1_000_000)
    expect(piperVoiceApproxBytes('pt_BR-jeff-medium')).toBeGreaterThan(1_000_000)
  })

  it('cadu + jeff are valid, downloadable voice ids', () => {
    expect(isValidPiperVoiceId('pt_BR-cadu-medium')).toBe(true)
    expect(isValidPiperVoiceId('pt_BR-jeff-medium')).toBe(true)
  })
})

describe('resolveVoiceModelPath (userData vs resources precedence)', () => {
  // sherpa lays each voice in its OWN dir: <voicesDir>/<id>/model.onnx.
  const userVoicesDir = '/userdata/tts/voices'
  const bundledVoicesDir = '/app/resources/tts/voices'
  const voiceId = 'pt_BR-faber-medium'
  const downloaded = join(userVoicesDir, voiceId, 'model.onnx')
  const bundled = join(bundledVoicesDir, voiceId, 'model.onnx')

  it('prefers the DOWNLOADED copy when both exist', () => {
    const path = resolveVoiceModelPath({
      userVoicesDir,
      bundledVoicesDir,
      voiceId,
      exists: (p) => p === downloaded || p === bundled
    })
    expect(path).toBe(downloaded)
  })

  it('falls back to the BUNDLED copy when only it exists', () => {
    const path = resolveVoiceModelPath({
      userVoicesDir,
      bundledVoicesDir,
      voiceId,
      exists: (p) => p === bundled
    })
    expect(path).toBe(bundled)
  })

  it('uses the downloaded copy when only it exists', () => {
    const path = resolveVoiceModelPath({
      userVoicesDir,
      bundledVoicesDir,
      voiceId,
      exists: (p) => p === downloaded
    })
    expect(path).toBe(downloaded)
  })

  it('returns null when the voice is absent in both locations', () => {
    const path = resolveVoiceModelPath({
      userVoicesDir,
      bundledVoicesDir,
      voiceId,
      exists: () => false
    })
    expect(path).toBeNull()
  })
})
