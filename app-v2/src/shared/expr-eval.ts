import type { ExpressionScope, ExpressionValue } from './expr'

type TokenType = 'number' | 'string' | 'identifier' | 'operator' | 'paren' | 'comma' | 'question' | 'colon' | 'eof'

interface Token {
  type: TokenType
  value: string
  pos: number
  end?: number
}

type UnaryOp = '+' | '-' | '!'
type BinaryOp = '+' | '-' | '*' | '/' | '%' | '>' | '<' | '>=' | '<=' | '==' | '!=' | '&&' | '||'

type ExprNode =
  | { type: 'literal'; value: ExpressionValue }
  | { type: 'variable'; name: string; pos: number }
  | { type: 'unary'; op: UnaryOp; expr: ExprNode; pos: number }
  | { type: 'binary'; op: BinaryOp; left: ExprNode; right: ExprNode; pos: number }
  | { type: 'ternary'; condition: ExprNode; whenTrue: ExprNode; whenFalse: ExprNode; pos: number }
  | { type: 'call'; name: string; args: ExprNode[]; pos: number }

const BINARY_BINDING_POWER: Record<BinaryOp, number> = {
  '||': 2,
  '&&': 4,
  '==': 6,
  '!=': 6,
  '>': 8,
  '<': 8,
  '>=': 8,
  '<=': 8,
  '+': 10,
  '-': 10,
  '*': 12,
  '/': 12,
  '%': 12
}

