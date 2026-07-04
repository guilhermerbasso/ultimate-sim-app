import { describe, expect, it } from 'vitest'
import { evaluateExpression, ExpressionError } from './expr-eval'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ev(expr: string, scope: Record<string, unknown> = {}): unknown {
  return evaluateExpression(expr, scope as any)
}

// ─── Existing functions (regression) ─────────────────────────────────────────

describe('existing arithmetic functions', () => {
  it('min/max/abs/round/floor/ceil/clamp', () => {
    expect(ev('min(3, 1, 2)')).toBe(1)
    expect(ev('max(3, 1, 2)')).toBe(3)
    expect(ev('abs(-5)')).toBe(5)
    expect(ev('round(3.6)')).toBe(4)
    expect(ev('floor(3.9)')).toBe(3)
    expect(ev('ceil(3.1)')).toBe(4)
    expect(ev('clamp(5, 0, 3)')).toBe(3)
  })
})

// ─── New arithmetic functions ─────────────────────────────────────────────────

describe('pow / sqrt / sign / log', () => {
  it('pow(2, 10) = 1024', () => {
    expect(ev('pow(2, 10)')).toBe(1024)
  })
  it('sqrt(9) = 3', () => {
    expect(ev('sqrt(9)')).toBe(3)
  })
  it('sqrt of negative throws', () => {
    expect(() => ev('sqrt(-1)')).toThrow(ExpressionError)
  })
  it('sign(-5) = -1, sign(0) = 0, sign(3) = 1', () => {
    expect(ev('sign(-5)')).toBe(-1)
    expect(ev('sign(0)')).toBe(0)
    expect(ev('sign(3)')).toBe(1)
  })
  it('log(1) = 0', () => {
    expect(ev('log(1)')).toBe(0)
  })
  it('log of 0 throws', () => {
    expect(() => ev('log(0)')).toThrow(ExpressionError)
  })
})

// ─── round with decimals ──────────────────────────────────────────────────────

describe('round with second argument', () => {
  it('round(3.14159, 2) = 3.14', () => {
    expect(ev('round(3.14159, 2)')).toBeCloseTo(3.14)
  })
  it('round(3.14159) = 3 (no decimals)', () => {
    expect(ev('round(3.14159)')).toBe(3)
  })
})

// ─── Logic / flow ─────────────────────────────────────────────────────────────

describe('if / iif', () => {
  it('if(true, 1, 2) = 1', () => {
    expect(ev('if(true, 1, 2)')).toBe(1)
  })
  it('if(false, 1, 2) = 2', () => {
    expect(ev('if(false, 1, 2)')).toBe(2)
  })
  it('iif(1 > 0, "yes", "no") = "yes"', () => {
    expect(ev('iif(1 > 0, "yes", "no")')).toBe('yes')
  })
  it('if uses scope variable', () => {
    expect(ev('if(speed > 100, "fast", "slow")', { speed: 150 })).toBe('fast')
    expect(ev('if(speed > 100, "fast", "slow")', { speed: 50 })).toBe('slow')
  })
})

describe('not', () => {
  it('not(false) = true', () => {
    expect(ev('not(false)')).toBe(true)
  })
  it('not(1) = false', () => {
    expect(ev('not(1)')).toBe(false)
  })
})

describe('coalesce', () => {
  it('returns first non-null', () => {
    expect(ev('coalesce(null, null, 3)')).toBe(3)
  })
  it('returns first value when truthy', () => {
    expect(ev('coalesce(0, 1, 2)')).toBe(0)
  })
  it('all null → null', () => {
    expect(ev('coalesce(null)')).toBe(null)
  })
})

describe('switch', () => {
  it('matches first case', () => {
    expect(ev('switch(gear, 1, "first", 2, "second", "other")', { gear: 1 })).toBe('first')
  })
  it('matches second case', () => {
    expect(ev('switch(gear, 1, "first", 2, "second", "other")', { gear: 2 })).toBe('second')
  })
  it('falls through to default', () => {
    expect(ev('switch(gear, 1, "first", 2, "second", "other")', { gear: 3 })).toBe('other')
  })
  it('throws on invalid argument count', () => {
    expect(() => ev('switch(1, 2)')).toThrow(ExpressionError)
  })
})

// ─── String functions ─────────────────────────────────────────────────────────

describe('str', () => {
  it('str(42) = "42"', () => {
    expect(ev('str(42)')).toBe('42')
  })
  it('str(null) = ""', () => {
    expect(ev('str(null)')).toBe('')
  })
  it('str(true) = "true"', () => {
    expect(ev('str(true)')).toBe('true')
  })
})

describe('len', () => {
  it('len("hello") = 5', () => {
    expect(ev('len("hello")')).toBe(5)
  })
  it('len of non-string throws', () => {
    expect(() => ev('len(42)')).toThrow(ExpressionError)
  })
})

