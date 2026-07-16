export type DeepReadonly<T> =
  T extends (...args: infer Args) => infer Result
    ? (...args: Args) => Result
    : T extends readonly (infer Item)[]
      ? readonly DeepReadonly<Item>[]
      : T extends object
        ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
        : T

export function deepFreeze<T>(value: T): DeepReadonly<T> {
  const seen = new WeakSet<object>()

  function freeze(node: unknown): void {
    if ((typeof node !== 'object' && typeof node !== 'function') || node === null) {
      return
    }
    const object = node as object
    if (seen.has(object)) return
    seen.add(object)

    for (const key of Reflect.ownKeys(object)) {
      freeze((object as Record<PropertyKey, unknown>)[key])
    }
    Object.freeze(object)
  }

  freeze(value)
  return value as DeepReadonly<T>
}

export function freezeArrayCopy<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values])
}