const FUNCTIONS: Record<string, (args: ExpressionValue[], pos: number) => ExpressionValue> = {
  min: (args, pos) => Math.min(...expectArgCount('min', args, pos, 1, Infinity).map((value) => asNumber(value, pos))),
  max: (args, pos) => Math.max(...expectArgCount('max', args, pos, 1, Infinity).map((value) => asNumber(value, pos))),
  abs: (args, pos) => Math.abs(asNumber(expectArgCount('abs', args, pos, 1)[0], pos)),
  round: (args, pos) => {
    const [val, decimals] = expectArgCount('round', args, pos, 1, 2)
    const n = asNumber(val, pos)
    if (decimals !== undefined) {
      const d = Math.max(0, Math.round(asNumber(decimals, pos)))
      return parseFloat(n.toFixed(d))
    }
    return Math.round(n)
  },
  floor: (args, pos) => Math.floor(asNumber(expectArgCount('floor', args, pos, 1)[0], pos)),
  ceil: (args, pos) => Math.ceil(asNumber(expectArgCount('ceil', args, pos, 1)[0], pos)),
  dashboard: (args, pos) => {
    const [name] = expectArgCount('dashboard', args, pos, 1)
    if (typeof name !== 'string' || !name.trim()) throw new ExpressionError('Função dashboard espera o nome do dashboard', pos)
    return name
  },
  clamp: (args, pos) => {
    const [value, min, max] = expectArgCount('clamp', args, pos, 3).map((item) => asNumber(item, pos))
    return Math.min(Math.max(value, min), max)
  },
  // ── Logic / flow ─────────────────────────────────────────────────────────────
  if: (args, pos) => {
    const [condition, thenVal, elseVal] = expectArgCount('if', args, pos, 3)
    return toBoolean(condition) ? thenVal : elseVal
  },
  iif: (args, pos) => {
    const [condition, thenVal, elseVal] = expectArgCount('iif', args, pos, 3)
    return toBoolean(condition) ? thenVal : elseVal
  },
  not: (args, pos) => {
    const [val] = expectArgCount('not', args, pos, 1)
    return !toBoolean(val)
  },
  coalesce: (args, pos) => {
    if (args.length === 0) throw new ExpressionError('coalesce requer ao menos 1 argumento', pos)
    for (const arg of args) {
      if (arg !== null && arg !== undefined) return arg
    }
    return null
  },
  // switch(value, case1, result1, case2, result2, ..., default) — even arg count ≥ 4.
  switch: (args, pos) => {
    if (args.length < 4 || args.length % 2 !== 0) throw new ExpressionError('switch requer valor + pares case/result + default', pos)
    const subject = args[0]
    for (let i = 1; i < args.length - 1; i += 2) {
      if (args[i] === subject) return args[i + 1]
    }
    return args[args.length - 1]
  },
  between: (args, pos) => {
    const [val, lo, hi] = expectArgCount('between', args, pos, 3).map((v) => asNumber(v, pos))
    return val >= lo && val <= hi
  },
  // ── Arithmetic ───────────────────────────────────────────────────────────────
  pow: (args, pos) => {
    const [base, exp] = expectArgCount('pow', args, pos, 2).map((v) => asNumber(v, pos))
    return Math.pow(base, exp)
  },
  sqrt: (args, pos) => {
    const [val] = expectArgCount('sqrt', args, pos, 1)
    const n = asNumber(val, pos)
    if (n < 0) throw new ExpressionError('sqrt requer número não negativo', pos)
    return Math.sqrt(n)
  },
  sign: (args, pos) => {
    const n = asNumber(expectArgCount('sign', args, pos, 1)[0], pos)
    return n > 0 ? 1 : n < 0 ? -1 : 0
  },
  log: (args, pos) => {
    const n = asNumber(expectArgCount('log', args, pos, 1)[0], pos)
    if (n <= 0) throw new ExpressionError('log requer número positivo', pos)
    return Math.log(n)
  },
  // ── String ───────────────────────────────────────────────────────────────────
  str: (args, pos) => {
    const [val] = expectArgCount('str', args, pos, 1)
    if (val === null || val === undefined) return ''
    return String(val)
  },
  len: (args, pos) => {
    const [val] = expectArgCount('len', args, pos, 1)
    if (typeof val !== 'string') throw new ExpressionError('len requer string', pos)
    return val.length
  },
  contains: (args, pos) => {
    const [haystack, needle] = expectArgCount('contains', args, pos, 2)
    if (typeof haystack !== 'string' || typeof needle !== 'string') throw new ExpressionError('contains requer duas strings', pos)
    return haystack.includes(needle)
  },
  startswith: (args, pos) => {
    const [str, prefix] = expectArgCount('startswith', args, pos, 2)
    if (typeof str !== 'string' || typeof prefix !== 'string') throw new ExpressionError('startswith requer duas strings', pos)
    return str.startsWith(prefix)
  },
  endswith: (args, pos) => {
    const [str, suffix] = expectArgCount('endswith', args, pos, 2)
    if (typeof str !== 'string' || typeof suffix !== 'string') throw new ExpressionError('endswith requer duas strings', pos)
    return str.endsWith(suffix)
  },
  // ── Formatting ───────────────────────────────────────────────────────────────
  // format(val, decimals|"F1"|"N2"|"P0") — SimHub-style .NET format specifiers.
  format: (args, pos) => {
    const [val, spec] = expectArgCount('format', args, pos, 2)
    const n = asNumber(val, pos)
    if (typeof spec === 'number') return n.toFixed(Math.max(0, Math.round(spec)))
    if (typeof spec !== 'string') throw new ExpressionError('format: especificador deve ser número ou string', pos)
    const match = /^([FNPfnp])(\d+)$/.exec(spec)
    if (!match) throw new ExpressionError(`format: especificador desconhecido "${spec}"`, pos)
    const decimals = parseInt(match[2], 10)
    if (match[1].toUpperCase() === 'P') return `${(n * 100).toFixed(decimals)}%`
    return n.toFixed(decimals)
  },
  // formattime(secs[, showMs]) → "M:SS" or "M:SS.f"
  formattime: (args, pos) => {
    if (args.length < 1 || args.length > 2) throw new ExpressionError('formattime espera 1 ou 2 argumentos', pos)
    const secs = asNumber(args[0], pos)
    const showMs = args.length > 1 ? toBoolean(args[1]) : false
    const sign = secs < 0 ? '-' : ''
    const abs = Math.abs(secs)
    const mins = Math.floor(abs / 60)
    const wholeSecs = Math.floor(abs % 60)
    const pad = String(wholeSecs).padStart(2, '0')
    if (showMs) return `${sign}${mins}:${pad}.${Math.floor((abs % 1) * 10)}`
    return `${sign}${mins}:${pad}`
  }
}

export class ExpressionError extends Error {
  constructor(message: string, readonly pos?: number) {
    super(pos === undefined ? message : `${message} (posição ${pos + 1})`)
    this.name = 'ExpressionError'
  }
}

export function evaluateExpression(expr: string, scope: ExpressionScope = {}): ExpressionValue {
  const parser = new Parser(tokenize(expr))
  return evaluate(parser.parse(), scope)
}

export function flattenExpressionScope(input: unknown): ExpressionScope {
  const scope: ExpressionScope = {}
  appendScope(scope, '', input, 0)
  return scope
}

