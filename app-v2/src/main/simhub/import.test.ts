import { describe, expect, it } from 'vitest'
import { parseArduinoSetup, matrixLayoutFromParsed, buildProfileFromParsed } from './import'
import type { SimHubArduinoSetup } from './import'

// Inline fixture mirroring Gui's real arduinosetupsettings.json (nanoold iFlag).
const FIXTURE_NANOOLD: SimHubArduinoSetup = {
  LastPreset: {
    Version: '2',
    BoardId: 'nanoold',
    Title: '16/06/2026 22:55 : Arduino Nano (ATMega328), old bootloader',
    SerialPort: 'COM4',
    Content: [
      { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_ENABLED', Title: 'Enabled', DefaultValue: 0, Type: 'bool', Value: 1 },
      { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_DATAPIN', Title: 'Data pin', DefaultValue: 6, Type: 'pin;WS2812B Matrix data', Value: 6 },
      { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_SERPENTINELAYOUT', Title: 'Serpentine layout', DefaultValue: 0, Type: 'bool', Value: 1 },
      { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_SERPENTINELAYOUTREVERSE', Title: 'Serpentine layout reverse', DefaultValue: 0, Type: 'bool', Value: 0 },
      { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_LEFTRIGHTMIRROR', Title: 'Left/Right mirror', DefaultValue: 0, Type: 'bool', Value: 0 },
      // Unrelated items — should be ignored
      { Group: 'WS2812B RGB Leds', Name: 'WS2812B_RGBLEDCOUNT', Title: 'LED count', DefaultValue: 0, Type: 'int', Value: 0 }
    ]
  }
}

// Fixture with mirror ON and serpentine reverse ON (both flip cancel out).
const FIXTURE_MIRROR_AND_REV: SimHubArduinoSetup = {
  LastPreset: {
    BoardId: 'uno',
    Content: [
      { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_ENABLED', Title: 'Enabled', DefaultValue: 0, Type: 'bool', Value: 1 },
      { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_DATAPIN', Title: 'Data pin', DefaultValue: 3, Type: 'pin', Value: 3 },
      { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_SERPENTINELAYOUT', Title: 'Serpentine', DefaultValue: 1, Type: 'bool', Value: 1 },
      { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_SERPENTINELAYOUTREVERSE', Title: 'Serpentine reverse', DefaultValue: 0, Type: 'bool', Value: 1 },
      { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_LEFTRIGHTMIRROR', Title: 'Mirror', DefaultValue: 0, Type: 'bool', Value: 1 }
    ]
  }
}

// Fixture with only DefaultValue set (no explicit Value), ensures fallback works.
const FIXTURE_DEFAULT_ONLY: SimHubArduinoSetup = {
  LastPreset: {
    BoardId: 'mega2560',
    Content: [
      { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_ENABLED', Title: 'Enabled', DefaultValue: 1, Type: 'bool' },
      { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_DATAPIN', Title: 'Data pin', DefaultValue: 10, Type: 'pin' },
      { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_SERPENTINELAYOUT', Title: 'Serpentine', DefaultValue: 0, Type: 'bool' },
      { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_SERPENTINELAYOUTREVERSE', Title: 'Serpentine reverse', DefaultValue: 0, Type: 'bool' },
      { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_LEFTRIGHTMIRROR', Title: 'Mirror', DefaultValue: 0, Type: 'bool' }
    ]
  }
}

describe('parseArduinoSetup', () => {
  it('extracts matrix config from Gui real config (nanoold)', () => {
    const result = parseArduinoSetup(FIXTURE_NANOOLD)
    expect(result.simhubBoardId).toBe('nanoold')
    expect(result.board).toBe('nano')
    expect(result.matrix.enabled).toBe(true)
    expect(result.matrix.dataPin).toBe(6)
    expect(result.matrix.serpentine).toBe(true)
    expect(result.matrix.serpentineRev).toBe(false)
    expect(result.matrix.leftRightMirror).toBe(false)
  })

  it('maps nanoold → board: nano', () => {
    expect(parseArduinoSetup(FIXTURE_NANOOLD).board).toBe('nano')
  })

  it('maps uno → board: uno', () => {
    expect(parseArduinoSetup(FIXTURE_MIRROR_AND_REV).board).toBe('uno')
  })

  it('maps mega2560 → board: mega2560', () => {
    expect(parseArduinoSetup(FIXTURE_DEFAULT_ONLY).board).toBe('mega2560')
  })

  it('prefers explicit Value over DefaultValue', () => {
    const result = parseArduinoSetup(FIXTURE_NANOOLD)
    // MATRIX_ENABLED DefaultValue=0, Value=1 → should be true
    expect(result.matrix.enabled).toBe(true)
  })

  it('falls back to DefaultValue when Value is absent', () => {
    const result = parseArduinoSetup(FIXTURE_DEFAULT_ONLY)
    expect(result.matrix.enabled).toBe(true)
    expect(result.matrix.dataPin).toBe(10)
    expect(result.matrix.serpentine).toBe(false)
  })

  it('returns sensible defaults when Content is empty', () => {
    const result = parseArduinoSetup({ LastPreset: { BoardId: 'nano', Content: [] } })
    expect(result.matrix.serpentine).toBe(true)
    expect(result.matrix.dataPin).toBe(6)
    expect(result.matrix.enabled).toBe(false)
  })

  it('handles missing LastPreset gracefully', () => {
    const result = parseArduinoSetup({})
    expect(result.board).toBe('generic')
    expect(result.matrix.dataPin).toBe(6)
  })
})

describe('matrixLayoutFromParsed', () => {
  it('nanoold: serpentine=true, no mirror, no rev → flipX=false', () => {
    const parsed = parseArduinoSetup(FIXTURE_NANOOLD)
    const layout = matrixLayoutFromParsed(parsed)
    expect(layout.serpentine).toBe(true)
    expect(layout.flipX).toBe(false)
    expect(layout.flipY).toBe(false)
    expect(layout.rotation).toBe(0)
  })

  it('mirror=true, serpentineRev=false → flipX=true', () => {
    const fixture: SimHubArduinoSetup = {
      LastPreset: {
        BoardId: 'nano',
        Content: [
          { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_SERPENTINELAYOUT', Title: '', DefaultValue: 1, Type: 'bool', Value: 1 },
          { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_SERPENTINELAYOUTREVERSE', Title: '', DefaultValue: 0, Type: 'bool', Value: 0 },
          { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_LEFTRIGHTMIRROR', Title: '', DefaultValue: 0, Type: 'bool', Value: 1 }
        ]
      }
    }
    const layout = matrixLayoutFromParsed(parseArduinoSetup(fixture))
    expect(layout.flipX).toBe(true)
  })

  it('mirror=true AND serpentineRev=true → flipX=false (cancel out)', () => {
    const parsed = parseArduinoSetup(FIXTURE_MIRROR_AND_REV)
    const layout = matrixLayoutFromParsed(parsed)
    expect(layout.flipX).toBe(false)
  })
})

describe('buildProfileFromParsed', () => {
  it('produces a DeviceProfile partial with correct board and serpentine', () => {
    const parsed = parseArduinoSetup(FIXTURE_NANOOLD)
    const profile = buildProfileFromParsed(parsed)
    expect(profile.board).toBe('nano')
    const matrix = profile.components?.find((c) => c.type === 'rgbMatrix')
    expect(matrix).toBeDefined()
    if (matrix?.type === 'rgbMatrix') {
      expect(matrix.serpentine).toBe(true)
      expect(matrix.mode).toBe('iflag')
      expect(matrix.chip).toBe('ws2812')
    }
  })

  it('maps data pin to D-label format for AVR boards', () => {
    const parsed = parseArduinoSetup(FIXTURE_NANOOLD)
    const profile = buildProfileFromParsed(parsed)
    const matrix = profile.components?.find((c) => c.type === 'rgbMatrix')
    expect(matrix?.pins?.data).toBe('D6')
  })

  it('maps data pin to GPIO-label format for ESP32', () => {
    const fixture: SimHubArduinoSetup = {
      LastPreset: {
        BoardId: 'esp32',
        Content: [
          { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_ENABLED', Title: '', DefaultValue: 1, Type: 'bool' },
          { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_DATAPIN', Title: '', DefaultValue: 4, Type: 'pin' },
          { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_SERPENTINELAYOUT', Title: '', DefaultValue: 1, Type: 'bool' },
          { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_SERPENTINELAYOUTREVERSE', Title: '', DefaultValue: 0, Type: 'bool' },
          { Group: 'WS2812B RGB Matrix', Name: 'WS2812B_MATRIX_LEFTRIGHTMIRROR', Title: '', DefaultValue: 0, Type: 'bool' }
        ]
      }
    }
    const profile = buildProfileFromParsed(parseArduinoSetup(fixture))
    const matrix = profile.components?.find((c) => c.type === 'rgbMatrix')
    expect(matrix?.pins?.data).toBe('GPIO4')
  })
})
