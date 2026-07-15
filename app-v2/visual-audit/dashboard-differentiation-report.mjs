import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function usage() {
  console.log(`Dashboard differentiation report

Usage:
  node visual-audit/dashboard-differentiation-report.mjs [options]

Options:
  --candidate <id>          Compare one candidate id (repeatable)
  --candidates <id,id,...>  Compare a comma-separated candidate id set
  --perceptual <path>       Pair-scoped eight-state perceptual evidence JSON
  --out <path>              Write JSON to a file instead of stdout
  --help                    Show this help
`)
}

function valueAfter(args, index, flag) {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`)
  return value
}

function parseArgs(args) {
  const candidates = []
  let out = null
  let perceptual = null
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help') return { help: true, candidates, out }
    if (arg === '--candidate') {
      candidates.push(valueAfter(args, index, arg))
      index += 1
      continue
    }
    if (arg.startsWith('--candidate=')) {
      candidates.push(arg.slice('--candidate='.length))
      continue
    }
    if (arg === '--candidates') {
      candidates.push(...valueAfter(args, index, arg).split(','))
      index += 1
      continue
    }
    if (arg.startsWith('--candidates=')) {
      candidates.push(...arg.slice('--candidates='.length).split(','))
      continue
    }
    if (arg === '--out') {
      out = valueAfter(args, index, arg)
      index += 1
      continue
    }
    if (arg === '--perceptual') {
      perceptual = valueAfter(args, index, arg)
      index += 1
      continue
    }
    if (arg.startsWith('--perceptual=')) {
      perceptual = arg.slice('--perceptual='.length)
      continue
    }
    if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length)
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  const normalizedCandidates = candidates.map((id) => id.trim())
  if (normalizedCandidates.some((id) => id.length === 0)) {
    throw new Error('Candidate ids must not be empty.')
  }
  if (out !== null && out.trim().length === 0) throw new Error('--out must not be empty.')
  if (perceptual !== null && perceptual.trim().length === 0) {
    throw new Error('--perceptual must not be empty.')
  }
  return { help: false, candidates: normalizedCandidates, out, perceptual }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    usage()
    return
  }

  const { createServer } = await import('vite')
  let perceptualEvidence
  if (options.perceptual) {
    const evidencePath = resolve(process.cwd(), options.perceptual)
    try {
      perceptualEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
    } catch (error) {
      throw new Error(`Unable to read perceptual evidence "${evidencePath}": ${
        error instanceof Error ? error.message : String(error)
      }`)
    }
  }
  const server = await createServer({
    configFile: resolve(here, 'vite.config.ts'),
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false }
  })

  let report
  try {
    const entry = await server.ssrLoadModule('/dashboard-differentiation-report-entry.ts')
    report = entry.createBuiltinDashboardDifferentiationReport(
      options.candidates,
      perceptualEvidence
    )
  } finally {
    await server.close()
  }

  const json = `${JSON.stringify(report, null, 2)}\n`
  if (options.out) {
    const outputPath = resolve(process.cwd(), options.out)
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, json)
    console.error(`[dashboard-differentiation] report: ${outputPath}`)
  } else {
    process.stdout.write(json)
  }

  console.error(
    `[dashboard-differentiation] mode=${report.mode} presets=${report.presets.total} ` +
    `baseline-hard-fails=${report.baselineExisting.hardFailPairCount} ` +
    `candidate-hard-fails=${report.candidateGate?.hardFailPairCount ?? 0} ` +
    `perceptual-missing=${report.candidateGate?.missingPerceptualPairCount ?? 0} ` +
    `perceptual-incomplete=${report.candidateGate?.incompletePerceptualPairCount ?? 0}`
  )
  if (report.candidateGate && !report.candidateGate.passed) process.exitCode = 1
}

main().catch((error) => {
  console.error(`[dashboard-differentiation] fatal: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 2
})
