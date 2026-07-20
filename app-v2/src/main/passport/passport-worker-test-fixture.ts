import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'vite'

export interface PassportWorkerTestFixture {
  entry: string
  cleanup(): void
}

export async function buildPassportWorkerTestFixture(
  label: string
): Promise<PassportWorkerTestFixture> {
  const outDir = mkdtempSync(join(process.cwd(), `.passport-test-worker-${label}-`))
  const entryName = 'passport-persistence-worker.js'
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        ssr: resolve(process.cwd(), 'src/main/passport/passport-persistence-worker.ts'),
        outDir,
        emptyOutDir: true,
        target: 'node20',
        minify: false,
        rollupOptions: {
          output: {
            entryFileNames: entryName,
            format: 'es'
          }
        }
      }
    })
  } catch (error) {
    rmSync(outDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    throw error
  }
  return {
    entry: join(outDir, entryName),
    cleanup: () => {
      rmSync(outDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  }
}
