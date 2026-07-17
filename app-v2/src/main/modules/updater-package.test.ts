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

  it('unpacks the SerialPort runtime used by the ASAR-aware CommonJS bridge', () => {
    const config = YAML.parse(readFileSync(join(root, 'electron-builder.yml'), 'utf8'))
    const unpack = config.asarUnpack as string[]

    expect(unpack).toContain('**/node_modules/@serialport/**')
    expect(unpack).toContain('**/node_modules/serialport/**')
  })

  it('routes every main-process SerialPort import through the ASAR-aware bridge', () => {
    const directImport = /from\s+['"]serialport['"]/
    const consumers = [
      join(root, 'src', 'main', 'serial', 'hub.ts'),
      join(root, 'src', 'main', 'serial', 'device.ts'),
      join(root, 'src', 'main', 'devices', 'flasher.ts'),
      join(root, 'src', 'main', 'modules', 'esp32-wifi.ts'),
      join(root, 'src', 'main', 'modules', 'arduino-setup.ts')
    ]

    for (const file of consumers) {
      expect(readFileSync(file, 'utf8')).not.toMatch(directImport)
    }

    const bridge = readFileSync(
      join(root, 'src', 'main', 'serial', 'serialport-runtime.ts'),
      'utf8'
    )
    expect(bridge).toContain('createRequire(import.meta.url)')
    expect(bridge).toContain("runtimeRequire('serialport')")
  })

  it('keeps package and lockfile versions aligned at 2.53.1', () => {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
    const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
      version: string
      packages: Record<string, { version?: string }>
    }

    expect(packageJson.version).toBe('2.53.1')
    expect(packageLock.version).toBe('2.53.1')
    expect(packageLock.packages['']?.version).toBe('2.53.1')
  })
})
