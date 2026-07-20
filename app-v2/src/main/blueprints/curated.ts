import bundledFeed from '../../../resources/raceops/curated-feed.json'
import type {
  CuratedRaceOpsFeedPin,
  SignedRaceOpsBlueprintFeed
} from '../../shared/raceops-blueprints'

export const RACEOPS_TRUSTED_PUBLIC_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'ultimate-sim-raceops-root-2026':
    'MCowBQYDK2VwAyEAE/Ad+k3VCLIj3bakGbhPV/MYceVtlNZ3L4ncm/etL/8='
})

export const RACEOPS_CURATED_FEED_PINS: readonly CuratedRaceOpsFeedPin[] = Object.freeze([
  {
    feedId: 'ultimate-sim-raceops',
    title: 'Ultimate Sim RaceOps Blueprints',
    endpoint:
      'https://raw.githubusercontent.com/guilhermerbasso/ultimate-sim-app/main/app-v2/resources/raceops/curated-feed.json',
    envelopeSha256: 'fa02821171bbb0ab484020abf238d311416f5d2dd1ffbbf219d893f9b1426d96',
    keyId: 'ultimate-sim-raceops-root-2026',
    reviewedAt: '2026-07-17T14:30:00.000Z',
    source: {
      kind: 'git',
      repository: 'https://github.com/guilhermerbasso/ultimate-sim-app.git',
      revision: 'main',
      path: 'app-v2/resources/raceops/curated-feed.json',
      url:
        'https://raw.githubusercontent.com/guilhermerbasso/ultimate-sim-app/main/app-v2/resources/raceops/curated-feed.json'
    }
  }
])

export const RACEOPS_BUNDLED_FEEDS: Readonly<Record<string, unknown>> = Object.freeze({
  'ultimate-sim-raceops': bundledFeed as unknown as SignedRaceOpsBlueprintFeed
})
