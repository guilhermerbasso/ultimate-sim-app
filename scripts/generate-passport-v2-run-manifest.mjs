import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDir, '..')
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const acceptancePath = join(root, 'docs', 'phase02', 'stint-passport-v2-acceptance-contract.json')
const outputPath = join(root, 'docs', 'phase02', 'stint-passport-v2-run-manifest.json')
const acceptanceBytes = readFileSync(acceptancePath)
const manifest = {
  manifestVersion: 1,
  acceptanceContract: 'docs/phase02/stint-passport-v2-acceptance-contract.json',
  acceptanceContractSha256: createHash('sha256').update(acceptanceBytes).digest('hex'),
  implementationHead: git('rev-parse', 'HEAD'),
  implementationTree: git('rev-parse', 'HEAD^{tree}'),
  branch: git('branch', '--show-current'),
  baseCommit: '31a414d90df8ddf639672453ff00d42b5d46a574',
  autonomousOverride: true,
  humanTokenUsed: false,
  evidence: JSON.parse(process.env.PASSPORT_V2_EVIDENCE_JSON || '{}')
}
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ outputPath, implementationHead: manifest.implementationHead }))
