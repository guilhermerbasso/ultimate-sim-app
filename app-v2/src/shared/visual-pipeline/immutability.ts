export type DeepReadonly<T> =
  T extends (...args: infer _Arguments) => infer _Result
    ? T
    : T extends readonly []
      ? readonly []
      : T extends readonly [unknown, ...unknown[]]
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T extends ReadonlyArray<infer Item>
          ? ReadonlyArray<DeepReadonly<Item>>
          : T extends object
            ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
            : T

function freezeValue(value: unknown, seen: WeakSet<object>): void {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) return

  const target = value as object
  if (seen.has(target)) return
  seen.add(target)

  for (const key of Reflect.ownKeys(target)) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key)
    if (descriptor && 'value' in descriptor) freezeValue(descriptor.value, seen)
  }
  if (!Object.isFrozen(target)) Object.freeze(target)
}

export function deepFreeze<const T>(value: T): DeepReadonly<T> {
  freezeValue(value, new WeakSet<object>())
  return value as DeepReadonly<T>
}

export function freezeArrayCopy<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values])
}

export function freezeTuple<const Values extends readonly unknown[]>(
  values: Values
): Values {
  return Object.freeze(values) as Values
}
