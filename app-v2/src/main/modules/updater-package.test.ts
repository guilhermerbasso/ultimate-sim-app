import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

const root = process.cwd()

describe('Windows updater package safety', () => {
  it('uses a non-destructive installer wait before the stock app-running check', () => {
    const script = readFileSync(join(root, 'build', 'installer.nsh'), 'utf8')

    expect(script).toContain('!include "getProcessInfo.nsh"')
    expect(script).toContain('Var pid')
    expect(script).toContain('!macro customCheckAppRunning')
    expect(script).toContain('${isUpdated}')
    expect(script).toContain('!insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}"')
    expect(script).toContain('$R8 >= 15')
    expect(script).toContain('Var /GLOBAL IsPowerShellAvailable')
    expect(script).toContain('Get-Command Get-CimInstance')
    expect(script).toContain('!insertmacro _CHECK_APP_RUNNING')
    expect(script).not.toMatch(/RMDir\s+\/r/i)
    expect(script).not.toContain('UninstallExistingInstall')
  })

  it('builds an elevated per-machine updater with the helper packaged', () => {
    const config = YAML.parse(readFileSync(join(root, 'electron-builder.yml'), 'utf8'))

    expect(config.nsis).toMatchObject({
      oneClick: false,
      perMachine: true,
      allowElevation: true,
      packElevateHelper: true
    })
  })

  it('keeps package and lockfile versions aligned at 2.53.0', () => {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
    const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
      version: string
      packages: Record<string, { version?: string }>
    }

    expect(packageJson.version).toBe('2.53.0')
    expect(packageLock.version).toBe('2.53.0')
    expect(packageLock.packages['']?.version).toBe('2.53.0')
  })
})
