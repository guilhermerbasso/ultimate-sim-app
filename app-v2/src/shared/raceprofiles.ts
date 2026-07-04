export interface RaceProfileMatch {
  carName?: string
  trackName?: string
}

export interface RaceProfile {
  id: string
  name: string
  match?: RaceProfileMatch
  buttonboxProfile?: string
  oled?: any
  overlays?: any
  alerts?: any
  bindings?: any
  /** Per-effect intensity overrides saved from the haptics config at capture time. */
  hapticsGains?: Partial<Record<string, number>>
}

export interface RaceProfileSuggestion {
  profileId: string
  carName?: string
  trackName?: string
}