function appendScope(scope: ExpressionScope, prefix: string, input: unknown, depth: number): void {
  if (input === undefined) return
  if (input === null || typeof input === 'number' || typeof input === 'boolean' || typeof input === 'string') {
    if (prefix) scope[prefix] = input
    return
  }
  if (Array.isArray(input) || typeof input !== 'object' || depth > 6) return

  for (const [key, value] of Object.entries(input)) {
    const nextKey = prefix ? `${prefix}.${key}` : key
    appendScope(scope, nextKey, value, depth + 1)
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < source.length) {
    const char = source[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }

    if (/\d/.test(char) || (char === '.' && /\d/.test(source[index + 1] ?? ''))) {
      tokens.push(readNumber(source, index))
      index = tokens[tokens.length - 1].pos + tokens[tokens.length - 1].value.length
      continue
    }

    if (char === '"' || char === "'") {
      const token = readString(source, index)
      tokens.push(token)
      index = token.end ?? token.pos + token.value.length + 2
      continue
    }

    if (/[A-Za-z_$]/.test(char)) {
      const token = readIdentifier(source, index)
      tokens.push(token)
      index = token.pos + token.value.length
      continue
    }

    const two = source.slice(index, index + 2)
    if (['>=', '<=', '==', '!=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'operator', value: two, pos: index })
      index += 2
      continue
    }

    if (['+', '-', '*', '/', '%', '>', '<', '!'].includes(char)) tokens.push({ type: 'operator', value: char, pos: index })
    else if (char === '(' || char === ')') tokens.push({ type: 'paren', value: char, pos: index })
    else if (char === ',') tokens.push({ type: 'comma', value: char, pos: index })
    else if (char === '?') tokens.push({ type: 'question', value: char, pos: index })
    else if (char === ':') tokens.push({ type: 'colon', value: char, pos: index })
    else throw new ExpressionError(`Caractere inválido "${char}"`, index)
    index += 1
  }

  tokens.push({ type: 'eof', value: '', pos: source.length })
  return tokens
}

function readNumber(source: string, start: number): Token {
  let index = start
  while (/\d/.test(source[index] ?? '')) index += 1
  if (source[index] === '.') {
    index += 1
    while (/\d/.test(source[index] ?? '')) index += 1
  }
  if ((source[index] === 'e' || source[index] === 'E') && /[+-]?\d/.test(source.slice(index + 1, index + 3))) {
    index += 1
    if (source[index] === '+' || source[index] === '-') index += 1
    while (/\d/.test(source[index] ?? '')) index += 1
  }
  return { type: 'number', value: source.slice(start, index), pos: start }
}

function readString(source: string, start: number): Token {
  const quote = source[start]
  let value = ''
  let index = start + 1
  while (index < source.length) {
    const char = source[index]
    if (char === quote) return { type: 'string', value, pos: start, end: index + 1 }
    if (char === '\\') {
      const escaped = source[index + 1]
      if (escaped === undefined) throw new ExpressionError('String sem fechamento', start)
      value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped
      index += 2
      continue
    }
    value += char
    index += 1
  }
  throw new ExpressionError('String sem fechamento', start)
}

function readIdentifier(source: string, start: number): Token {
  let index = start + 1
  while (/[\w$]/.test(source[index] ?? '')) index += 1
  while (source[index] === '.' && /[A-Za-z_$]/.test(source[index + 1] ?? '')) {
    index += 2
    while (/[\w$]/.test(source[index] ?? '')) index += 1
  }
  return { type: 'identifier', value: source.slice(start, index), pos: start }
}

class Parser {
  private index = 0

  constructor(private readonly tokens: Token[]) {}

  parse(): ExprNode {
    const expr = this.parseExpression(0)
    if (this.peek().type !== 'eof') throw new ExpressionError(`Token inesperado "${this.peek().value}"`, this.peek().pos)
    return expr
  }

  private parseExpression(minBindingPower: number): ExprNode {
    let left = this.parsePrefix()

    while (true) {
      const token = this.peek()
      if (token.type === 'question') {
        if (minBindingPower > 1) break
        this.advance()
        const whenTrue = this.parseExpression(0)
        this.expect('colon', ':')
        const whenFalse = this.parseExpression(1)
        left = { type: 'ternary', condition: left, whenTrue, whenFalse, pos: token.pos }
        continue
      }

      if (token.type !== 'operator' || !isBinaryOp(token.value)) break
      const bindingPower = BINARY_BINDING_POWER[token.value]
      if (bindingPower < minBindingPower) break
      this.advance()
      const right = this.parseExpression(bindingPower + 1)
      left = { type: 'binary', op: token.value, left, right, pos: token.pos }
    }

    return left
  }

  private parsePrefix(): ExprNode {
    const token = this.advance()

    if (token.type === 'number') {
      const value = Number(token.value)
      if (!Number.isFinite(value)) throw new ExpressionError(`Número inválido "${token.value}"`, token.pos)
      return { type: 'literal', value }
    }

    if (token.type === 'string') return { type: 'literal', value: token.value }

    if (token.type === 'identifier') {
      if (token.value === 'true') return { type: 'literal', value: true }
      if (token.value === 'false') return { type: 'literal', value: false }
      if (token.value === 'null') return { type: 'literal', value: null }
      if (this.peek().type === 'paren' && this.peek().value === '(') return this.parseCall(token)
      return { type: 'variable', name: token.value, pos: token.pos }
    }

    if (token.type === 'operator' && isUnaryOp(token.value)) {
      return { type: 'unary', op: token.value, expr: this.parseExpression(14), pos: token.pos }
    }

    if (token.type === 'paren' && token.value === '(') {
      const expr = this.parseExpression(0)
      this.expect('paren', ')')
      return expr
    }

    throw new ExpressionError(`Expressão esperada, encontrado "${token.value || 'fim'}"`, token.pos)
  }

  private parseCall(nameToken: Token): ExprNode {
    this.expect('paren', '(')
    const args: ExprNode[] = []
    if (this.peek().type === 'paren' && this.peek().value === ')') {
      this.advance()
      return { type: 'call', name: nameToken.value, args, pos: nameToken.pos }
    }
    do {
      args.push(this.parseExpression(0))
      if (this.peek().type !== 'comma') break
      this.advance()
    } while (true)
    this.expect('paren', ')')
    return { type: 'call', name: nameToken.value, args, pos: nameToken.pos }
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.advance()
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw new ExpressionError(`Esperado "${value ?? type}", encontrado "${token.value || 'fim'}"`, token.pos)
    }
    return token
  }

  private peek(): Token {
    return this.tokens[this.index]
  }

  private advance(): Token {
    return this.tokens[this.index++]
  }
}

