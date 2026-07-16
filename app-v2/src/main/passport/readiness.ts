import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalFactValue, canonicalFactsByName, type CanonicalRaceOpsEvent } from '../../shared/phase02-contracts'
import type { PassportConfig } from '../../shared/stint-passport'
import { DEFAULT_SPOTTER_CONFIG, mergeSpotterConfig, type SpotterConfigPatch } from '../../shared/spotter'
import type { ModuleContext } from '../module-context'
import { RaceProfileStore } from '../raceprofiles/store'
import type { PassportExternalReadiness } from './evaluator'

function factText(event: CanonicalRaceOpsEvent, name: string): string | undefined {
  const value = canonicalFactValue(canonicalFactsByName(event.facts).get(name))
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
function normalized(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase('en-US') ?? ''
}

export async function inspectPassportReadiness(
  ctx: ModuleContext,
  event: CanonicalRaceOpsEvent,
  config: PassportConfig
): Promise<PassportExternalReadiness> {
  const raceProfiles = new RaceProfileStore(ctx.app.getPath('userData'))
  const raceProfile = config.expectedRaceProfileId
    ? await raceProfiles.get(config.expectedRaceProfileId)
    : null
  const carName = factText(event, 'car.name')
  const trackName = factText(event, 'session.track_name')

  let buttonboxExists = false
  let controlIds: string[] = []
  if (config.expectedButtonboxProfile) {
    try {
      const profile = await ctx.profileStore.loadProfile(config.expectedButtonboxProfile)
      buttonboxExists = profile.name === config.expectedButtonboxProfile
      controlIds = profile.mapping.entries.map((entry) => entry.controlId)
    } catch {
      buttonboxExists = false
      controlIds = []
    }
  }

  let configFound = false
  let spotter = DEFAULT_SPOTTER_CONFIG
  try {
    const raw = JSON.parse(
      await readFile(join(ctx.app.getPath('userData'), 'spotter.json'), 'utf8')
    ) as SpotterConfigPatch
    spotter = mergeSpotterConfig(DEFAULT_SPOTTER_CONFIG, raw)
    configFound = true
  } catch {
    configFound = false
  }

  return {
    raceProfile: {
      profileId: config.expectedRaceProfileId,
      exists: raceProfile !== null,
      matchesCar: raceProfile?.match?.carName
        ? normalized(raceProfile.match.carName) === normalized(carName)
        : false,
      matchesTrack: raceProfile?.match?.trackName
        ? normalized(raceProfile.match.trackName) === normalized(trackName)
        : false,
      buttonboxProfile: raceProfile?.buttonboxProfile
    },
    buttonboxProfile: {
      profileName: config.expectedButtonboxProfile,
      exists: buttonboxExists,
      controlIds
    },
    devices: ctx.serialHub.listDevices().map((device) => ({
      id: device.id,
      connected: device.connected,
      label: device.label
    })),
    audio: {
      configFound,
      enabled: spotter.enabled,
      muted: spotter.muted,
      outputDeviceId: spotter.outputDeviceId,
      enabledCallouts: Object.entries(spotter.callouts)
        .filter(([, callout]) => callout.enabled)
        .map(([id]) => id)
    }
  }
}
