export interface SetupSource {
  id: string
  kind: 'folder' | 'url'
  label: string
  path?: string
  url?: string
}

export interface SetupFileInfo {
  id: string
  sourceId: string
  fileName: string
  sizeBytes?: number
  modifiedAt?: number
  suggestedCarFolder?: string
  url?: string
  localPath?: string
}

export interface SetupsConfig {
  version: 1
  sources: SetupSource[]
  carNameToFolder: Record<string, string>
  autoInstall: boolean
  autoInstallSourceId?: string
  updatedAt: number
}

export const DEFAULT_SETUPS_CONFIG: SetupsConfig = {
  version: 1,
  sources: [],
  carNameToFolder: {},
  autoInstall: false,
  updatedAt: 0
}

export interface InstallResult {
  ok: boolean
  installedPath?: string
  message: string
}

export interface SetupsEnv {
  supported: boolean
  platform: string
  setupsDir: string
}

export const SETUPS_CHANNELS = {
  getConfig: 'setups:getConfig',
  setConfig: 'setups:setConfig',
  env: 'setups:env',
  listCarFolders: 'setups:listCarFolders',
  listSource: 'setups:listSource',
  install: 'setups:install',
  detectCar: 'setups:detectCar',
  openSetupsDir: 'setups:openSetupsDir',
  pickFolder: 'setups:pickFolder',
  config: 'setups:config',
  autoPending: 'setups:autoPending'
} as const

export type SetupsChannel = (typeof SETUPS_CHANNELS)[keyof typeof SETUPS_CHANNELS]
