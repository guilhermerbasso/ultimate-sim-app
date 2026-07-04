export type DriverTag = 'clean' | 'aggressive' | 'avoid' | 'fast' | 'friend' | 'none'

export interface DriverNote {
  custId: number
  tag: DriverTag
  note?: string
  color?: string
  updatedAt: number
}

export interface DriverNoteInput {
  custId: number
  tag: DriverTag
  note?: string
  color?: string
}

export interface DriverNotesListResult {
  notes: DriverNote[]
}

export interface DriverNotesUpdatedEvent {
  notes: DriverNote[]
}

export const DRIVER_TAG_OPTIONS: readonly DriverTag[] = ['none', 'clean', 'aggressive', 'avoid', 'fast', 'friend'] as const

export const DRIVER_NOTES_CHANNELS = {
  list: 'drivers:list',
  set: 'drivers:set',
  remove: 'drivers:remove',
  updated: 'drivers:updated'
} as const

export type DriverNotesChannel = (typeof DRIVER_NOTES_CHANNELS)[keyof typeof DRIVER_NOTES_CHANNELS]