describe('contains', () => {
  it('contains("hello world", "world") = true', () => {
    expect(ev('contains("hello world", "world")')).toBe(true)
  })
  it('contains("hello", "xyz") = false', () => {
    expect(ev('contains("hello", "xyz")')).toBe(false)
  })
  it('throws when not strings', () => {
    expect(() => ev('contains(42, "x")')).toThrow(ExpressionError)
  })
})

describe('startswith / endswith', () => {
  it('startswith("Porsche", "Por") = true', () => {
    expect(ev('startswith("Porsche", "Por")')).toBe(true)
  })
  it('startswith("Porsche", "BMW") = false', () => {
    expect(ev('startswith("Porsche", "BMW")')).toBe(false)
  })
  it('endswith("Porsche 911", "911") = true', () => {
    expect(ev('endswith("Porsche 911", "911")')).toBe(true)
  })
  it('endswith("Porsche 911", "GT3") = false', () => {
    expect(ev('endswith("Porsche 911", "GT3")')).toBe(false)
  })
})

// ─── Formatting ───────────────────────────────────────────────────────────────

describe('format', () => {
  it('format(3.14159, 2) = "3.14"', () => {
    expect(ev('format(3.14159, 2)')).toBe('3.14')
  })
  it('format(3.14159, 0) = "3"', () => {
    expect(ev('format(3.14159, 0)')).toBe('3')
  })
  it('format(3.14159, "F1") = "3.1"', () => {
    expect(ev('format(3.14159, "F1")')).toBe('3.1')
  })
  it('format(3.14159, "N2") = "3.14"', () => {
    expect(ev('format(3.14159, "N2")')).toBe('3.14')
  })
  it('format(0.75, "P0") = "75%"', () => {
    expect(ev('format(0.75, "P0")')).toBe('75%')
  })
  it('throws on unknown format string', () => {
    expect(() => ev('format(1.23, "ZZ")')).toThrow(ExpressionError)
  })
})

describe('formattime', () => {
  it('formattime(90) = "1:30"', () => {
    expect(ev('formattime(90)')).toBe('1:30')
  })
  it('formattime(65.5) = "1:05"', () => {
    expect(ev('formattime(65.5)')).toBe('1:05')
  })
  it('formattime(65.5, true) includes decimals', () => {
    expect(ev('formattime(65.5, true)')).toBe('1:05.5')
  })
  it('formattime(0) = "0:00"', () => {
    expect(ev('formattime(0)')).toBe('0:00')
  })
  it('formattime(-5) returns negative time', () => {
    expect(ev('formattime(-5)')).toBe('-0:05')
  })
})

// ─── between ─────────────────────────────────────────────────────────────────

describe('between', () => {
  it('between(5, 1, 10) = true', () => {
    expect(ev('between(5, 1, 10)')).toBe(true)
  })
  it('between(0, 1, 10) = false', () => {
    expect(ev('between(0, 1, 10)')).toBe(false)
  })
  it('between(10, 1, 10) = true (inclusive)', () => {
    expect(ev('between(10, 1, 10)')).toBe(true)
  })
})

// ─── Real-world SimHub-style expressions ─────────────────────────────────────

describe('composite SimHub-style expressions', () => {
  it('lap time display: formattime(currentLapTimeSec)', () => {
    expect(ev('formattime(currentLapTimeSec)', { currentLapTimeSec: 75.3 })).toBe('1:15')
  })

  it('fuel warning: if(fuelLiters < 3, "LOW FUEL!", format(fuelLiters, 1))', () => {
    expect(ev('if(fuelLiters < 3, "LOW FUEL!", format(fuelLiters, 1))', { fuelLiters: 2 })).toBe('LOW FUEL!')
    expect(ev('if(fuelLiters < 3, "LOW FUEL!", format(fuelLiters, 1))', { fuelLiters: 5.5 })).toBe('5.5')
  })

  it('car name check: startswith(carName, "Ferrari")', () => {
    expect(ev('startswith(carName, "Ferrari")', { carName: 'Ferrari 296 GT3' })).toBe(true)
    expect(ev('startswith(carName, "Ferrari")', { carName: 'Porsche 911' })).toBe(false)
  })

  it('gear display: switch(gear, -1, "R", 0, "N", str(gear))', () => {
    expect(ev('switch(gear, -1, "R", 0, "N", str(gear))', { gear: -1 })).toBe('R')
    expect(ev('switch(gear, -1, "R", 0, "N", str(gear))', { gear: 0 })).toBe('N')
    expect(ev('switch(gear, -1, "R", 0, "N", str(gear))', { gear: 3 })).toBe('3')
  })

  it('position display with coalesce', () => {
    expect(ev('coalesce(position, 0)', { position: null })).toBe(0)
    expect(ev('coalesce(position, 0)', { position: 3 })).toBe(3)
  })
})
