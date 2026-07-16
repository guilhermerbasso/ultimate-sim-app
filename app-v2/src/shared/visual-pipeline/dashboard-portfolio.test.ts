import { describe, expect, it } from 'vitest'
import { isControlledTag } from '../tags'
import { filterVariants, type WidgetTaxon } from '../widget-taxonomy'
import {
  DASHBOARD_PORTFOLIO,
  DASHBOARD_PORTFOLIO_FAMILIES,
  DASHBOARD_PORTFOLIO_IDS,
  DASHBOARD_PORTFOLIO_PROCESSING_ORDER,
  DASHBOARD_PORTFOLIO_SOURCES
} from './dashboard-portfolio'
import {
  dashboardPortfolioInProcessingOrder,
  dashboardPortfolioSemanticSignature,
  groupDashboardPortfolioByFamily,
  hasNormalizedDashboardTags,
  isDashboardPortfolioProcessingOrderInterleaved,
  lookupDashboardPortfolioEntry,
  normalizeDashboardTag,
  normalizeDashboardTags,
  validateDashboardPortfolioEntry,
  validateDashboardPortfolioRegistry
} from './dashboard-portfolio.helpers'

describe('Release B dashboard portfolio registry', () => {
  it('exports exactly 50 immutable entries with stable R2 ids', () => {
    expect(DASHBOARD_PORTFOLIO).toHaveLength(50)
    expect(DASHBOARD_PORTFOLIO.map((entry) => entry.id)).toEqual(DASHBOARD_PORTFOLIO_IDS)
    expect(DASHBOARD_PORTFOLIO_IDS).toEqual(
      Array.from({ length: 50 }, (_, index) => `R2-${String(index + 1).padStart(2, '0')}`)
    )
    expect(Object.isFrozen(DASHBOARD_PORTFOLIO)).toBe(true)
    expect(Object.isFrozen(DASHBOARD_PORTFOLIO[0])).toBe(true)
    expect(Object.isFrozen(DASHBOARD_PORTFOLIO[0].informationHierarchy)).toBe(true)
    expect(Object.isFrozen(DASHBOARD_PORTFOLIO[0].imagePromptConstraints)).toBe(true)
  })

  it('keeps ten researched families balanced at five dashboards each', () => {
    const grouped = groupDashboardPortfolioByFamily()
    expect(DASHBOARD_PORTFOLIO_FAMILIES).toHaveLength(10)
    expect(DASHBOARD_PORTFOLIO_FAMILIES.map((family) => family.id)).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'
    ])

    for (const family of DASHBOARD_PORTFOLIO_FAMILIES) {
      expect(grouped[family.id].map((entry) => entry.id)).toEqual(family.entryIds)
      expect(grouped[family.id]).toHaveLength(5)
    }
  })

  it('has unique authored names and semantic signatures', () => {
    const names = DASHBOARD_PORTFOLIO.map((entry) => entry.name.toLowerCase())
    const signatures = DASHBOARD_PORTFOLIO.map(dashboardPortfolioSemanticSignature)
    expect(new Set(names).size).toBe(50)
    expect(new Set(signatures).size).toBe(50)
    expect(signatures.every((signature) => !signature.includes('r2-'))).toBe(true)
  })

  it('passes complete-field and cross-registry validation', () => {
    expect(validateDashboardPortfolioRegistry()).toEqual([])
    for (const entry of DASHBOARD_PORTFOLIO) {
      expect(validateDashboardPortfolioEntry(entry), entry.id).toEqual([])
      expect(entry.informationHierarchy).toHaveLength(3)
      expect(entry.requiredTelemetryConceptIds.length).toBeGreaterThan(0)
      expect(entry.candidateWidgetConcepts.length).toBeGreaterThanOrEqual(3)
      expect(entry.researchNotes.length).toBeGreaterThan(0)
      expect(entry.sourceIds.length).toBeGreaterThan(0)
      expect(entry.imagePromptConstraints.sampleReadouts.length).toBeGreaterThan(0)
      expect(entry.imagePromptConstraints.requiredComposition.length).toBeGreaterThan(0)
      expect(entry.imagePromptConstraints.avoidAlso.length).toBeGreaterThan(0)
    }
  })

  it('uses stable lookup, order, and family helpers', () => {
    expect(lookupDashboardPortfolioEntry('R2-01')?.name).toBe('GT Gear Monolith')
    expect(lookupDashboardPortfolioEntry('R2-50')?.name).toBe('Historic Rally Tripmaster')
    expect(lookupDashboardPortfolioEntry('R2-99')).toBeUndefined()
    expect(dashboardPortfolioInProcessingOrder().map((entry) => entry.id)).toEqual(
      DASHBOARD_PORTFOLIO_PROCESSING_ORDER
    )
  })

  it('stores normalized unique tags and provides deterministic normalization', () => {
    expect(normalizeDashboardTag(' Race Control / GT ')).toBe('race-control-gt')
    expect(normalizeDashboardTags([' GT ', 'gt', 'Race Control', 'race-control', ''])).toEqual([
      'gt',
      'race-control'
    ])

    for (const entry of DASHBOARD_PORTFOLIO) {
      expect(hasNormalizedDashboardTags(entry.tags), entry.id).toBe(true)
      expect(new Set(entry.tags).size, entry.id).toBe(entry.tags.length)
      expect(entry.tags).toContain('dashboard')
      expect(entry.tags).toContain('release-b')
      expect(entry.tags).toContain(`family-${entry.familyId.toLowerCase()}`)
    }
  })

  it('keeps every required portfolio filter tag in the shared controlled vocabulary', () => {
    const requiredPortfolioTags = new Set(
      DASHBOARD_PORTFOLIO.flatMap((entry) => [
        'dashboard',
        'telemetry-framework',
        'release-b',
        `family-${entry.familyId.toLowerCase()}`
      ])
    )

    expect([...requiredPortfolioTags].sort()).toEqual([
      'dashboard',
      'family-a',
      'family-b',
      'family-c',
      'family-d',
      'family-e',
      'family-f',
      'family-g',
      'family-h',
      'family-i',
      'family-j',
      'release-b',
      'telemetry-framework'
    ])
    for (const tag of requiredPortfolioTags) expect(isControlledTag(tag), tag).toBe(true)
  })

  it('has zero uncontrolled tags and supports combined portfolio filtering', () => {
    for (const entry of DASHBOARD_PORTFOLIO) {
      for (const tag of entry.tags) expect(isControlledTag(tag), `${entry.id}: ${tag}`).toBe(true)
    }

    const filterableEntries: WidgetTaxon[] = DASHBOARD_PORTFOLIO.map((entry) => ({
      id: entry.id,
      label: entry.name,
      category: 'Digital',
      styleFamily: 'clean',
      tags: entry.tags
    }))
    const openWheel = filterVariants(filterableEntries, {
      tags: ['dashboard', 'release-b', 'family-b', 'open-wheel']
    })
    const accessible = filterVariants(filterableEntries, {
      tags: ['dashboard', 'release-b', 'family-i', 'accessibility']
    })

    expect(openWheel.map((entry) => entry.id)).toEqual([
      'R2-06', 'R2-07', 'R2-08', 'R2-09', 'R2-10'
    ])
    expect(accessible.map((entry) => entry.id)).toEqual([
      'R2-41', 'R2-42', 'R2-43', 'R2-44', 'R2-45'
    ])
  })

  it('interleaves A through J in each of five processing waves', () => {
    expect(DASHBOARD_PORTFOLIO_PROCESSING_ORDER).toHaveLength(50)
    expect(new Set(DASHBOARD_PORTFOLIO_PROCESSING_ORDER).size).toBe(50)
    expect(isDashboardPortfolioProcessingOrderInterleaved()).toBe(true)

    const ordered = dashboardPortfolioInProcessingOrder()
    for (let start = 0; start < ordered.length; start += 10) {
      expect(ordered.slice(start, start + 10).map((entry) => entry.familyId)).toEqual([
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'
      ])
    }
  })

  it('keeps ordinary overlays separate from trigger-only alerts', () => {
    for (const entry of DASHBOARD_PORTFOLIO) {
      expect(entry.ordinaryOverlays.length, entry.id).toBeGreaterThan(0)
      expect(entry.triggerOnlyAlerts.length, entry.id).toBeGreaterThan(0)
      expect(new Set(entry.triggerOnlyAlerts).size, entry.id).toBe(entry.triggerOnlyAlerts.length)

      const ordinary = new Set(entry.ordinaryOverlays.map((value) => value.toLowerCase()))
      expect(
        entry.triggerOnlyAlerts.some((alert) => ordinary.has(alert.toLowerCase())),
        entry.id
      ).toBe(false)
    }
  })

  it('uses condition or event phrases for trigger-only alerts, never workflow policies', () => {
    const workflowPolicyPatterns = [
      /\bat a time\b/i,
      /\bqueue(?:d|ing)? decision alert\b/i,
      /\brequir(?:e|es|ed|ing) (?:explicit )?acknowledg(?:e)?ment\b/i,
      /\bworkflow policy\b/i
    ]

    for (const entry of DASHBOARD_PORTFOLIO) {
      for (const alert of entry.triggerOnlyAlerts) {
        expect(
          workflowPolicyPatterns.some((pattern) => pattern.test(alert)),
          `${entry.id}: ${alert}`
        ).toBe(false)
      }
    }

    const calmPitwall = lookupDashboardPortfolioEntry('R2-45')
    expect(calmPitwall?.triggerOnlyAlerts).toEqual([
      'configured critical-fuel threshold decision alert',
      'pit-window closing decision alert',
      'red-flag stop decision alert',
      'driver-time limit decision alert'
    ])
    expect(calmPitwall?.layoutGrammar).toContain('later decisions to a queue count')
    expect(calmPitwall?.imagePromptConstraints.requiredComposition.join(' ')).toContain(
      'explicit acknowledgement for consequential changes'
    )
  })

  it('enforces the prompt IP and business-dashboard guardrails per entry', () => {
    for (const entry of DASHBOARD_PORTFOLIO) {
      const avoid = entry.imagePromptConstraints.avoid.join(' ').toLowerCase()
      expect(avoid, entry.id).toContain('official')
      expect(avoid, entry.id).toContain('logo')
      expect(avoid, entry.id).toContain('proprietary')
      expect(avoid, entry.id).toContain('generic business-dashboard cards')
      expect(avoid, entry.id).toContain('static background')
    }
  })

  it('preserves the researched discipline and accessibility coverage', () => {
    const corpus = JSON.stringify(DASHBOARD_PORTFOLIO).toLowerCase()
    for (const requiredCoverage of [
      'accessibility',
      'engineer',
      'broadcast',
      'oval',
      'rally',
      'vintage',
      'open-wheel',
      'endurance',
      'gt'
    ]) {
      expect(corpus).toContain(requiredCoverage)
    }
  })

  it('preserves all 44 source-register references', () => {
    expect(DASHBOARD_PORTFOLIO_SOURCES).toHaveLength(44)
    expect(DASHBOARD_PORTFOLIO_SOURCES.map((source) => source.id)).toEqual(
      Array.from({ length: 44 }, (_, index) => `S${String(index + 1).padStart(2, '0')}`)
    )
    expect(Object.isFrozen(DASHBOARD_PORTFOLIO_SOURCES)).toBe(true)
  })
})
