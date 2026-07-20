import { describe, expect, it } from 'vitest'
import { invokeSynchronousVerifier } from './authorities'
import { types as utilTypes } from 'node:util'
import { createHook } from 'node:async_hooks'

describe('external verifier return contract', () => {
  const invalidVerifiers: Array<[string, () => unknown]> = [
    ['async false', async () => false],
    ['async rejection', async () => { throw new Error('rejected') }],
    ['resolved true promise', () => Promise.resolve(true)],
    ['custom thenable', () => ({ then: () => undefined })],
    ['truthy object', () => ({})],
    ['truthy string', () => 'true'],
    ['truthy number', () => 1],
    ['false', () => false]
  ]

  it.each(invalidVerifiers)('rejects %s', (_name, verifier) => {
    expect(() =>
      invokeSynchronousVerifier(verifier, undefined, [], 'External verifier')
    ).toThrow(/synchronous verifier function|primitive boolean true/i)
  })

  it('accepts only primitive true', () => {
    expect(() =>
      invokeSynchronousVerifier(() => true, undefined, [], 'External verifier')
    ).not.toThrow()
  })

  it('observes branded rejected Promises without trusting a shadowed catch', async () => {
    const rejected = Promise.reject(new Error('verifier rejected'))
    Object.defineProperty(rejected, 'catch', {
      value: () => Promise.reject(new Error('shadow catch must not run'))
    })
    expect(() =>
      invokeSynchronousVerifier(
        () => rejected,
        undefined,
        [],
        'External verifier'
      )
    ).toThrow(/primitive boolean true/i)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('neutralizes a configurable poisoned Promise constructor before observing rejection', async () => {
    const rejected = Promise.reject(new Error('verifier rejected'))
    let getterInvoked = false
    Object.defineProperty(rejected, 'constructor', {
      configurable: true,
      get: () => {
        getterInvoked = true
        throw new Error('poisoned constructor')
      }
    })
    expect(() =>
      invokeSynchronousVerifier(
        () => rejected,
        undefined,
        [],
        'External verifier'
      )
    ).toThrow(/primitive boolean true/i)
    expect(getterInvoked).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('shadows an inherited poisoned Promise constructor/species chain', async () => {
    const rejected = Promise.reject(new Error('verifier rejected'))
    let getterInvoked = false
    const poisonedPrototype = Object.create(Promise.prototype, {
      constructor: {
        configurable: true,
        get: () => {
          getterInvoked = true
          throw new Error('inherited poisoned constructor')
        }
      }
    })
    Object.setPrototypeOf(rejected, poisonedPrototype)
    expect(() =>
      invokeSynchronousVerifier(
        () => rejected,
        undefined,
        [],
        'External verifier'
      )
    ).toThrow(/primitive boolean true/i)
    expect(getterInvoked).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('observes a non-extensible rejected Promise through safe inherited primordials', async () => {
    const rejected = Promise.reject(new Error('verifier rejected'))
    Object.preventExtensions(rejected)
    expect(() =>
      invokeSynchronousVerifier(
        () => rejected,
        undefined,
        [],
        'External verifier'
      )
    ).toThrow(/primitive boolean true/i)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('neutralizes configurable species behind a non-configurable constructor', async () => {
    const rejected = Promise.reject(new Error('verifier rejected'))
    let speciesInvoked = false
    const constructor = {}
    Object.defineProperty(constructor, Symbol.species, {
      configurable: true,
      get: () => {
        speciesInvoked = true
        throw new Error('poisoned species')
      }
    })
    Object.defineProperty(rejected, 'constructor', {
      configurable: false,
      value: constructor
    })
    expect(() =>
      invokeSynchronousVerifier(
        () => rejected,
        undefined,
        [],
        'External verifier'
      )
    ).toThrow(/primitive boolean true/i)
    expect(speciesInvoked).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('neutralizes inherited species on a non-extensible constructor', async () => {
    const rejected = Promise.reject(new Error('verifier rejected'))
    let speciesInvoked = false
    const constructorPrototype = {}
    Object.defineProperty(constructorPrototype, Symbol.species, {
      configurable: true,
      get: () => {
        speciesInvoked = true
        throw new Error('inherited poisoned species')
      }
    })
    const constructor = Object.create(constructorPrototype)
    Object.preventExtensions(constructor)
    Object.defineProperty(rejected, 'constructor', {
      configurable: false,
      value: constructor
    })
    expect(() =>
      invokeSynchronousVerifier(
        () => rejected,
        undefined,
        [],
        'External verifier'
      )
    ).toThrow(/primitive boolean true/i)
    expect(speciesInvoked).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('replaces configurable inherited primitive constructors before observation', async () => {
    const rejected = Promise.reject(new Error('verifier rejected'))
    const poisonedPrototype = Object.create(Promise.prototype, {
      constructor: {
        configurable: true,
        value: 1
      }
    })
    Object.setPrototypeOf(rejected, poisonedPrototype)
    Object.preventExtensions(rejected)
    expect(() =>
      invokeSynchronousVerifier(
        () => rejected,
        undefined,
        [],
        'External verifier'
      )
    ).toThrow(/primitive boolean true/i)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('observes a constructorless null-prototype native Promise', async () => {
    const rejected = Promise.reject(new Error('verifier rejected'))
    Object.setPrototypeOf(rejected, null)
    Object.preventExtensions(rejected)
    expect(() =>
      invokeSynchronousVerifier(
        () => rejected,
        undefined,
        [],
        'External verifier'
      )
    ).toThrow(/primitive boolean true/i)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('shadows inherited non-configurable constructors on extensible Promises', async () => {
    const rejected = Promise.reject(new Error('verifier rejected'))
    const poisonedPrototype = Object.create(Promise.prototype, {
      constructor: {
        configurable: false,
        value: 1
      }
    })
    Object.setPrototypeOf(rejected, poisonedPrototype)
    expect(() =>
      invokeSynchronousVerifier(
        () => rejected,
        undefined,
        [],
        'External verifier'
      )
    ).toThrow(/primitive boolean true/i)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('bypasses non-configurable poisoned species behind an inherited configurable constructor', async () => {
    const rejected = Promise.reject(new Error('verifier rejected'))
    let speciesInvoked = false
    const constructor = {}
    Object.defineProperty(constructor, Symbol.species, {
      configurable: false,
      get: () => {
        speciesInvoked = true
        throw new Error('non-configurable poisoned species')
      }
    })
    const poisonedPrototype = Object.create(Promise.prototype, {
      constructor: {
        configurable: true,
        value: constructor
      }
    })
    Object.setPrototypeOf(rejected, poisonedPrototype)
    Object.preventExtensions(rejected)
    expect(() =>
      invokeSynchronousVerifier(
        () => rejected,
        undefined,
        [],
        'External verifier'
      )
    ).toThrow(/primitive boolean true/i)
    expect(speciesInvoked).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('detects AsyncFunction despite a spoofed toStringTag before execution', () => {
    let executed = false
    const verifier = async () => {
      executed = true
      return false
    }
    Object.defineProperty(verifier, Symbol.toStringTag, {
      configurable: true,
      value: 'Function'
    })
    expect(() =>
      invokeSynchronousVerifier(verifier, undefined, [], 'External verifier')
    ).toThrow(/synchronous verifier function/i)
    expect(executed).toBe(false)
  })

  it('rejects bound and proxied async verifiers before execution', () => {
    let boundExecuted = false
    const bound = (async () => {
      boundExecuted = true
      return false
    }).bind(undefined)
    let proxiedExecuted = false
    const proxied = new Proxy(async () => {
      proxiedExecuted = true
      return false
    }, {})
    expect(() =>
      invokeSynchronousVerifier(bound, undefined, [], 'Bound verifier')
    ).toThrow(/synchronous verifier function/i)
    expect(() =>
      invokeSynchronousVerifier(proxied, undefined, [], 'Proxied verifier')
    ).toThrow(/synchronous verifier function/i)
    expect(boundExecuted).toBe(false)
    expect(proxiedExecuted).toBe(false)
  })

  it('uses captured verifier and Promise primordials after global poisoning', async () => {
    const originalIsAsyncFunction = utilTypes.isAsyncFunction
    const originalIsPromise = utilTypes.isPromise
    const thenDescriptor = Object.getOwnPropertyDescriptor(
      Promise.prototype.then,
      'call'
    )
    const mutableTypes = utilTypes as unknown as Record<string, unknown>
    try {
      mutableTypes.isAsyncFunction = () => false
      mutableTypes.isPromise = () => false
      Object.defineProperty(Promise.prototype.then, 'call', {
        configurable: true,
        value: () => {
          throw new Error('poisoned call')
        }
      })

      const rejected = Promise.reject(new Error('verifier rejected'))
      expect(() =>
        invokeSynchronousVerifier(
          () => rejected,
          undefined,
          [],
          'External verifier'
        )
      ).toThrow(/primitive boolean true/i)
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      mutableTypes.isAsyncFunction = originalIsAsyncFunction
      mutableTypes.isPromise = originalIsPromise
      if (thenDescriptor) {
        Object.defineProperty(Promise.prototype.then, 'call', thenDescriptor)
      } else {
        delete (Promise.prototype.then as { call?: unknown }).call
      }
    }
  })

  it('uses captured String.includes when rejecting wrapped async functions', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      String.prototype,
      'includes'
    )!
    let executed = false
    const verifier = (async () => {
      executed = true
      return false
    }).bind(undefined)
    try {
      Object.defineProperty(String.prototype, 'includes', {
        configurable: true,
        value: () => false
      })
      expect(() =>
        invokeSynchronousVerifier(
          verifier,
          undefined,
          [],
          'External verifier'
        )
      ).toThrow(/synchronous verifier function/i)
      expect(executed).toBe(false)
    } finally {
      Object.defineProperty(String.prototype, 'includes', descriptor)
    }
  })

  it('does not mutate Promise.prototype constructor while observing rejection', async () => {
    const observations: boolean[] = []
    const constructorDescriptor = Object.getOwnPropertyDescriptor(
      Promise.prototype,
      'constructor'
    )
    const hook = createHook({
      init: (_id, type, _trigger, resource) => {
        if (type === 'PROMISE') {
          observations.push(
            Promise.prototype.constructor === Promise &&
              (resource as { constructor?: unknown }).constructor === Promise
          )
        }
      }
    })
    hook.enable()
    const rejected = Promise.reject(new Error('verifier rejected'))
    Object.preventExtensions(rejected)
    expect(() =>
      invokeSynchronousVerifier(
        () => rejected,
        undefined,
        [],
        'External verifier'
      )
    ).toThrow(/primitive boolean true/i)
    hook.disable()
    expect(observations.length).toBeGreaterThan(0)
    expect(observations.every(Boolean)).toBe(true)
    expect(
      Object.getOwnPropertyDescriptor(Promise.prototype, 'constructor')
    ).toEqual(constructorDescriptor)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('rejects arbitrary thenables without invoking attacker code', () => {
    let invoked = false
    const thenable = {
      then: () => {
        invoked = true
        return Promise.reject(new Error('must not be created'))
      }
    }
    expect(() =>
      invokeSynchronousVerifier(
        () => thenable,
        undefined,
        [],
        'External verifier'
      )
    ).toThrow(/primitive boolean true/i)
    expect(invoked).toBe(false)
  })
})
