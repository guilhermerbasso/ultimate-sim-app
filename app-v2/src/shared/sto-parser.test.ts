import { describe, expect, it } from 'vitest'
import { diffSetups, parseSto } from './sto-parser'

describe('parseSto', () => {
  it('parses well-formed sections with colon and equals key/value separators', () => {
    const setup = parseSto(`
      ; comment
      # another comment
      globalKey: global value

      [Suspension]
      Spring Rate: 120 N/mm
      Damper= 8

      [Tires]
      Pressure: 27.5
      Compound = Soft
    `)

    expect(setup.sections).toEqual({
      General: { globalKey: 'global value' },
      Suspension: { 'Spring Rate': '120 N/mm', Damper: '8' },
      Tires: { Pressure: '27.5', Compound: 'Soft' }
    })
  })

  it('never throws for empty, garbage, null, or undefined input', () => {
    expect(() => parseSto('')).not.toThrow()
    expect(() => parseSto('not a section\nnot key value\n::::')).not.toThrow()
    expect(() => parseSto(null as unknown as string)).not.toThrow()
    expect(() => parseSto(undefined as unknown as string)).not.toThrow()
  })

  it('returns an empty General section for empty, garbage, null, or undefined input', () => {
    expect(parseSto('')).toEqual({ sections: { General: {} } })
    expect(parseSto('not a section\nnot key value\n::::')).toEqual({ sections: { General: {} } })
    expect(parseSto(null as unknown as string)).toEqual({ sections: { General: {} } })
    expect(parseSto(undefined as unknown as string)).toEqual({ sections: { General: {} } })
  })

  it('trims section names, keys, and values while preserving value text after the first separator', () => {
    const setup = parseSto(`
      [  Aero  ]
      Wing Angle :  12:high
      Notes = front=stable
    `)

    expect(setup.sections.Aero).toEqual({
      'Wing Angle': '12:high',
      Notes: 'front=stable'
    })
  })

  it('uses the last value when a key appears more than once in a section', () => {
    const setup = parseSto(`
      [Brake Bias]
      Bias: 54.0
      Bias: 55.5
    `)

    expect(setup.sections['Brake Bias']).toEqual({ Bias: '55.5' })
  })
})

describe('diffSetups', () => {
  it('reports added, removed, and changed keys per section', () => {
    const before = parseSto(`
      [Aero]
      Wing: 10
      Splitter: 3

      [Tires]
      Pressure: 27

      [Obsolete]
      Old: yes
    `)
    const after = parseSto(`
      [Aero]
      Wing: 12
      Gurney: enabled

      [Tires]
      Pressure: 27

      [New Section]
      Fresh: true
    `)

    expect(diffSetups(before, after)).toEqual({
      totalChanges: 5,
      sections: [
        {
          section: 'Aero',
          added: [{ key: 'Gurney', kind: 'added', after: 'enabled' }],
          removed: [{ key: 'Splitter', kind: 'removed', before: '3' }],
          changed: [{ key: 'Wing', kind: 'changed', before: '10', after: '12' }]
        },
        {
          section: 'New Section',
          added: [{ key: 'Fresh', kind: 'added', after: 'true' }],
          removed: [],
          changed: []
        },
        {
          section: 'Obsolete',
          added: [],
          removed: [{ key: 'Old', kind: 'removed', before: 'yes' }],
          changed: []
        }
      ]
    })
  })

  it('returns no section diffs when setups are equivalent', () => {
    const setup = parseSto(`
      [Suspension]
      Toe: 1.0
    `)

    expect(diffSetups(setup, setup)).toEqual({ sections: [], totalChanges: 0 })
  })
})
