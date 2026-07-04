import type { StoDiffResult } from './sto-parser'

export interface SetupMetadata {
  car: string
  track: string
  notes: string
  tags: string[]
  rating: number
  updatedAt: number
}

export interface SetupLibraryItem {
  id: string
  path: string
  fileName: string
  relativePath: string
  carFolder?: string
  sizeBytes: number
  modifiedAt: number
  metadata: SetupMetadata
}

export interface SetupLibraryResult {
  root: string
  items: SetupLibraryItem[]
}

export type SetupMetadataPatch = Partial<Omit<SetupMetadata, 'updatedAt'>>

export interface SetupReadFileResult {
  path: string
  text: string
}

export interface SetupCompareArgs {
  leftPath: string
  rightPath: string
}

export interface SetupCompareResult {
  left: SetupLibraryItem
  right: SetupLibraryItem
  diff: StoDiffResult
}

export interface SetupMetaSaveArgs {
  path: string
  metadata: SetupMetadataPatch
}

export const SETUP_MANAGER_CHANNELS = {
  libraryList: 'setups:libraryList',
  readFile: 'setups:readFile',
  compare: 'setups:compare',
  saveMeta: 'setups:saveMeta'
} as const

export type SetupManagerChannel = (typeof SETUP_MANAGER_CHANNELS)[keyof typeof SETUP_MANAGER_CHANNELS]