function evaluate(node: ExprNode, scope: ExpressionScope): ExpressionValue {
  switch (node.type) {
    case 'literal':
      return node.value
    case 'variable':
      if (!Object.prototype.hasOwnProperty.call(scope, node.name)) throw new ExpressionError(`Variável desconhecida "${node.name}"`, node.pos)
      return scope[node.name] ?? null
    case 'unary':
      return evaluateUnary(node.op, evaluate(node.expr, scope), node.pos)
    case 'binary':
      return evaluateBinary(node.op, node.left, node.right, scope, node.pos)
    case 'ternary':
      return toBoolean(evaluate(node.condition, scope)) ? evaluate(node.whenTrue, scope) : evaluate(node.whenFalse, scope)
    case 'call': {
      const fn = FUNCTIONS[node.name]
      if (!fn) throw new ExpressionError(`Função desconhecida "${node.name}"`, node.pos)
      return fn(node.args.map((arg) => evaluate(arg, scope)), node.pos)
    }
  }
}

function evaluateUnary(op: UnaryOp, value: ExpressionValue, pos: number): ExpressionValue {
  if (op === '+') return asNumber(value, pos)
  if (op === '-') return -asNumber(value, pos)
  return !toBoolean(value)
}

function evaluateBinary(op: BinaryOp, leftNode: ExprNode, rightNode: ExprNode, scope: ExpressionScope, pos: number): ExpressionValue {
  if (op === '&&') return toBoolean(evaluate(leftNode, scope)) && toBoolean(evaluate(rightNode, scope))
  if (op === '||') return toBoolean(evaluate(leftNode, scope)) || toBoolean(evaluate(rightNode, scope))

  const left = evaluate(leftNode, scope)
  const right = evaluate(rightNode, scope)

  if (op === '==') return left === right
  if (op === '!=') return left !== right
  if (op === '>') return compare(left, right, pos) > 0
  if (op === '<') return compare(left, right, pos) < 0
  if (op === '>=') return compare(left, right, pos) >= 0
  if (op === '<=') return compare(left, right, pos) <= 0

  const leftNumber = asNumber(left, pos)
  const rightNumber = asNumber(right, pos)
  if ((op === '/' || op === '%') && rightNumber === 0) throw new ExpressionError('Divisão por zero', pos)
  if (op === '+') return leftNumber + rightNumber
  if (op === '-') return leftNumber - rightNumber
  if (op === '*') return leftNumber * rightNumber
  if (op === '/') return leftNumber / rightNumber
  return leftNumber % rightNumber
}

function compare(left: ExpressionValue, right: ExpressionValue, pos: number): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'string' && typeof right === 'string') return left.localeCompare(right)
  throw new ExpressionError('Comparação requer dois números ou duas strings', pos)
}

function asNumber(value: ExpressionValue, pos: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ExpressionError('Operação requer número', pos)
  return value
}

function toBoolean(value: ExpressionValue): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value.length > 0
  return false
}

function expectArgCount(name: string, args: ExpressionValue[], pos: number, min: number, max = min): ExpressionValue[] {
  if (args.length < min || args.length > max) {
    const expected = min === max ? String(min) : `${min}+`
    throw new ExpressionError(`Função ${name} espera ${expected} argumento(s), recebeu ${args.length}`, pos)
  }
  return args
}

function isBinaryOp(value: string): value is BinaryOp {
  return Object.prototype.hasOwnProperty.call(BINARY_BINDING_POWER, value)
}

function isUnaryOp(value: string): value is UnaryOp {
  return value === '+' || value === '-' || value === '!'
}
