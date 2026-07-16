import { DASHBOARD_PORTFOLIO_ENTRIES_A_E } from './dashboard-portfolio.entries-a-e'
import { DASHBOARD_PORTFOLIO_ENTRIES_F_J } from './dashboard-portfolio.entries-f-j'
import type {
  DashboardPortfolioEntry,
  DashboardPortfolioFamilyDefinition,
  DashboardPortfolioId,
  DashboardPortfolioSource
} from './dashboard-portfolio.types'
import { deepFreeze } from './immutability'

export * from './dashboard-portfolio.types'

export const DASHBOARD_PORTFOLIO_SOURCES = deepFreeze([
  { id: 'S01', label: 'Bosch Motorsport Display DDU 11', url: 'https://www.bosch-motorsport.com/products/displays/display-ddu-11/', domain: 'hardware' },
  { id: 'S02', label: 'AiM MX Series', url: 'https://www.aimtechnologies.com/mx-series/', domain: 'hardware' },
  { id: 'S03', label: 'MoTeC C125', url: 'https://www.motec.com.au/products/C125', domain: 'hardware' },
  { id: 'S04', label: 'MoTeC i2', url: 'https://www.motec.com.au/products/I2', domain: 'analysis' },
  { id: 'S05', label: 'MoTeC i2 Feature Guide', url: 'https://www.motec.com.au/uploads/i2_V1_1_4_Feature_Guide_0d03b00fa8.pdf', domain: 'analysis' },
  { id: 'S06', label: 'Cosworth ICD', url: 'https://www.cosworth.com/motorsport/products/icd/', domain: 'hardware' },
  { id: 'S07', label: 'Cosworth CCW Mk3', url: 'https://www.cosworth.com/motorsport/products/ccw-mk3/', domain: 'hardware' },
  { id: 'S08', label: 'Stack ST8100', url: 'https://www.stackltd.com/st8100.html', domain: 'hardware' },
  { id: 'S09', label: 'Bosch WinDarab V7', url: 'https://www.bosch-motorsport.de/content/downloads/Raceparts/Resources/pdf/Data%20Sheet_70956555_Analysis_Tool_WinDarab_V7.pdf', domain: 'analysis' },
  { id: 'S10', label: 'IMSA virtual energy replenishment', url: 'https://www.imsa.com/news/2023/09/27/high-tech-pit-stops-how-does-gtp-virtual-energy-replenishment-work/', domain: 'endurance' },
  { id: 'S11', label: 'IMSA LMDh Hybrid 101', url: 'https://www.imsa.com/news/2022/04/06/hybrid-101-learn-more-about-how-lmdh-hybrid-power-works/', domain: 'endurance' },
  { id: 'S12', label: '24 Hours of Le Mans safety-car procedure', url: 'https://www.24h-lemans.com/en/news/all-you-need-to-know-about-the-safety-car-procedure-at-the-24-hours-of-le-mans-58788', domain: 'endurance' },
  { id: 'S13', label: 'FIA WEC regulations', url: 'https://www.fia.com/regulation/category/118', domain: 'endurance' },
  { id: 'S14', label: 'IMSA 2026 rules and regulations', url: 'https://www.imsa.com/competitors/2026-imsa-rules-regulations/', domain: 'endurance' },
  { id: 'S15', label: 'GT World Challenge Europe 2026 regulations', url: 'https://europeregs.sporting.gt-world-challenge.com/', domain: 'gt' },
  { id: 'S16', label: 'Al Kamel live timing', url: 'https://alkamelsystems.com/live-results/', domain: 'timing' },
  { id: 'S17', label: 'Racecar Engineering motorsport TPMS', url: 'https://www.racecar-engineering.com/tech-explained/tech-explained-tyre-pressure-monitoring-systems/', domain: 'tyres' },
  { id: 'S18', label: 'Your Data Driven tyre-temperature interpretation', url: 'https://www.yourdatadriven.com/guide-to-interpreting-tyre-temperatures-in-motorsports/', domain: 'tyres' },
  { id: 'S19', label: 'NASCAR points system', url: 'https://www.nascar.com/news-media/2019/02/08/nascar-driver-points-awarded-per-race/', domain: 'oval' },
  { id: 'S20', label: 'NASCAR choose and restart geometry', url: 'https://www.nascar.com/news-media/2024/07/05/nascar-101-at-chicago-course-map-track-layout-choose-rule-and-more/', domain: 'oval' },
  { id: 'S21', label: 'NASCAR overtime policy', url: 'https://www.nascar.com/news-media/2024/07/03/how-does-nascars-overtime-policy-compare-to-other-sports/', domain: 'oval' },
  { id: 'S22', label: 'NASCAR pit-road penalty card', url: 'https://rbfiles.ndms.nascar.com/2024/12/2025-PIT-ROAD-PENALTY-CARD_REVA.pdf', domain: 'oval' },
  { id: 'S23', label: 'IndyCar Push to Pass 2026', url: 'https://www.indycar.com/news/2026/05/05-05-p2p', domain: 'open-wheel' },
  { id: 'S24', label: 'IndyCar aeroscreen', url: 'https://www.indycar.com/News/2024/04/04-16-New-Aeroscreen', domain: 'open-wheel' },
  { id: 'S25', label: 'IndyCar spotting', url: 'https://www.indycar.com/Videos/2024/07/07-18-INDYCAR101', domain: 'oval' },
  { id: 'S26', label: 'IndyCar fuel gamble', url: 'https://www.indycar.com/news/2026/06/06-07-buzz-wwtr', domain: 'oval' },
  { id: 'S27', label: 'WRC A–Z', url: 'https://www.wrc.com/en/misc/a-z', domain: 'rally' },
  { id: 'S28', label: 'FIA WRC regulations', url: 'https://www.fia.com/regulation/category/119', domain: 'rally' },
  { id: 'S29', label: 'Rally Estonia regulations', url: 'https://rallyestonia.com/userfiles/WRCRE2025_SR_17052025.pdf', domain: 'rally' },
  { id: 'S30', label: 'Formula 1 steering-wheel explainer', url: 'https://www.formula1.com/en/latest/article/f1-explains-how-f1-steering-wheels-are-designed-how-they-work-and-what-all.2B2TgpuPz8VZYwiHtgTII5', domain: 'open-wheel' },
  { id: 'S31', label: 'Formula E energy management', url: 'https://www.fiaformulae.com/en/news/10688', domain: 'open-wheel' },
  { id: 'S32', label: 'Formula E Attack Mode', url: 'https://www.fiaformulae.com/en/news/7841', domain: 'open-wheel' },
  { id: 'S33', label: 'Pirelli 2026 compounds', url: 'https://press.pirelli.com/pirelli-reveals-2026-f1-tyres-a-fresh-logo-design-and-new-compounds/', domain: 'tyres' },
  { id: 'S34', label: 'WCAG use of color', url: 'https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html', domain: 'accessibility' },
  { id: 'S35', label: 'WCAG minimum text contrast', url: 'https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html', domain: 'accessibility' },
  { id: 'S36', label: 'WCAG non-text contrast', url: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html', domain: 'accessibility' },
  { id: 'S37', label: 'ISO 15008', url: 'https://www.iso.org/standard/62784.html', domain: 'accessibility' },
  { id: 'S38', label: 'Okabe–Ito Color Universal Design', url: 'https://jfly.uni-koeln.de/color/', domain: 'accessibility' },
  { id: 'S39', label: 'SimHub Wiki', url: 'https://github.com/SHWotever/SimHub/wiki', domain: 'sim' },
  { id: 'S40', label: 'Crew Chief', url: 'https://github.com/mrbelowski/CrewChiefV4', domain: 'sim' },
  { id: 'S41', label: 'FIA Appendix H', url: 'https://www.fia.com/appendix-h-recommendations-supervision-road-and-emergency-services-2025', domain: 'race-control' },
  { id: 'S42', label: 'Formula 1 broadcast-graphics evolution', url: 'https://www.formula1.com/en/latest/article/watch-how-f1s-tv-graphics-have-evolved-over-the-years.1AYtsM8CsEpqqZjTMU8UDa', domain: 'broadcast' },
  { id: 'S43', label: 'Brembo Formula 1 carbon brakes', url: 'https://www.brembo.com/en/motorsport/formula1/ventilation-holes', domain: 'brakes' },
  { id: 'S44', label: 'AP Racing disc temperatures', url: 'https://apracing.com/race-car/brake-discs/disc-temperatures', domain: 'brakes' }
] as const satisfies readonly DashboardPortfolioSource[])

export const DASHBOARD_PORTFOLIO_FAMILIES = deepFreeze([
  {
    id: 'A',
    name: 'Purpose-built driver DDUs',
    entryIds: ['R2-01', 'R2-02', 'R2-03', 'R2-04', 'R2-05'],
    primaryGrammar: 'Gear, RPM, tyres, delta, and phase-specific cockpit pages.',
    mission: 'Give a driver one dominant race task per page with dense but glanceable supporting telemetry.',
    coverage: ['GT race pace', 'sprint and qualifying', 'tyre management', 'launch and pit transitions'],
    promptGuardrail: 'Use original motorsport instrumentation; hardware references are inspiration only and never a branded or proprietary replica.'
  },
  {
    id: 'B',
    name: 'Open-wheel energy/control',
    entryIds: ['R2-06', 'R2-07', 'R2-08', 'R2-09', 'R2-10'],
    primaryGrammar: 'Shallow wheel displays, energy flows, spatial boost systems, and vehicle-axis controls.',
    mission: 'Cover open-wheel readiness, temporary power, energy management, and setup balance without copying a current race-car wheel.',
    coverage: ['open-wheel qualifying', 'hybrid and electric energy', 'temporary power', 'vehicle dynamics'],
    promptGuardrail: 'No official Formula, IndyCar, Formula E, team, or steering-wheel trade dress; supplemental series feeds remain explicitly external.'
  },
  {
    id: 'C',
    name: 'Endurance/GT mission',
    entryIds: ['R2-11', 'R2-12', 'R2-13', 'R2-14', 'R2-15'],
    primaryGrammar: 'Virtual energy, multiclass traffic, neutralization, stint health, and driver-swap continuity.',
    mission: 'Support long-stint decisions and multiclass procedures for GT and prototype racing.',
    coverage: ['endurance', 'GT', 'prototype', 'multiclass', 'night operations'],
    promptGuardrail: 'Rules, official timing, virtual energy, and driver-time data must be source-labeled and never inferred from unavailable telemetry.'
  },
  {
    id: 'D',
    name: 'Oval/stock-car operations',
    entryIds: ['R2-16', 'R2-17', 'R2-18', 'R2-19', 'R2-20'],
    primaryGrammar: 'Spotting, choose/restarts, stages, cautions, pit procedure, and drafting.',
    mission: 'Represent oval-specific spatial and sporting decisions instead of reusing circuit-racing layouts.',
    coverage: ['oval traffic', 'stock-car stages', 'restarts', 'caution procedures', 'draft fuel saving'],
    promptGuardrail: 'Use generic series-neutral procedure graphics and no NASCAR or IndyCar branding, official cards, or broadcast packages.'
  },
  {
    id: 'E',
    name: 'Rally stage/environment',
    entryIds: ['R2-21', 'R2-22', 'R2-23', 'R2-24', 'R2-25'],
    primaryGrammar: 'Pacenotes, controls, surface maps, damage survival, and low-visibility guidance.',
    mission: 'Make road sequence, environment, timing, and survival primary for rally and regularity use cases.',
    coverage: ['rally stages', 'pacenotes', 'mixed surfaces', 'damage', 'night and fog'],
    promptGuardrail: 'Pacenotes and route-control data are external; use original symbols and never copy game, event, or commercial rally artwork.'
  },
  {
    id: 'F',
    name: 'Engineer telemetry lab',
    entryIds: ['R2-26', 'R2-27', 'R2-28', 'R2-29', 'R2-30'],
    primaryGrammar: 'Synchronized traces, local delta, G-G scatter, setup correlation, and statistical consistency.',
    mission: 'Turn player telemetry into evidence-driven engineering analysis with explicit validity and confidence.',
    coverage: ['engineering', 'driver coaching', 'vehicle dynamics', 'setup', 'statistics'],
    promptGuardrail: 'No opponent control traces, no generic office analytics, and no causal claim without reference quality or confidence.'
  },
  {
    id: 'G',
    name: 'Strategy/thermal/pitwall',
    entryIds: ['R2-31', 'R2-32', 'R2-33', 'R2-34', 'R2-35'],
    primaryGrammar: 'Fuel forecast, tyre/brake thermal analysis, resource windows, and weather crossover.',
    mission: 'Expose uncertainty, resource constraints, and operating envelopes for pit-wall decisions.',
    coverage: ['fuel strategy', 'tyres', 'brakes', 'pit windows', 'weather'],
    promptGuardrail: 'Forecasts must show assumptions; thermal thresholds remain configurable and live pressure/radar feeds stay explicitly sourced.'
  },
  {
    id: 'H',
    name: 'Broadcast/race control',
    entryIds: ['R2-36', 'R2-37', 'R2-38', 'R2-39', 'R2-40'],
    primaryGrammar: 'Timing, battles, incidents, evidence, and race narrative.',
    mission: 'Cover viewer storytelling and operational race control while separating official feeds from local estimates.',
    coverage: ['broadcast', 'timing', 'race control', 'stewarding', 'multiclass storytelling'],
    promptGuardrail: 'No official broadcast skins, series marks, driver portraits, real footage, or authoritative claim without an official source.'
  },
  {
    id: 'I',
    name: 'Accessibility/multimodal',
    entryIds: ['R2-41', 'R2-42', 'R2-43', 'R2-44', 'R2-45'],
    primaryGrammar: 'CVD-safe encoding, low-vision focus, haptics, captions, and low cognitive load.',
    mission: 'Make racing information perceivable and actionable through redundant visual, textual, audio, or haptic mappings.',
    coverage: ['color vision deficiency', 'low vision', 'haptics', 'captions', 'cognitive accessibility'],
    promptGuardrail: 'Never rely on color alone, never stack competing alerts, and preserve explicit contrast, shape, text, pattern, and stable placement.'
  },
  {
    id: 'J',
    name: 'Heritage/club/historic',
    entryIds: ['R2-46', 'R2-47', 'R2-48', 'R2-49', 'R2-50'],
    primaryGrammar: 'Analog needles, chronographs, compact LCDs, mechanical gauges, and tripmeters.',
    mission: 'Preserve period-appropriate instrument constraints while using original geometry and honest modern telemetry.',
    coverage: ['historic racing', 'club sprint', 'vintage endurance', 'mechanical health', 'regularity rally'],
    promptGuardrail: 'No copied period product face, logo, typeface, watch, tripmaster, or artificial patina that harms legibility.'
  }
] as const satisfies readonly DashboardPortfolioFamilyDefinition[])

export const DASHBOARD_PORTFOLIO_PROCESSING_ORDER = deepFreeze([
  'R2-01', 'R2-06', 'R2-11', 'R2-16', 'R2-21', 'R2-26', 'R2-31', 'R2-36', 'R2-41', 'R2-46',
  'R2-02', 'R2-07', 'R2-12', 'R2-17', 'R2-22', 'R2-27', 'R2-32', 'R2-37', 'R2-42', 'R2-47',
  'R2-03', 'R2-08', 'R2-13', 'R2-18', 'R2-23', 'R2-28', 'R2-33', 'R2-38', 'R2-43', 'R2-48',
  'R2-04', 'R2-09', 'R2-14', 'R2-19', 'R2-24', 'R2-29', 'R2-34', 'R2-39', 'R2-44', 'R2-49',
  'R2-05', 'R2-10', 'R2-15', 'R2-20', 'R2-25', 'R2-30', 'R2-35', 'R2-40', 'R2-45', 'R2-50'
] as const satisfies readonly DashboardPortfolioId[])

export const DASHBOARD_PORTFOLIO = deepFreeze([
  ...DASHBOARD_PORTFOLIO_ENTRIES_A_E,
  ...DASHBOARD_PORTFOLIO_ENTRIES_F_J
] as const satisfies readonly DashboardPortfolioEntry[])
