import { resolve } from 'node:path'
import { build, type Plugin } from 'vite'
import { describe, expect, it } from 'vitest'
import {
  DurableLedgerFinalizationAuthority,
  VisualArtifactLedger
} from './node'

const VIRTUAL_RENDERER_ENTRY = 'virtual:visual-artifact-ledger-renderer'
const RESOLVED_RENDERER_ENTRY = `\0${VIRTUAL_RENDERER_ENTRY}.ts`

describe('visual artifact ledger import boundaries', () => {
  it('keeps the general shared entrypoint browser-safe in a Vite renderer build', async () => {
    const sharedEntry = resolve(
      'src',
      'shared',
      'visual-artifact-ledger',
      'index.ts'
    )
    const rejectNodeBuiltins: Plugin = {
      name: 'reject-visual-ledger-node-builtins',
      enforce: 'pre',
      resolveId(source) {
        if (source === VIRTUAL_RENDERER_ENTRY) return RESOLVED_RENDERER_ENTRY
        if (source.startsWith('node:')) {
          throw new Error(
            `Renderer-safe visual artifact ledger entry imported ${source}.`
          )
        }
        return null
      },
      load(id) {
        if (id !== RESOLVED_RENDERER_ENTRY) return null
        return `
          import { VisualArtifactGovernanceError } from ${JSON.stringify(sharedEntry)}

          export const boundary = {
            code: new VisualArtifactGovernanceError('TRUST', 'boundary').code
          }
        `
      }
    }

    await expect(
      build({
        configFile: false,
        logLevel: 'silent',
        plugins: [rejectNodeBuiltins],
        build: {
          write: false,
          minify: false,
          rollupOptions: {
            input: VIRTUAL_RENDERER_ENTRY
          }
        }
      })
    ).resolves.toBeDefined()
  })

  it('exposes implementation runtime values only through the explicit Node entrypoint', () => {
    expect(typeof VisualArtifactLedger.create).toBe('function')
    expect(typeof DurableLedgerFinalizationAuthority).toBe('function')
  })
})
