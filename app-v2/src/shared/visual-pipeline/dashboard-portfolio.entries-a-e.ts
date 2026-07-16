import {
  DASHBOARD_PORTFOLIO_CANVAS,
  DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
  type DashboardPortfolioEntry
} from './dashboard-portfolio.types'

export const DASHBOARD_PORTFOLIO_ENTRIES_A_E = [
  {
    id: 'R2-01',
    name: 'GT Gear Monolith',
    familyId: 'A',
    order: 1,
    priority: 2050,
    persona: 'GT sprint or endurance driver reading the display through vibration and peripheral vision.',
    raceMoment: 'Sustained race pace with frequent shifts, traffic checks, and fuel or tyre preservation decisions.',
    purpose: 'Make gear and shift state unmistakable while retaining the minimum race, control, fuel, tyre, and health context needed for one-lap decisions.',
    informationHierarchy: [
      'Primary: gear numeral occupying almost half the canvas, followed by the twelve-lamp shift state.',
      'Secondary: speed, live delta, class position, and current/last/best lap timing.',
      'Tertiary: TC, ABS, brake bias, fuel laps, four-corner tyres, and engine vitals.'
    ],
    requiredTelemetryConceptIds: [
      'gear', 'engineRpm', 'shiftLights', 'speed', 'deltaBest', 'overallPosition', 'classPosition',
      'currentLapTime', 'lastLapTime', 'bestLapTime', 'tcSetting', 'absSetting', 'brakeBias',
      'fuelLevel', 'fuelPerLap', 'derived:fuelLapsRemaining', 'raceFlags', 'pitLimiter',
      'tyreCarcassTemperature', 'tyreColdPressure', 'engineWarnings'
    ],
    layoutGrammar: 'Strictly symmetrical 1024x600 composition: a central numeral monolith, twelve discrete LEDs on a shallow top arc, narrow timing/control side rails, and a bottom four-corner microgrid.',
    visualLanguage: 'Purpose-built GT DDU with restrained motorsport density, hard alignment, and no ornamental depth effects.',
    materials: ['matte carbon face', 'black anodized inner bezel', 'anti-glare display glass'],
    typographyConstraints: 'Use a very large condensed tabular gear face, square tabular secondary numerals, uppercase abbreviations only, and no decorative labels.',
    colorConstraints: 'White numerals on near-black; cyan shift progression; red reserved for stop-level warnings; green delta only when gaining; every warning also uses text or shape.',
    differentiation: 'Unlike the other 49 briefs, gear alone consumes nearly half the canvas and all secondary information obeys strict bilateral symmetry.',
    candidateWidgetConcepts: ['twelve-stage shift arc', 'gear monolith', 'signed delta capsule', 'control chips', 'four-corner tyre microgrid'],
    ordinaryOverlays: ['P6 / GT3 class-position rail', 'CURRENT / LAST / BEST timing rail', 'TC 4 / ABS 3 / BB 54.8% control chips'],
    triggerOnlyAlerts: ['yellow or red flag takeover', 'pit limiter takeover', 'low-fuel banner', 'pressure-loss corner pulse', 'critical engine-temperature banner'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-a', 'gt', 'race', 'ddu-inspired', 'gear', 'rpm', 'dense'],
    researchNotes: [
      'Inspired by configurable motorsport DDU hierarchy only; do not reuse Bosch or MoTeC product geometry, labels, or branding.',
      'Pressure display must fall back to cold set points unless a separately identified live TPMS feed exists.'
    ],
    sourceIds: ['S01', 'S03'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Perfectly straight-on product-reference view with the display filling the frame and no surrounding cockpit.',
      sampleReadouts: ['GEAR 4', 'RPM 7,420', 'SPEED 226 km/h', 'DELTA -0.18 s', 'FUEL 8.4 laps'],
      requiredComposition: ['gear numeral uses roughly 45% of display area', 'twelve individually readable top LEDs', 'balanced side rails and a four-corner tyre footer'],
      legibility: 'All secondary values must remain readable at a 30% thumbnail; the gear must remain readable at a glance from two meters.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no circular tachometer', 'no centered stack of generic rectangular cards']
    }
  },
  {
    id: 'R2-02',
    name: 'Sprint RPM Blade',
    familyId: 'A',
    order: 2,
    priority: 2049,
    persona: 'Club sprint or qualifying driver who glances at a narrow display while keeping vision on the next braking marker.',
    raceMoment: 'A single qualifying or hillclimb run where shift precision and predicted finish matter more than race traffic.',
    purpose: 'Compress RPM, predictive performance, gear, and validity into an ultra-wide single-row instrument.',
    informationHierarchy: [
      'Primary: full-width discrete RPM blade and shift threshold.',
      'Secondary: predictive finish delta tape, gear, and speed.',
      'Tertiary: sector ticks, peak recall, lap validity, and compact engine vitals.'
    ],
    requiredTelemetryConceptIds: [
      'engineRpm', 'shiftLights', 'gear', 'speed', 'estimatedLap', 'deltaBest',
      'derived:predictiveLapTime', 'derived:sectorDelta', 'derived:lapValidity',
      'derived:peakRecall', 'engineWarnings'
    ],
    layoutGrammar: 'A deliberately shallow 4:1 strip with one uninterrupted lamp blade, one-line alphanumeric values, tiny sector ticks, and a compact peak-recall aperture at the far right.',
    visualLanguage: 'Minimal sprint instrumentation with exposed discrete lamps and crisp late-apex readability.',
    materials: ['matte black aluminum extrusion', 'smoked lamp lens', 'flush segmented LCD'],
    typographyConstraints: 'Segmented tabular numerals only; one text baseline; no multi-line labels; gear may be taller but cannot break the strip silhouette.',
    colorConstraints: 'Cyan normal shift progression, amber approach band, blue shift flash, red only for over-rev or engine danger; validity must include a shape marker.',
    differentiation: 'Unlike every other entry, the dashboard is intentionally almost one-dimensional: a shallow, nearly single-row blade rather than a framed screen.',
    candidateWidgetConcepts: ['full-width RPM blade', 'predictive delta tape', 'sector tick rail', 'peak-recall window'],
    ordinaryOverlays: ['GEAR / SPEED center pair', 'S1 / S2 / S3 split ticks', 'MAX RPM / MAX SPEED recall aperture'],
    triggerOnlyAlerts: ['over-rev full-blade flash', 'low-oil-pressure text takeover', 'critical-temperature text takeover', 'invalid-run strike-through'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', 'family-a', 'sprint', 'quali', 'landscape', 'rpm', 'delta', 'minimal', 'led'],
    researchNotes: [
      'The shallow form follows AiM-style sprint use cases without copying an AiM housing or screen.',
      'Predictive finish and peak recall are derived concepts and must state when the reference or sample is unavailable.'
    ],
    sourceIds: ['S02'],
    imagePromptConstraints: {
      canvas: '1536x384 ultra-wide dashboard strip, straight-on orthographic reference',
      viewpoint: 'Front elevation of the isolated strip with no dashboard surround, wheel, or vehicle context.',
      sampleReadouts: ['RPM 7,980 / SHIFT 8,200', 'GEAR 5', 'SPEED 191 km/h', 'PRED -0.34 s', 'S2 -0.11'],
      requiredComposition: ['continuous discrete-lamp blade across at least 75% of width', 'single text baseline', 'small peak-recall aperture at the right edge'],
      legibility: 'Every value must remain readable when the strip is reduced to 900x225; avoid tiny superscripts or dense labels.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no tall dashboard body', 'no round rev counter', 'no multi-row business status cards']
    }
  },
  {
    id: 'R2-03',
    name: 'Tyre Cross Side-Rail',
    familyId: 'A',
    order: 3,
    priority: 2048,
    persona: 'Endurance GT driver warming, preserving, or diagnosing tyres during a stint.',
    raceMoment: 'Out-lap, safety-car restart, long-run conservation phase, or the first signs of a pressure problem.',
    purpose: 'Put four tyre states ahead of conventional speed and gear so the driver can correct warm-up, imbalance, or damage early.',
    informationHierarchy: [
      'Primary: four tyre lozenges with pressure, three-zone temperature, age, and trend.',
      'Secondary: brake-temperature halos and pressure-loss direction.',
      'Tertiary: compact gear, speed, delta, TC, and ABS.'
    ],
    requiredTelemetryConceptIds: [
      'tyreColdPressure', 'tyreCarcassTemperature', 'tyreSurfaceTemperature', 'tyreWear',
      'brakeTemperature', 'tcSetting', 'absSetting', 'gear', 'speed', 'deltaBest',
      'external:tyrePressureMonitoring', 'derived:pressureLossRate', 'derived:tyreSlip', 'derived:tyreAge'
    ],
    layoutGrammar: 'Cruciform tyre-first layout: four large corner lozenges surround a compact center, while two vertical side rails carry shift lamps and pressure-loss direction.',
    visualLanguage: 'Scientific thermal instrument translated into a compact cockpit page, with redundant texture and numeric cues.',
    materials: ['graphite faceplate', 'satin-alloy perimeter', 'anti-reflective black glass'],
    typographyConstraints: 'Square tabular numerals, fixed LF/RF/LR/RR labels, aligned decimal places, and no color-only temperature interpretation.',
    colorConstraints: 'Use a perceptually uniform thermal scale plus hatching; cyan and amber for trend direction; red only for an unsafe threshold with text.',
    differentiation: 'Unlike the other 49 briefs, the primary silhouette is a tyre cross rather than a rectangular information stack or central driving numeral.',
    candidateWidgetConcepts: ['four tyre lozenges', 'pressure-trend arrows', 'brake-temperature halos', 'vertical shift rails', 'compact center gear tile'],
    ordinaryOverlays: ['tyre age and wear footer per corner', 'TC / ABS center chips', 'compact speed and delta line'],
    triggerOnlyAlerts: ['rapid-deflation corner takeover', 'pressure-floor warning', 'overheated-corner warning', 'diagonal-imbalance warning'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-a', 'endurance', 'gt', 'tyres', 'brakes', 'corner-grid', 'heatmap'],
    researchNotes: [
      'The current iRacing-normalized inventory guarantees cold set points, not native live hot pressure; live pressure requires an explicitly separate TPMS source.',
      'Thermal targets are car/team configured and must never be presented as universal safe values.'
    ],
    sourceIds: ['S03', 'S17'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on view of the tyre service page with the four corners clearly separated.',
      sampleReadouts: ['LF 176 kPa / 82|88|84°C', 'RF 178 kPa / 86|91|87°C', 'LR 174 kPa / 78|82|80°C', 'RR 175 kPa / 80|84|81°C'],
      requiredComposition: ['large cruciform tyre arrangement', 'brake halos immediately inside each tyre', 'thin vertical shift rails outside the cross'],
      legibility: 'Corner identity and pressure must be readable before the thermal detail; patterns must survive grayscale.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no generic four-card grid', 'no rainbow heatmap without numeric values or hatching']
    }
  },
  {
    id: 'R2-04',
    name: 'Q-Delta Compass',
    familyId: 'A',
    order: 4,
    priority: 2047,
    persona: 'Qualifying driver or coach focused on whether the current lap is gaining, losing, or invalid.',
    raceMoment: 'A flying lap approaching a decisive sector split or final-corner prediction.',
    purpose: 'Turn signed delta direction and magnitude into the dominant spatial cue instead of treating delta as a small number.',
    informationHierarchy: [
      'Primary: bilateral gain/loss vectors and predicted finish delta.',
      'Secondary: sector target beads, lap progress, and reference quality.',
      'Tertiary: gear, RPM, and short brake/throttle history.'
    ],
    requiredTelemetryConceptIds: [
      'deltaBest', 'deltaOptimal', 'lapProgress', 'gear', 'engineRpm', 'brake', 'throttle',
      'derived:predictiveLapTime', 'derived:sectorDelta', 'derived:lapValidity', 'derived:referenceQuality'
    ],
    layoutGrammar: 'A diamond-shaped compass centered on zero delta, with cyan gain vectors to the left, vermilion loss vectors to the right, sector beads on the perimeter, and a thin lap ruler below.',
    visualLanguage: 'Precision coaching instrument with minimal decoration and explicit reference confidence.',
    materials: ['charcoal composite face', 'anti-glare glass', 'fine etched zero axis'],
    typographyConstraints: 'Geometric condensed tabular type; signed values always include plus or minus; no ambiguous red/green-only semantics.',
    colorConstraints: 'Cyan/green gain, vermilion loss, white zero axis, amber stale-reference state; vector direction and labels must duplicate color.',
    differentiation: 'Unlike the other 49 briefs, delta direction and magnitude create the complete hero silhouette as a compass rather than a tachometer or timing tile.',
    candidateWidgetConcepts: ['split delta compass', 'sector beads', 'reference-quality badge', 'brake/throttle micro-history'],
    ordinaryOverlays: ['gear and RPM center capsule', 'lap-progress ruler', 'target-reference identifier'],
    triggerOnlyAlerts: ['invalid-lap diagonal mask', 'stale-reference badge', 'pit-call banner', 'yellow-flag banner'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-a', 'quali', 'delta', 'pace', 'radial', 'driver-coaching'],
    researchNotes: [
      'Reference quality and validity must remain explicit; never imply a personalized prediction when the comparison lap is stale or contaminated.',
      'The compass is an original geometry informed by analysis tooling, not a copied Cosworth or MoTeC page.'
    ],
    sourceIds: ['S04', 'S06'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic full-screen reference with a centered diamond compass and no physical product housing.',
      sampleReadouts: ['LIVE -0.184 s', 'PRED -0.267 s', 'S1 -0.092', 'S2 +0.031', 'REF QUALITY 94%'],
      requiredComposition: ['large diamond gain/loss compass', 'sector beads around the perimeter', 'thin synchronized input history below'],
      legibility: 'The sign, direction, and reference status must be understandable in grayscale and at thumbnail size.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no conventional horizontal delta bar', 'no speedometer or circular tachometer dominating the page']
    }
  },
  {
    id: 'R2-05',
    name: 'Launch/Limiter Matrix',
    familyId: 'A',
    order: 5,
    priority: 2046,
    persona: 'GT driver executing a race start, pit entry, pit stop approach, or pit exit.',
    raceMoment: 'A short transitional event where clutch, target RPM, speed compliance, and distance replace normal race-page priorities.',
    purpose: 'Provide one event-specific state machine for launch and pit-lane execution without leaving persistent race clutter on screen.',
    informationHierarchy: [
      'Primary: current phase and central countdown or distance-to-action.',
      'Secondary: clutch bite, target RPM, wheelspin, limiter state, and speed-to-limit delta.',
      'Tertiary: throttle, TC, pit-lane state, and box-arrival confirmation.'
    ],
    requiredTelemetryConceptIds: [
      'clutch', 'engineRpm', 'throttle', 'speed', 'tcActive', 'pitLimiter', 'onPitRoad',
      'inPitStall', 'pitServiceStatus', 'derived:clutchBitePoint', 'derived:speedLimitDelta',
      'derived:pitDistance', 'derived:restartCountdown'
    ],
    layoutGrammar: 'Four large cells around a central phase countdown: clutch, RPM, traction, and limiter; the matrix changes labels and emphasis by START, ENTRY, BOX, and EXIT phase.',
    visualLanguage: 'Industrial event-control display with decisive states and no persistent decorative telemetry.',
    materials: ['black anodized plate', 'rubberized edge', 'high-contrast laminated display'],
    typographyConstraints: 'Heavy monospaced numerals, single-word phase labels, large distance digits, and no sentence-length instructions.',
    colorConstraints: 'Safety yellow for prepare, white for active guidance, green for confirmed, red for stop or violation; every state includes a word or icon.',
    differentiation: 'Unlike every other entry, this is a transitional-event matrix that intentionally replaces the normal race dashboard during launch or pit procedures.',
    candidateWidgetConcepts: ['bite-point bars', 'phase countdown', 'target-RPM bracket', 'limiter compliance gauge', 'pit-box distance cell'],
    ordinaryOverlays: ['phase label and countdown', 'clutch/throttle paired bars', 'pit-lane speed delta'],
    triggerOnlyAlerts: ['stall-risk takeover', 'wheelspin takeover', 'pit-speed violation', 'pit-closure stop state', 'box-arrival confirmation'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-a', 'launch', 'pit', 'limiter', 'clutch', 'matrix', 'trigger-edge'],
    researchNotes: [
      'Clutch bite and pit distance are derived concepts and must degrade to unavailable rather than fabricate a target.',
      'The phase matrix should only appear for a detected or selected event and must not become a persistent all-purpose page.'
    ],
    sourceIds: ['S01', 'S02', 'S03'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on full-frame event page, isolated from any cockpit or physical wheel.',
      sampleReadouts: ['PHASE LAUNCH / 3.2 s', 'CLUTCH 46%', 'TARGET 4,800 rpm', 'SLIP +3%', 'LIMIT 60 / 58 km/h'],
      requiredComposition: ['four-cell matrix with a large central phase countdown', 'paired clutch bars on the left', 'limiter and pit-distance cells on the right'],
      legibility: 'Only the active phase may use dominant color; inactive cells remain readable but visually subordinate.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no permanent lap-timing dashboard', 'no start-light imitation tied to an official series']
    }
  },
  {
    id: 'R2-06',
    name: 'Qualifying Needle',
    familyId: 'B',
    order: 6,
    priority: 2045,
    persona: 'Open-wheel driver transitioning from tyre preparation to a qualifying push lap.',
    raceMoment: 'The final approach to the timing line, when tyre/brake readiness, traffic, DRS, and lap-start precision decide whether to commit.',
    purpose: 'Show whether the car and track gap are ready for a push lap, then hand focus to lap progress and delta.',
    informationHierarchy: [
      'Primary: one precision needle traversing a lap-start distance ruler and readiness band.',
      'Secondary: tyre/brake readiness, traffic gap, and delta.',
      'Tertiary: gear, DRS state, energy reserve, and lap validity.'
    ],
    requiredTelemetryConceptIds: [
      'tyreCarcassTemperature', 'brakeTemperature', 'lapProgress', 'deltaBest', 'drsState',
      'ersBattery', 'perCarRelativeTime', 'raceFlags', 'derived:closingRate',
      'derived:lapValidity', 'derived:referenceQuality'
    ],
    layoutGrammar: 'Shallow steering-wheel display with a single analog-style needle moving over a horizontal lap-distance ruler, readiness bands beneath, and a narrow traffic window above.',
    visualLanguage: 'Sunlight-readable open-wheel instrumentation: sparse, exact, and controlled rather than theatrical.',
    materials: ['satin carbon face', 'anti-reflective bonded glass', 'machined dark bezel'],
    typographyConstraints: 'Compact square tabular type with wide apertures; readiness words must remain readable in direct sunlight; no tiny legends.',
    colorConstraints: 'White/cyan normal states, amber not-ready state, red only for unsafe or invalid; readiness uses filled shape plus text.',
    differentiation: 'Unlike Sprint RPM Blade, this shallow instrument is organized around an analog lap-start needle and readiness ruler rather than an RPM strip.',
    candidateWidgetConcepts: ['lap-start needle', 'tyre/brake preparation bands', 'traffic-gap window', 'DRS and validity tell-tales'],
    ordinaryOverlays: ['front/rear readiness bands', 'traffic gap and closing-rate window', 'gear / energy / DRS footer'],
    triggerOnlyAlerts: ['tyres-not-ready warning', 'DRS-unavailable state', 'yellow-flag takeover', 'invalid-lap mask'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', 'family-b', 'open-wheel', 'quali', 'tyres', 'brakes', 'needle', 'ddu-inspired'],
    researchNotes: [
      'Readiness bands require configurable operating windows; no universal tyre or brake thresholds are implied.',
      'The form references steering-wheel ergonomics generally and must not reproduce a Formula One or Cosworth commercial layout.'
    ],
    sourceIds: ['S07', 'S30', 'S33'],
    imagePromptConstraints: {
      canvas: '1280x420 shallow steering-wheel display, straight-on orthographic reference',
      viewpoint: 'Isolated display face only, no wheel grips, buttons, cockpit, driver, or official team markings.',
      sampleReadouts: ['LINE 182 m', 'TYRE 86°C READY', 'BRAKE 412°C READY', 'GAP 4.8 s', 'DRS READY'],
      requiredComposition: ['one long precision needle over a distance ruler', 'readiness bands under the ruler', 'small traffic window above'],
      legibility: 'The readiness state and distance to line must dominate; supporting values must remain readable in simulated bright daylight.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no replica Formula One steering wheel', 'no RPM blade as the primary silhouette']
    }
  },
  {
    id: 'R2-07',
    name: 'Harvest–Deploy Orbit',
    familyId: 'B',
    order: 7,
    priority: 2044,
    persona: 'Hybrid or electric formula driver balancing usable energy against target race pace.',
    raceMoment: 'Mid-lap energy management while alternating regeneration zones and planned deployment.',
    purpose: 'Make power flow, usable reserve, and target margin spatially obvious around the central driving state.',
    informationHierarchy: [
      'Primary: opposing harvest and deploy arcs plus usable energy reserve.',
      'Secondary: energy-per-lap target margin and regeneration pulse.',
      'Tertiary: central gear, delta, brake balance, and thermal derate state.'
    ],
    requiredTelemetryConceptIds: [
      'ersBattery', 'brakeBias', 'gear', 'deltaBest', 'external:energyRegeneration',
      'external:energyDeployment', 'derived:energyPerLap', 'derived:energyTargetMargin'
    ],
    layoutGrammar: 'Concentric circular power-flow model: clockwise deployment and counter-clockwise harvest arcs orbit a central gear, with a fixed target tick and small thermal ring.',
    visualLanguage: 'Technical energy-system instrument using motion direction and arc weight rather than decorative neon.',
    materials: ['graphite composite', 'titanium-toned inner ring', 'anti-glare black glass'],
    typographyConstraints: 'Tabular numerals tangent to the orbit; no curved paragraph text; reserve and target values must have explicit units.',
    colorConstraints: 'Cyan harvest, amber deploy, white reserve, red only for unavailable or derated; arc direction and arrowheads duplicate color.',
    differentiation: 'Unlike every other entry, the complete interface is a circular power-flow model with opposing harvest and deployment motion.',
    candidateWidgetConcepts: ['energy orbit', 'target-margin tick', 'regeneration pulse', 'central gear', 'thermal-derate ring'],
    ordinaryOverlays: ['usable-energy value', 'energy-per-lap target', 'brake-balance and delta footer'],
    triggerOnlyAlerts: ['state-of-charge floor', 'over-deployment warning', 'limited-regeneration warning', 'thermal-derate takeover'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-b', 'open-wheel', 'energy', 'ers', 'radial', 'race'],
    researchNotes: [
      'Regeneration and deployment are supplemental series concepts, not asserted as current iRacing snapshot fields.',
      'The prompt must describe an original power-flow diagram and avoid copying any current Formula or Formula E wheel display.'
    ],
    sourceIds: ['S30', 'S31'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on full-screen reference with the orbit centered and no physical steering-wheel controls.',
      sampleReadouts: ['USABLE 3.8 MJ', 'HARVEST 0.42 MJ', 'DEPLOY 0.61 MJ', 'TARGET +0.08 MJ', 'GEAR 6'],
      requiredComposition: ['two opposing concentric arcs', 'central gear and reserve', 'fixed target tick with directional arrows'],
      legibility: 'Harvest and deploy must remain distinguishable without color through direction, labels, and line pattern.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no sci-fi reactor graphic', 'no battery phone UI', 'no copied Formula E display']
    }
  },
  {
    id: 'R2-08',
    name: 'Attack Gate Navigator',
    familyId: 'B',
    order: 8,
    priority: 2043,
    persona: 'Electric formula driver approaching a temporary-power activation lane while defending race position.',
    raceMoment: 'The lap segment before, through, and immediately after an activation gate.',
    purpose: 'Treat temporary power as a spatial navigation task with route, arming, timing, and energy consequences.',
    informationHierarchy: [
      'Primary: activation-lane map, gate proximity, and armed state.',
      'Secondary: remaining uses, active timer, and energy target margin.',
      'Tertiary: position, gaps, power state, and track location.'
    ],
    requiredTelemetryConceptIds: [
      'geographicPosition', 'lapProgress', 'ersBattery', 'overallPosition', 'perCarRelativeTime',
      'external:temporaryPowerZone', 'external:attackModeUses', 'external:attackModeTimer',
      'derived:energyTargetMargin'
    ],
    layoutGrammar: 'Asymmetric track-map page dominated by an offset activation lane, large gate chevrons, an armed-state bar, and a timer that grows only after a valid crossing.',
    visualLanguage: 'Spatial race-navigation instrument with electric accents grounded in real track geometry.',
    materials: ['midnight composite face', 'matte black glass', 'fine etched route line'],
    typographyConstraints: 'Geometric tabular type; activation instructions use short verbs; map labels must never crowd the gate.',
    colorConstraints: 'Electric violet for the activation route, cyan for armed/active, amber for energy deficit, red for missed or invalid crossing; labels and chevrons duplicate state.',
    differentiation: 'Unlike every other entry, temporary power is entered through a visible spatial gate and route rather than managed as a button count or energy gauge.',
    candidateWidgetConcepts: ['activation-lane map', 'armed-state indicator', 'active countdown', 'remaining-use markers', 'energy-margin bar'],
    ordinaryOverlays: ['position and gap chips', 'energy target bar', 'track-progress breadcrumb'],
    triggerOnlyAlerts: ['missed-gate warning', 'unarmed-crossing warning', 'activation-expiry countdown', 'energy-deficit warning'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-b', 'open-wheel', 'electric', 'track-map', 'boost', 'navigation'],
    researchNotes: [
      'Activation zones, use counts, and timers require a series-specific external feed and must be marked unavailable when absent.',
      'Use generic temporary-power terminology and original map styling; no Formula E logo, official iconography, or broadcast skin.'
    ],
    sourceIds: ['S31', 'S32'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic dashboard reference with the activation-lane map filling the left two-thirds.',
      sampleReadouts: ['GATE 184 m', 'ARMED', 'USES 1 / 2', 'ACTIVE 02:47', 'ENERGY -0.3%'],
      requiredComposition: ['offset track map with a clearly separate activation lane', 'large gate chevrons', 'timer and energy margin on the right'],
      legibility: 'The driver must understand route, armed state, and gate distance in one glance; map decoration must remain minimal.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no official Formula E branding', 'no generic navigation-app map pins', 'no battery-card dashboard']
    }
  },
  {
    id: 'R2-09',
    name: 'Push-to-Pass Budget Column',
    familyId: 'B',
    order: 9,
    priority: 2042,
    persona: 'Indy-style road or street-course driver timing boost use around a restart or overtaking opportunity.',
    raceMoment: 'Approach to the alternate start-finish line, restart acceleration, or a closing battle where remaining seconds matter.',
    purpose: 'Represent boost as a finite time budget with a clear legal-use boundary and per-use countdown.',
    informationHierarchy: [
      'Primary: remaining boost seconds in one tall depletion column.',
      'Secondary: active-use countdown and legal crossing marker.',
      'Tertiary: gap, throttle, tyre state, turbo/thermal restriction, and race flag.'
    ],
    requiredTelemetryConceptIds: [
      'pushToPassState', 'pushToPassAllowance', 'throttle', 'perCarRelativeTime',
      'tyreCarcassTemperature', 'raceFlags', 'perCarPushToPass', 'derived:boostCountdown',
      'derived:closingRate'
    ],
    layoutGrammar: 'One tall vertical time column slices through a compact 16:9 wheel display, with an activation ring at its base and a restart-line marker crossing the column.',
    visualLanguage: 'High-glare motorsport timer with a physical sense of depletion, not an energy battery metaphor.',
    materials: ['near-black composite face', 'high-contrast bonded glass', 'machined dark surround'],
    typographyConstraints: 'Bold DIN-like tabular seconds, large remaining-time digits, and terse legal-state text.',
    colorConstraints: 'White available time, amber reserve, cyan active use, red prohibited or thermally restricted; column texture changes with state.',
    differentiation: 'Unlike Harvest–Deploy Orbit, boost is shown as a finite vertical time budget instead of a circular energy-flow system.',
    candidateWidgetConcepts: ['seconds depletion column', 'activation ring', 'restart-line marker', 'closing-gap chip'],
    ordinaryOverlays: ['gap and closing rate', 'throttle / tyre footer', 'legal-use marker'],
    triggerOnlyAlerts: ['prohibited pre-line activation', 'low-budget warning', 'thermal-restriction warning', 'yellow-flag suppression'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', 'family-b', 'open-wheel', 'push-to-pass', 'boost', 'barv', 'restart', 'race'],
    researchNotes: [
      'The current normalized inventory exposes state/count concepts; exact total and per-use seconds may require a series-specific feed.',
      'Do not copy an IndyCar wheel, aeroscreen display, official P2P symbol, or series typography.'
    ],
    sourceIds: ['S23', 'S24'],
    imagePromptConstraints: {
      canvas: '1024x576 compact 16:9 wheel-display reference, straight-on',
      viewpoint: 'Isolated screen face without wheel grips, cockpit, aeroscreen, car, or driver.',
      sampleReadouts: ['P2P 38 s', 'ACTIVE 6.4 s', 'LINE 112 m', 'GAP 0.62 s', 'THROTTLE 96%'],
      requiredComposition: ['one tall central depletion column', 'activation ring at the bottom', 'horizontal legal-use line marker'],
      legibility: 'Remaining seconds and legal state must dominate; the column must read as time, not battery charge.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no official IndyCar marks', 'no energy orbit', 'no generic progress-card layout']
    }
  },
  {
    id: 'R2-10',
    name: 'Aero Balance Ribbon',
    familyId: 'B',
    order: 10,
    priority: 2041,
    persona: 'Open-wheel driver and setup engineer diagnosing entry, apex, and exit balance.',
    raceMoment: 'Practice run or setup comparison where vehicle response matters more than lap-time presentation.',
    purpose: 'Make front/rear balance and corner-phase behavior legible along the car axis.',
    informationHierarchy: [
      'Primary: front/rear balance ribbons aligned to a side-view vehicle axis.',
      'Secondary: entry, apex, and exit phase bands with yaw and slip markers.',
      'Tertiary: brake bias, differential or setup state, steering, G, and delta.'
    ],
    requiredTelemetryConceptIds: [
      'brakeBias', 'steeringAngle', 'angularRates', 'accelerationVector', 'brake', 'throttle',
      'antiRollFront', 'antiRollRear', 'weightJackerRight', 'deltaBest',
      'derived:yawBalance', 'derived:tyreSlip', 'derived:cornerPhase',
      'derived:balanceByCornerPhase', 'external:setupSheet'
    ],
    layoutGrammar: 'A side-view car datum runs horizontally through the screen; front and rear ribbons expand or contract above it, while three phase bands segment entry, apex, and exit.',
    visualLanguage: 'Vehicle-dynamics schematic with precise motion cues and restrained technical annotation.',
    materials: ['matte composite panel', 'etched titanium datum line', 'anti-glare clear layer'],
    typographyConstraints: 'Narrow technical sans, aligned setup values, and explicit FRONT/REAR and ENTRY/APEX/EXIT labels.',
    colorConstraints: 'Cyan front response, amber rear response, white neutral datum, red only for unstable or fault states; patterns distinguish axles.',
    differentiation: 'Unlike the other 49 briefs, this is a vehicle-axis setup schematic rather than a timing, energy, or conventional driver dashboard.',
    candidateWidgetConcepts: ['front/rear balance ribbon', 'corner-phase selector', 'yaw arrow', 'slip markers', 'setup-state rail'],
    ordinaryOverlays: ['brake bias and migration strip', 'steering / lateral-G footer', 'selected setup run identifier'],
    triggerOnlyAlerts: ['unstable-rear warning', 'lockup-bias warning', 'control-setting mismatch', 'sensor-fault state'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-b', 'open-wheel', 'setup', 'chassis', 'engineer', 'linear'],
    researchNotes: [
      'Only player-car controls and dynamics are valid; never infer opponent throttle, brake, steering, or setup.',
      'Setup-sheet fields outside the normalized snapshot must be supplied explicitly and labeled as external.'
    ],
    sourceIds: ['S07', 'S30'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on technical display reference, not a rendered vehicle or cockpit.',
      sampleReadouts: ['ENTRY F +8 / R -3', 'APEX YAW +1.8°/s', 'EXIT SLIP R 4.2%', 'BB 56.1%', 'DELTA +0.12 s'],
      requiredComposition: ['horizontal side-view car datum', 'front and rear ribbons', 'three clearly segmented corner phases'],
      legibility: 'Axle and phase meaning must be understandable without color; motion arrows cannot obscure numeric values.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no photoreal car silhouette', 'no generic setup spreadsheet', 'no copied steering-wheel screen']
    }
  },
  {
    id: 'R2-11',
    name: 'Virtual Energy Ledger',
    familyId: 'C',
    order: 11,
    priority: 2040,
    persona: 'GTP driver or strategist monitoring a regulated virtual-energy stint.',
    raceMoment: 'Mid-stint energy accounting and the approach to a replenishment stop.',
    purpose: 'Explain regulated energy use as debits, credits, and predicted compliance rather than as a generic fuel gauge.',
    informationHierarchy: [
      'Primary: virtual energy remaining and predicted stint-end balance.',
      'Secondary: target energy per lap, debit/credit waterfall, and replenishment projection.',
      'Tertiary: fuel, state of charge, pace, and regeneration/deployment context.'
    ],
    requiredTelemetryConceptIds: [
      'ersBattery', 'fuelLevel', 'fuelPerLap', 'deltaBest', 'external:virtualEnergyAllocation',
      'external:energyRegeneration', 'external:energyDeployment', 'derived:energyPerLap',
      'derived:predictedStintEnd'
    ],
    layoutGrammar: 'Accounting-ledger composition with a large virtual tank balance, a vertical debit/credit waterfall, a journal of the last laps, and a pit replenishment calculator.',
    visualLanguage: 'Endurance operations interface borrowing ledger logic without looking like financial software.',
    materials: ['dark navy composite', 'titanium dividers', 'low-glare bonded display'],
    typographyConstraints: 'Monospaced figures aligned by decimal and unit; ledger rows must be dense but never resemble office tables.',
    colorConstraints: 'Amber debits, cyan credits, white balance, red only for predicted compliance failure; plus/minus signs and arrows duplicate color.',
    differentiation: 'Unlike Fuel Horizon, this brief reports regulated energy transactions and replenishment compliance rather than uncertain fuel range.',
    candidateWidgetConcepts: ['virtual tank balance', 'energy journal', 'debit/credit waterfall', 'pit replenishment calculator'],
    ordinaryOverlays: ['pace and target-MJ line', 'fuel / SOC footer', 'last-three-lap transaction journal'],
    triggerOnlyAlerts: ['predicted-energy deficit', 'virtual tank empty', 'short replenishment', 'compliance-breach takeover'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-c', 'endurance', 'prototype', 'energy', 'strategy', 'table'],
    researchNotes: [
      'Virtual energy and replenishment rules require an IMSA/WEC-specific external model and must not be mislabeled as raw iRacing telemetry.',
      'Use the transaction metaphor only; do not reproduce an official timing or team pit-wall screen.'
    ],
    sourceIds: ['S10', 'S11', 'S14'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on endurance operations page with no monitors, pit wall, people, or race footage.',
      sampleReadouts: ['VIRTUAL 312.4 MJ', 'TARGET 4.82 MJ/lap', 'LAST -4.91 MJ', 'REGEN +0.63 MJ', 'STINT END +6.8 MJ'],
      requiredComposition: ['large balance at upper left', 'central debit/credit waterfall', 'three-lap journal and replenishment calculator'],
      legibility: 'Transaction signs, units, and predicted compliance must be readable at review-table scale.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no banking app aesthetic', 'no fuel-pump icon as the hero', 'no official IMSA or WEC graphics']
    }
  },
  {
    id: 'R2-12',
    name: 'Nine-Zone Marshal Map',
    familyId: 'C',
    order: 12,
    priority: 2039,
    persona: 'Le Mans-style endurance driver approaching a slow zone, full-course neutralization, or safety-car instruction.',
    raceMoment: 'Seconds before zone entry, during speed compliance, or while merging under race-control procedure.',
    purpose: 'Prioritize spatial compliance and required speed so the driver knows where the next controlled zone starts and what action applies.',
    informationHierarchy: [
      'Primary: full-canvas circuit map divided into nine explicit marshal zones.',
      'Secondary: next-zone distance, required speed, and speed-to-limit delta.',
      'Tertiary: pit state, merge/pass-around instruction, and race-control acknowledgement.'
    ],
    requiredTelemetryConceptIds: [
      'geographicPosition', 'lapProgress', 'speed', 'pitLimiter', 'pitsOpen', 'raceFlags',
      'external:neutralizationZone', 'external:raceControlInstruction',
      'derived:speedLimitDelta', 'derived:pitDistance'
    ],
    layoutGrammar: 'The circuit map fills the canvas and is segmented into nine labeled zones; the active and next zones enlarge while a compliance bar sits directly beneath the map.',
    visualLanguage: 'Road-sign clarity translated into an endurance DDU, with direct spatial hierarchy and no broadcast ornament.',
    materials: ['rubberized black bezel', 'matte black display', 'high-contrast route line'],
    typographyConstraints: 'DIN-like signage type, large zone numerals, exact speed units, and verb-first instructions.',
    colorConstraints: 'Road-sign yellow and white for controlled zones, green for released, red for stop; hatch patterns and labels prevent color-only meaning.',
    differentiation: 'Unlike Race Control Incident Wall, this is a single-car spatial compliance instrument focused on one route and one instruction sequence.',
    candidateWidgetConcepts: ['nine-zone map', 'next-zone distance marker', 'speed-delta bar', 'pit-state badge', 'instruction banner'],
    ordinaryOverlays: ['current / next zone labels', 'required speed and delta', 'pit-open and acknowledgement footer'],
    triggerOnlyAlerts: ['zone-entry takeover', 'overspeed warning', 'pit-closure state', 'merge or pass-around instruction'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-c', 'endurance', 'race-control', 'track-map', 'flags', 'driver'],
    researchNotes: [
      'Zone geometry and procedure are external race-control data; the live player position must be matched without fabricating instructions.',
      'The nine-zone treatment is original and must not reproduce an official Le Mans timing screen or circuit map artwork.'
    ],
    sourceIds: ['S12', 'S41'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic full-frame driver display with the circuit map filling most of the image.',
      sampleReadouts: ['ZONE 4 ACTIVE', 'NEXT Z5 620 m', 'LIMIT 80 km/h', 'DELTA -3 km/h', 'PITS OPEN'],
      requiredComposition: ['circuit divided into exactly nine visible zones', 'active and next zones enlarged or emphasized', 'large compliance bar below'],
      legibility: 'Zone number, distance, required speed, and instruction must remain readable under vibration and at thumbnail scale.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no official Le Mans circuit artwork', 'no incident mosaic', 'no unlabeled color-only zones']
    }
  },
  {
    id: 'R2-13',
    name: 'Multiclass Traffic Loom',
    familyId: 'C',
    order: 13,
    priority: 2038,
    persona: 'Prototype or faster-class endurance driver predicting how traffic will unfold through the next corners.',
    raceMoment: 'Closing on slower-class traffic, being caught by a faster class, or planning an overtake around a pit cycle.',
    purpose: 'Show class-relative closing rates and predicted catch points without reducing multiclass traffic to a generic radar circle.',
    informationHierarchy: [
      'Primary: three woven traffic lanes for faster class, own class, and slower class.',
      'Secondary: closing rate, overlap, and predicted catch location.',
      'Tertiary: class position, blue flag, pit state, and unsafe-rejoin context.'
    ],
    requiredTelemetryConceptIds: [
      'classIdentity', 'perCarProgress', 'perCarEstimatedTime', 'perCarRelativeTime',
      'proximity', 'raceFlags', 'perCarPitRoad', 'perCarTrackLocation',
      'derived:closingRate', 'derived:predictedCatchPoint'
    ],
    layoutGrammar: 'Three horizontal strands weave toward a shared upcoming-corner marker; nearby cars appear as labeled beads whose spacing and arrow length encode closing behavior.',
    visualLanguage: 'Dense but glanceable multiclass predictor using lane topology, pattern, and class labels.',
    materials: ['dark carbon face', 'smoked black glass', 'fine woven lane texture'],
    typographyConstraints: 'Condensed tabular type, short class labels, explicit signed time gaps, and no opponent input claims.',
    colorConstraints: 'Pattern-coded class accents with lightness separation; orange for immediate overlap; every class remains identifiable in grayscale.',
    differentiation: 'Unlike Multiclass Story Mosaic, this is an immediate driver traffic predictor rather than an editorial summary for viewers.',
    candidateWidgetConcepts: ['three traffic strands', 'catch-point marker', 'class-position chip', 'overlap bead', 'pit-state glyph'],
    ordinaryOverlays: ['own-class position chip', 'next-corner catch label', 'pit and blue-flag context'],
    triggerOnlyAlerts: ['car alongside', 'rapid-closing threat', 'blue-flag instruction', 'unsafe-rejoin warning'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-c', 'endurance', 'multiclass', 'traffic', 'relative', 'driver'],
    researchNotes: [
      'Opponent data is limited to timing, relative, position, track state, and proximity; never invent opponent throttle, brake, steering, or tyre temperatures.',
      'Class styling must use shape and pattern in addition to color.'
    ],
    sourceIds: ['S12', 'S13', 'S16'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on driver display with three woven lanes spanning the width.',
      sampleReadouts: ['HYP +8.2 s', 'OWN P3 / +0.7 s', 'GT -3.4 s / CATCH T8', 'BLUE FLAG', 'PIT OUT 14 s'],
      requiredComposition: ['exactly three labeled class strands', 'car beads with directional arrows', 'one shared predicted-catch marker'],
      legibility: 'Class, direction, and time gap must remain clear without relying on hue; avoid crowding more than six nearby cars.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no circular radar', 'no broadcast timing tower', 'no opponent control traces']
    }
  },
  {
    id: 'R2-14',
    name: 'Stint Health Quadrant',
    familyId: 'C',
    order: 14,
    priority: 2037,
    persona: 'GT endurance driver and engineer deciding whether the current stint can continue safely and competitively.',
    raceMoment: 'Late in a fuel or driver stint, before a scheduled stop, or after pace begins to decay.',
    purpose: 'Balance tyres, brakes, fuel, and driver time equally around a compact driving core.',
    informationHierarchy: [
      'Primary: four equal health quadrants for tyres, brakes, fuel, and driver-time compliance.',
      'Secondary: pace decay, class position, and stint clock.',
      'Tertiary: compact gear, speed, and engine vital state.'
    ],
    requiredTelemetryConceptIds: [
      'tyreColdPressure', 'tyreCarcassTemperature', 'tyreWear', 'brakeTemperature',
      'fuelLevel', 'fuelPerLap', 'engineWarnings', 'driverIdentity', 'classPosition',
      'derived:fuelLapsRemaining', 'derived:driverStintTime', 'derived:paceDecay',
      'external:driverTimeRules'
    ],
    layoutGrammar: 'Four equally weighted quadrants surround a small gear/speed core; each quadrant has one hero metric, one trend, and one compact remaining-life estimate.',
    visualLanguage: 'Calm endurance DDU with balanced resource status and restrained alerting.',
    materials: ['black carbon face', 'soft anti-glare coating', 'subtle machined corner markers'],
    typographyConstraints: 'Tabular numerals with consistent units; quadrant titles limited to TYRE, BRAKE, FUEL, DRIVER; no dense prose.',
    colorConstraints: 'Neutral white baseline with one restrained accent per resource; amber trend risk, red only for a breach; shape and label accompany state.',
    differentiation: 'Unlike Mechanical Health Sextant, this quadrant page measures whole-stint readiness and strategy resources rather than only vintage mechanical condition.',
    candidateWidgetConcepts: ['four health quadrants', 'stint clock', 'pace-decay sparkline', 'class-position tab', 'compact gear/speed core'],
    ordinaryOverlays: ['stint elapsed / remaining', 'class position', 'pace-decay trend'],
    triggerOnlyAlerts: ['pressure or fluid leak warning', 'brake overtemperature', 'fuel shortfall', 'driver-time limit'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-c', 'endurance', 'gt', 'stint', 'strategy', 'corner-grid'],
    researchNotes: [
      'Driver-time rules require an external series rule feed and current-driver identity history.',
      'Pressure must use the available source honestly; no native live iRacing pressure is assumed.'
    ],
    sourceIds: ['S13', 'S15', 'S17'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic full-screen endurance page with four equal quadrants.',
      sampleReadouts: ['TYRE 72% / 9 laps', 'BRAKE 612°C / OK', 'FUEL 11.4 laps', 'DRIVER 42:18 / 17:42', 'PACE +0.38 s'],
      requiredComposition: ['four equal resource quadrants', 'small central gear/speed core', 'one trend line per quadrant maximum'],
      legibility: 'All four resources must read with equal weight; no quadrant may become a generic card with oversized decoration.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no business KPI quadrant dashboard', 'no unequal hero quadrant', 'no vintage analog gauges']
    }
  },
  {
    id: 'R2-15',
    name: 'Night Driver-Swap Continuity',
    familyId: 'C',
    order: 15,
    priority: 2036,
    persona: 'Current endurance driver and pit crew coordinating a night-time handover.',
    raceMoment: 'The laps before a driver change, pit approach, physical handoff, and first lap of the incoming stint.',
    purpose: 'Keep outgoing and incoming driver state continuous so eligibility, timing, lighting, weather, and readiness are not lost at handover.',
    informationHierarchy: [
      'Primary: parallel outgoing and incoming driver timelines plus the swap window.',
      'Secondary: pit ETA, eligibility, readiness checklist, and light state.',
      'Tertiary: fuel, lap pace, class gap, rain, and visibility.'
    ],
    requiredTelemetryConceptIds: [
      'driverIdentity', 'fuelLevel', 'perCarRelativeTime', 'timeOfDay', 'precipitation',
      'fogLevel', 'raceFlags', 'derived:driverStintTime', 'derived:pitEta',
      'external:driverTimeRules', 'external:lightingState', 'external:driverSwapReadiness'
    ],
    layoutGrammar: 'Two parallel timelines run left to right—outgoing above, incoming below—with a central handoff gate, synchronized checklist, and a low-luminance light-status rail.',
    visualLanguage: 'Night endurance operations display with subdued luminance and explicit handoff state.',
    materials: ['midnight-blue composite', 'low-reflection glass', 'soft-touch dark bezel'],
    typographyConstraints: 'Wide tabular numerals, mixed-case driver names, large time remaining, and no small all-caps paragraphs.',
    colorConstraints: 'Soft white and low-luminance amber, cyan for ready, red only for missed or unsafe; avoid bright saturated backgrounds that destroy night vision.',
    differentiation: 'Unlike Classic Enduro Chronograph, this is a live operational handoff with two people and a checklist, not a heritage elapsed-time instrument.',
    candidateWidgetConcepts: ['dual driver timelines', 'handoff gate', 'incoming-readiness checklist', 'light-status rail', 'pit ETA'],
    ordinaryOverlays: ['fuel and class-gap footer', 'weather / visibility strip', 'outgoing and incoming eligibility clocks'],
    triggerOnlyAlerts: ['driver-time limit', 'missed swap window', 'lighting failure', 'rain onset'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-c', 'endurance', 'night', 'driver', 'pit', 'timeline'],
    researchNotes: [
      'Eligibility, planned driver, and readiness are external operational data and must show their source and freshness.',
      'Night styling must preserve contrast without flooding the display with bright blue or white.'
    ],
    sourceIds: ['S12', 'S13'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on night-mode operations page with low ambient luminance and no cockpit or pit-crew scene.',
      sampleReadouts: ['OUT A. DRIVER 42:18', 'IN B. DRIVER READY', 'WINDOW 2 laps', 'PIT ETA 03:41', 'LIGHTS OK / RAIN 18%'],
      requiredComposition: ['two parallel driver timelines', 'central handoff gate', 'readiness checklist and light-status rail'],
      legibility: 'Use low luminance while retaining WCAG-like text contrast; no bloom, glow, or tiny status text.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no bright neon night theme', 'no analog chronograph', 'no photographic pit-stop scene']
    }
  },
  {
    id: 'R2-16',
    name: 'Three-Lane Spotter Stack',
    familyId: 'D',
    order: 16,
    priority: 2035,
    persona: 'Oval driver in dense pack traffic relying on immediate inside/outside awareness.',
    raceMoment: 'Three-wide running, pit exit into traffic, or a crash developing ahead.',
    purpose: 'Model oval lanes explicitly so overlap, closing direction, and clear state are faster to understand than a circular radar.',
    informationHierarchy: [
      'Primary: inside, center, and outside lane occupancy with overlap.',
      'Secondary: closing rate and clear-state banner.',
      'Tertiary: speed delta, flag state, pit-exit traffic, and crash-ahead direction.'
    ],
    requiredTelemetryConceptIds: [
      'proximity', 'perCarRelativeTime', 'speed', 'raceFlags', 'perCarPitRoad',
      'perCarTrackLocation', 'derived:closingRate'
    ],
    layoutGrammar: 'Three tall parallel lane columns fill the canvas; the player occupies the center datum while opponent markers stretch longitudinally to show overlap and closing.',
    visualLanguage: 'High-contrast oval spotter instrument with lane paint, large state words, and no decorative map.',
    materials: ['matte black panel', 'painted lane-line texture', 'anti-glare display glass'],
    typographyConstraints: 'Tall condensed type for INSIDE, OUTSIDE, THREE-WIDE, and CLEAR; no small driver names in the threat area.',
    colorConstraints: 'White lane lines, orange immediate threat, green clear, red wreck; lane position and labels must work without color.',
    differentiation: 'Unlike Haptic Proximity Compass, this brief represents oval lane geometry as three explicit vertical stacks rather than an eight-sector radial field.',
    candidateWidgetConcepts: ['three lane stacks', 'overlap markers', 'clear-state banner', 'crash-ahead arrow', 'pit-exit lane'],
    ordinaryOverlays: ['speed delta per adjacent car', 'pit-exit indicator', 'compact flag state'],
    triggerOnlyAlerts: ['car inside', 'car outside', 'three-wide takeover', 'clear confirmation', 'wreck-ahead warning', 'pit-traffic warning'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-d', 'oval', 'traffic', 'radar', 'spotter', 'race'],
    researchNotes: [
      'Use only player-centric proximity, relative timing, and track state; do not infer opponent control inputs.',
      'Audio or Crew Chief integration may supplement the visual state but is not assumed by this registry.'
    ],
    sourceIds: ['S25', 'S40'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic spotter display with three tall lanes and no track camera or car rendering.',
      sampleReadouts: ['INSIDE -0.2 s', 'CENTER PLAYER', 'OUTSIDE +0.1 s', 'THREE-WIDE', 'WRECK T3'],
      requiredComposition: ['exactly three tall lane columns', 'player fixed in center datum', 'large clear or threat banner across the top'],
      legibility: 'Threat direction must be obvious in peripheral vision; car markers cannot overlap labels.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no circular radar', 'no full circuit map', 'no tiny leaderboard rows']
    }
  },
  {
    id: 'R2-17',
    name: 'Choose-V Restart Board',
    familyId: 'D',
    order: 17,
    priority: 2034,
    persona: 'Stock-car driver selecting a restart lane at one-to-go.',
    raceMoment: 'Approach to the choose zone, lane commitment, and restart-zone launch.',
    purpose: 'Turn the painted V decision into the composition itself so lane choice, row, and countdown cannot be missed.',
    informationHierarchy: [
      'Primary: giant V-shaped lane fork and selected branch.',
      'Secondary: row, restart-zone distance, and leader-motion countdown.',
      'Tertiary: position, gear, and tyre readiness.'
    ],
    requiredTelemetryConceptIds: [
      'paceFormation', 'overallPosition', 'lapProgress', 'gear', 'tyreCarcassTemperature',
      'paceFlags', 'external:chooseZone', 'derived:restartCountdown'
    ],
    layoutGrammar: 'A giant white V begins at the bottom center and opens into two lane branches; row markers sit on the arms and a restart ruler spans the top.',
    visualLanguage: 'Asphalt-and-paint decision board with simple procedural geometry.',
    materials: ['asphalt-gray face', 'matte white paint marks', 'rubberized black surround'],
    typographyConstraints: 'Industrial stencil numerals and short lane words; the selected branch uses a large row marker.',
    colorConstraints: 'White paint geometry, yellow countdown, cyan selected path, red violation; branch shape and labels duplicate color.',
    differentiation: 'Unlike every other entry, the entire composition is the choose-lane decision, with a giant V derived from track geometry.',
    candidateWidgetConcepts: ['V branch selector', 'row markers', 'restart ruler', 'leader-motion cue'],
    ordinaryOverlays: ['position / row chip', 'gear and tyre readiness footer', 'distance-to-choose marker'],
    triggerOnlyAlerts: ['missed-choice warning', 'wrong-lane warning', 'leader-launch cue', 'line-violation warning'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-d', 'oval', 'restart', 'formation', 'race-control', 'minimal'],
    researchNotes: [
      'Choose-zone state is series-specific external procedure data; formation line/row should use verified pace information when available.',
      'Use generic painted-track geometry and no NASCAR wordmarks, car numbers, broadcast fonts, or official iconography.'
    ],
    sourceIds: ['S20', 'S21'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on procedural display with asphalt texture kept subtle and no real track photograph.',
      sampleReadouts: ['CHOOSE 148 m', 'LEFT SELECTED', 'ROW 4', 'RESTART 312 m', 'LEADER HOLD'],
      requiredComposition: ['giant V fork occupying most of the screen', 'row markers on both branches', 'restart ruler across the top'],
      legibility: 'Selected lane, row, and distance must read instantly; texture cannot reduce text contrast.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no official NASCAR branding', 'no aerial track photo', 'no conventional two-column menu']
    }
  },
  {
    id: 'R2-18',
    name: 'Stage Points Clock',
    familyId: 'D',
    order: 18,
    priority: 2033,
    persona: 'Stock-car driver and crew managing position, fuel, and points near a stage end.',
    raceMoment: 'Final laps of a scoring stage, when one pass or one fuel-saving lap changes points.',
    purpose: 'Make laps remaining and projected sporting points the hero rather than treating the stage as a normal race timer.',
    informationHierarchy: [
      'Primary: circular stage clock segmented by remaining laps and points.',
      'Secondary: projected points ladder and pass requirement.',
      'Tertiary: fuel-to-stage, tyre age, gap, and running position.'
    ],
    requiredTelemetryConceptIds: [
      'lapsRemaining', 'overallPosition', 'fuelLevel', 'fuelPerLap', 'tyreWear',
      'perCarRelativeTime', 'external:stageDefinition', 'external:stagePoints',
      'derived:stagePointsProjection', 'derived:fuelLapsRemaining'
    ],
    layoutGrammar: 'A large clock face uses lap segments as the dial and points values as the inner ring; a vertical projected-points ladder sits beside it.',
    visualLanguage: 'Sporting-outcome instrument with a measured dial, not a broadcast infographic.',
    materials: ['dark slate face', 'matte dial markings', 'smoked glass'],
    typographyConstraints: 'Condensed digital numerals for laps and position, tabular points, and no decorative team or car branding.',
    colorConstraints: 'White dial, gold points, amber fuel margin, red threshold miss; points thresholds also use tick shape and labels.',
    differentiation: 'Unlike every other entry, sporting points rather than lap time, energy, or vehicle state form the hero visualization.',
    candidateWidgetConcepts: ['stage clock', 'points ladder', 'fuel-to-stage marker', 'pass-requirement arrow'],
    ordinaryOverlays: ['running position', 'gap to scoring threshold', 'tyre age and fuel margin'],
    triggerOnlyAlerts: ['final-stage-lap takeover', 'points-threshold change', 'fuel-shortfall warning', 'changed-stage-state warning'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-d', 'oval', 'stage', 'points', 'strategy', 'dial'],
    researchNotes: [
      'Stage definitions and point allocation are external sporting-rule data and must be versioned by series.',
      'Use generic points logic and original typography; no NASCAR logo, broadcast package, or licensed driver identity.'
    ],
    sourceIds: ['S19'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic full-screen dashboard with one dominant scoring clock.',
      sampleReadouts: ['STAGE 7 laps', 'RUNNING P8', 'PROJECTED 29 pts', 'PASS FOR +2', 'FUEL +0.6 lap'],
      requiredComposition: ['large segmented lap clock', 'inner points ring', 'projected-points ladder beside the clock'],
      legibility: 'Laps and projected points must dominate; point increments must be readable without relying on gold color.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no official NASCAR points graphic', 'no generic wall clock', 'no leaderboard as the hero']
    }
  },
  {
    id: 'R2-19',
    name: 'Caution Pit Eligibility Panel',
    familyId: 'D',
    order: 19,
    priority: 2032,
    persona: 'Oval driver and crew chief deciding whether and how to pit under caution.',
    raceMoment: 'Caution period approaching pit entry, service execution, or one-to-go.',
    purpose: 'Present pit-open state, procedural order, speed compliance, and required service as one deterministic checklist.',
    informationHierarchy: [
      'Primary: pit gate state and procedural order.',
      'Secondary: commitment-line distance and speed-to-limit delta.',
      'Tertiary: selected service, completion state, running position, and restart status.'
    ],
    requiredTelemetryConceptIds: [
      'raceFlags', 'pitsOpen', 'onPitRoad', 'pitLimiter', 'pitServicesSelected',
      'pitServiceStatus', 'overallPosition', 'paceFormation', 'external:raceControlInstruction',
      'derived:pitDistance', 'derived:speedLimitDelta'
    ],
    layoutGrammar: 'A large traffic-light gate occupies the left half; the right half is a numbered procedural checklist, with a commitment-line meter across the bottom.',
    visualLanguage: 'Industrial caution procedure panel with labeled states and deliberate visual redundancy.',
    materials: ['black anodized face', 'safety-marked matte surface', 'anti-glare display'],
    typographyConstraints: 'Industrial stencil headings, large OPEN/CLOSED text, numbered checklist steps, and exact speed units.',
    colorConstraints: 'Yellow caution base, labeled green/red pit state, white checklist; no color-only eligibility decision.',
    differentiation: 'Unlike Pit Window Gantt, this page handles immediate rules under neutralization rather than planned future strategy.',
    candidateWidgetConcepts: ['pit gate', 'commitment-line meter', 'service checklist', 'one-to-go state', 'speed compliance'],
    ordinaryOverlays: ['position and pace-row footer', 'selected service list', 'commitment-line distance'],
    triggerOnlyAlerts: ['pit-closed takeover', 'pit-speed warning', 'incomplete-service warning', 'one-to-go takeover'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-d', 'oval', 'pit', 'race-control', 'flags', 'status'],
    researchNotes: [
      'Procedural order beyond live pit and pace state requires an external race-control instruction feed.',
      'The panel must never imply permission when pit-open or instruction data is stale or unavailable.'
    ],
    sourceIds: ['S20', 'S22', 'S41'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on procedure display with no pit-road photograph, people, or vehicle.',
      sampleReadouts: ['PIT OPEN', 'ENTRY 540 m', 'LIMIT 72 / 69 km/h', 'STEP 2: FUEL + TYRES', 'ONE TO GO'],
      requiredComposition: ['large labeled traffic-light gate', 'numbered checklist', 'full-width commitment-line meter'],
      legibility: 'OPEN/CLOSED and speed compliance must be unmistakable in grayscale and at a glance.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no official penalty card design', 'no business checklist UI', 'no unlabeled red/green lights']
    }
  },
  {
    id: 'R2-20',
    name: 'Draft-Train Fuel Saver',
    familyId: 'D',
    order: 20,
    priority: 2031,
    persona: 'Indy-style oval driver maintaining a long green-flag fuel number inside a draft pack.',
    raceMoment: 'Sustained pack running where lifting, staying attached, and thermal control determine whether the stint reaches its target.',
    purpose: 'Couple fuel saving directly to the topology of the draft train instead of showing range in isolation.',
    informationHierarchy: [
      'Primary: draft-string position and target fuel number.',
      'Secondary: lift target, pack-loss prediction, and laps remaining.',
      'Tertiary: tyre age, hybrid state, relative speed, and engine temperature.'
    ],
    requiredTelemetryConceptIds: [
      'fuelPerLap', 'fuelLevel', 'perCarRelativeTime', 'tyreWear', 'ersBattery',
      'lapsRemaining', 'engineWarnings', 'derived:liftTarget', 'derived:draftPackTopology',
      'derived:fuelLapsRemaining', 'derived:closingRate'
    ],
    layoutGrammar: 'Nearby cars appear as beads on one horizontal draft string; the player bead anchors the center, while a fuel horizon and lift target run directly below the string.',
    visualLanguage: 'Oval strategy instrument with a simple pack topology and exact fuel target.',
    materials: ['charcoal composite', 'matte black display', 'subtle bead-track texture'],
    typographyConstraints: 'Tabular fuel numbers and signed gaps; car beads use numbers or class labels, never sponsor marks.',
    colorConstraints: 'Cyan pack markers, amber fuel target, white player bead, red pack-loss or thermal risk; bead shape duplicates status.',
    differentiation: 'Unlike Fuel Horizon, the range forecast is explicitly coupled to slipstream position and pack connectivity.',
    candidateWidgetConcepts: ['draft string', 'target-number gauge', 'pack-loss predictor', 'lift marker', 'fuel horizon'],
    ordinaryOverlays: ['laps and fuel margin', 'tyre age', 'hybrid and temperature footer'],
    triggerOnlyAlerts: ['fuel-target miss', 'falling-out-of-draft warning', 'overlap warning', 'thermal-rise warning'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-d', 'oval', 'fuel-save', 'traffic', 'strategy', 'linear'],
    researchNotes: [
      'Draft topology is derived from relative timing and position, not opponent aero or throttle data.',
      'Hybrid state is optional by car; unavailable channels must collapse without substituting fake values.'
    ],
    sourceIds: ['S23', 'S25', 'S26'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic oval strategy display with one horizontal bead string and no car renderings.',
      sampleReadouts: ['TARGET 2.31 kg/lap', 'ACTUAL 2.38', 'LIFT 86 m', 'PACK P5 / +0.42 s', 'RANGE +1.2 laps'],
      requiredComposition: ['horizontal train of car-number beads', 'player bead centered', 'fuel horizon and lift marker immediately below'],
      legibility: 'Pack order and fuel target must be readable without car liveries or logos; limit the visible train to actionable neighbors.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no photoreal race cars', 'no standalone fan forecast', 'no official IndyCar styling']
    }
  },
  {
    id: 'R2-21',
    name: 'Pacenote Cascade',
    familyId: 'E',
    order: 21,
    priority: 2030,
    persona: 'Rally co-driver or driver consuming a rapid sequence of road instructions.',
    raceMoment: 'Mid-stage with one immediate corner, two linked follow-up notes, and a developing hazard.',
    purpose: 'Make the next pacenote dominant while preserving the rhythm and distance of the following sequence.',
    informationHierarchy: [
      'Primary: next pacenote symbol, modifier, and distance.',
      'Secondary: next two notes with decreasing size and confidence.',
      'Tertiary: hazard strip, speed, and stage progress.'
    ],
    requiredTelemetryConceptIds: [
      'speed', 'lapProgress', 'external:pacenoteSequence',
      'derived:pacenoteDistance', 'derived:stageProgress'
    ],
    layoutGrammar: 'Portrait waterfall of progressively smaller pacenote cards: the current note fills the upper third, following notes recede downward, and a narrow hazard strip remains fixed at the side.',
    visualLanguage: 'Rugged rally notation board using original glyphs, paper-like hierarchy, and direct distance rhythm.',
    materials: ['warm-gray rugged face', 'ivory note surfaces', 'rubberized dark frame'],
    typographyConstraints: 'Large monospace distances, custom generic rally glyphs, short modifiers, and no copied commercial pacenote icon set.',
    colorConstraints: 'Black glyphs on ivory, orange hazards, red stop or red flag; hazards use icons and text as well as color.',
    differentiation: 'Unlike Captioned Radio/Race-State Board, this is a predictive road-description stream rather than a chronological communication log.',
    candidateWidgetConcepts: ['next-note card', 'distance drum', 'following-note cascade', 'hazard strip', 'stage-progress line'],
    ordinaryOverlays: ['current speed', 'stage progress', 'note confidence/source indicator'],
    triggerOnlyAlerts: ['unseen-hazard takeover', 'note-mismatch warning', 'red-flag takeover', 'flying-finish cue'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', 'portrait', 'family-e', 'rally', 'pacenotes', 'stage', 'driver', 'timeline'],
    researchNotes: [
      'Pacenotes are an external authored feed; the registry does not claim that the normalized iRacing snapshot supplies them.',
      'Use original generic glyphs and notation rather than copying WRC, game, or commercial co-driver icon artwork.'
    ],
    sourceIds: ['S27'],
    imagePromptConstraints: {
      canvas: '600x1024 portrait rally display, straight-on orthographic reference',
      viewpoint: 'Isolated portrait display with no rally cockpit, road photograph, co-driver, or paper notebook.',
      sampleReadouts: ['120', 'L4 TIGHTENS 3', '50 CREST', 'R2 DONT CUT', 'STAGE 63%'],
      requiredComposition: ['one dominant current note', 'two progressively smaller following notes', 'fixed narrow hazard strip'],
      legibility: 'The next symbol and distance must remain readable in peripheral vision; future notes may be smaller but never ambiguous.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no copied rally-game pacenote icons', 'no chat-message bubbles', 'no generic stacked business cards']
    }
  },
  {
    id: 'R2-22',
    name: 'Split/Flying-Finish Ledger',
    familyId: 'E',
    order: 22,
    priority: 2029,
    persona: 'Rally crew tracking official stage splits, flying finish, stop control, and liaison target time.',
    raceMoment: 'Crossing a split, reaching flying finish, or approaching a time control on the road section.',
    purpose: 'Keep competition timing and liaison obligations separate while preserving an auditable sequence of controls.',
    informationHierarchy: [
      'Primary: official stage/split ledger and current control state.',
      'Secondary: class delta, remaining distance, and road-section target clock.',
      'Tertiary: time card, penalties, and next-control checklist.'
    ],
    requiredTelemetryConceptIds: [
      'sessionTime', 'currentLapTime', 'perCarRelativeTime', 'external:splitTime',
      'external:stageTime', 'external:rallyControlSchedule', 'external:timeCard',
      'external:penaltyState', 'derived:classDelta', 'derived:targetTimeDeviation'
    ],
    layoutGrammar: 'A vertical timing ledger uses two parallel clock columns—competition and liaison—with stamped control rows and a fixed next-control checklist.',
    visualLanguage: 'Black-and-white rally time-card logic translated into a digital audit instrument.',
    materials: ['matte black panel', 'off-white time-card surface', 'restrained stamp texture'],
    typographyConstraints: 'Tabular monospaced times aligned to milliseconds; controls have short codes; no handwriting imitation that harms legibility.',
    colorConstraints: 'Black/white primary, muted blue confirmed stamp, amber early/late, red penalty; stamped shape and text duplicate state.',
    differentiation: 'Unlike Sector Variance Lattice, this ledger records a sequential rally-control process rather than aggregating statistical circuit sectors.',
    candidateWidgetConcepts: ['split ledger', 'dual competition/liaison clocks', 'target-time clock', 'control checklist', 'penalty stamp'],
    ordinaryOverlays: ['remaining stage or road distance', 'class delta', 'next control code'],
    triggerOnlyAlerts: ['early-arrival warning', 'late-arrival warning', 'split-crossing confirmation', 'flying-finish takeover', 'stop-control instruction'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-e', 'rally', 'timing', 'stage', 'table', 'race-control'],
    researchNotes: [
      'Official splits, target times, time card, and penalties require an external rally timing/control source.',
      'Competition and liaison clocks must never be merged into one ambiguous timer.'
    ],
    sourceIds: ['S27', 'S29'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on digital time-card reference with no hands, paper clipboard, car, or service-park scene.',
      sampleReadouts: ['SPLIT 3 08:42.318', 'CLASS -4.7 s', 'FINISH 3.8 km', 'TC 14 TARGET 14:32:00', 'DEVIATION +00:18'],
      requiredComposition: ['two parallel time columns', 'stacked control rows with restrained stamps', 'fixed next-control checklist'],
      legibility: 'Times must align cleanly and competition versus liaison must be distinguishable without color.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no spreadsheet chrome', 'no handwritten fake signatures', 'no generic analytics heatmap']
    }
  },
  {
    id: 'R2-23',
    name: 'Surface Grip Atlas',
    familyId: 'E',
    order: 23,
    priority: 2028,
    persona: 'Rally driver and engineer choosing tyres and setup for mixed or changing surfaces.',
    raceMoment: 'Pre-stage planning or a service decision after safety-crew reports conflict with measured conditions.',
    purpose: 'Map grip, wetness, surface type, tyre selection, and setup confidence onto the stage route.',
    informationHierarchy: [
      'Primary: topographic stage atlas with texture-coded surface segments.',
      'Secondary: tyre choice, wetness, temperature, and confidence.',
      'Tertiary: damper/differential or anti-roll settings, slip, and safety-crew report status.'
    ],
    requiredTelemetryConceptIds: [
      'playerSurfaceMaterial', 'trackWetness', 'trackTemperature', 'tyreColdPressure',
      'tyreCarcassTemperature', 'antiRollFront', 'antiRollRear', 'derived:tyreSlip',
      'external:surfaceReport', 'external:safetyCrewReport', 'external:setupSheet'
    ],
    layoutGrammar: 'A topographic route map occupies two-thirds of the canvas; gravel, asphalt, snow, water, and mixed segments use texture and contour, while tyre and setup panels lock to the side.',
    visualLanguage: 'Cartographic engineering atlas with terrain texture and restrained field-note annotation.',
    materials: ['muted matte map surface', 'rugged dark frame', 'paper-like contour texture'],
    typographyConstraints: 'Cartographic monospace labels, explicit confidence percentages, and no tiny legend dependent on color.',
    colorConstraints: 'Muted terrain palette with mandatory hatching; cyan wet, warm gray dry, white snow, amber conflict; no saturated rainbow map.',
    differentiation: 'Unlike Rain Crossover Board, this brief answers where grip differs along the route rather than when to change tyre type.',
    candidateWidgetConcepts: ['surface segment atlas', 'tyre-choice chip', 'setup-click panel', 'confidence badge', 'slip marker'],
    ordinaryOverlays: ['ambient and track temperature', 'selected tyre set', 'report freshness and confidence'],
    triggerOnlyAlerts: ['ice or standing-water warning', 'tyre-mismatch warning', 'pressure-loss warning', 'conflicting-report warning'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-e', 'rally', 'surface', 'grip', 'track-map', 'setup'],
    researchNotes: [
      'Safety-crew and detailed route reports are external inputs and must expose freshness and confidence.',
      'Surface under the player is not sufficient to infer the entire stage; do not fabricate route conditions.'
    ],
    sourceIds: ['S27', 'S28'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic route-atlas display, not a satellite image, game map, or physical road photograph.',
      sampleReadouts: ['ASPHALT 42% / DAMP', 'GRAVEL 31% / DRY', 'ICE 6% / CONF 72%', 'TYRE SOFT WET', 'ARB F 3 / R 2'],
      requiredComposition: ['topographic route map with multiple textured segments', 'locked tyre-choice panel', 'compact setup and confidence panel'],
      legibility: 'Every surface must remain identifiable in grayscale through hatching and labels; confidence must be explicit.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no satellite imagery', 'no generic weather map', 'no color-only terrain legend']
    }
  },
  {
    id: 'R2-24',
    name: 'Damage Survival Deck',
    familyId: 'E',
    order: 24,
    priority: 2027,
    persona: 'Rally driver deciding whether a damaged car can continue to finish or reach service.',
    raceMoment: 'Immediately after an impact, puncture, steering change, or critical warning mid-stage.',
    purpose: 'Prioritize finishability, safe pace, and distance to safety above performance.',
    informationHierarchy: [
      'Primary: descending CONTINUE / CAUTION / STOP survival ladder.',
      'Secondary: dominant fault, pressure-loss rate, steering/suspension asymmetry, and safe-pace cap.',
      'Tertiary: distance to stage end or service, temperature, and drivetrain state.'
    ],
    requiredTelemetryConceptIds: [
      'tyreColdPressure', 'steeringAngle', 'attitude', 'engineWarnings', 'repairRequirement',
      'lapDistance', 'external:damageDiagnostics', 'external:serviceDistance',
      'external:tyrePressureMonitoring', 'derived:pressureLossRate',
      'derived:finishability', 'derived:safePace'
    ],
    layoutGrammar: 'A descending survival ladder runs top to bottom from CONTINUE to STOP; the current recommendation locks to one rung while a service-distance gauge and fault stack flank it.',
    visualLanguage: 'Rugged emergency instrument with decisive action levels and minimal secondary detail.',
    materials: ['rugged black face', 'rubberized frame', 'scratch-resistant matte cover'],
    typographyConstraints: 'Heavy condensed action words, large distance and safe-speed values, and no diagnostic prose longer than one line.',
    colorConstraints: 'White normal, safety orange caution, red stop/fire; ladder shape, word, and icon duplicate severity.',
    differentiation: 'Unlike every other entry, this display explicitly decides whether the car can continue rather than optimizing performance or strategy.',
    candidateWidgetConcepts: ['survival ladder', 'dominant-fault stack', 'service-distance gauge', 'safe-pace cap', 'pressure-loss meter'],
    ordinaryOverlays: ['distance to finish/service', 'current safe-pace cap', 'top three fault indicators'],
    triggerOnlyAlerts: ['rapid-deflation takeover', 'wheel-risk stop state', 'fire stop state', 'steering-failure warning', 'critical-temperature stop state'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-e', 'rally', 'damage', 'safety', 'warning', 'status'],
    researchNotes: [
      'Finishability is a conservative derived recommendation, not a guarantee; missing diagnostics must bias toward uncertainty.',
      'Live tyre pressure and detailed damage channels require explicit external sources where the current provider cannot supply them.'
    ],
    sourceIds: ['S27', 'S28'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on emergency page with no crash photograph, damaged vehicle render, flames, or driver.',
      sampleReadouts: ['CAUTION', 'RR LOSS 12 kPa/min', 'STEER +7.2°', 'SERVICE 8.4 km', 'SAFE 92 km/h'],
      requiredComposition: ['large vertical three-level survival ladder', 'dominant fault at the active rung', 'service-distance and safe-pace gauges'],
      legibility: 'The continue/caution/stop decision must dominate and remain understandable without color.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no gore or crash imagery', 'no decorative damage diagram', 'no optimistic green state when data is missing']
    }
  },
  {
    id: 'R2-25',
    name: 'Night-Fog Lantern',
    familyId: 'E',
    order: 25,
    priority: 2026,
    persona: 'Rally driver navigating darkness, fog, heavy rain, or failing auxiliary lights.',
    raceMoment: 'A visibility-limited stage segment where the next hazard distance and safe speed outrank all normal data.',
    purpose: 'Reduce visual load to a narrow illuminated information cone that mirrors the driver’s limited sight distance.',
    informationHierarchy: [
      'Primary: next hazard distance and conservative safe speed.',
      'Secondary: pacenote hazard, visibility estimate, and light-pod state.',
      'Tertiary: gear, stage progress, rain, and red-flag state.'
    ],
    requiredTelemetryConceptIds: [
      'fogLevel', 'precipitation', 'speed', 'gear', 'raceFlags', 'lapProgress',
      'external:pacenoteSequence', 'external:lightPodStatus',
      'derived:visibility', 'derived:pacenoteDistance', 'derived:stageProgress'
    ],
    layoutGrammar: 'A nearly black canvas contains one narrow beam-shaped cone; distance and safe speed sit inside the cone, while all secondary status is confined to a thin base line.',
    visualLanguage: 'Low-luminance rally safety instrument using deliberate negative space instead of decorative darkness.',
    materials: ['matte black surround', 'low-reflection glass', 'subdued amber backlight'],
    typographyConstraints: 'Very large sans numerals, short hazard words, no small gray text, and no decorative glow that reduces edge definition.',
    colorConstraints: 'Amber and soft white only during normal operation; red reserved for red flag or stop; lightness and icons duplicate meaning.',
    differentiation: 'Unlike the other 49 briefs, negative space is the dominant design device and intentionally mimics a restricted visibility cone.',
    candidateWidgetConcepts: ['hazard-distance numeral', 'beam-shaped information cone', 'safe-speed value', 'light-status strip', 'stage-progress line'],
    ordinaryOverlays: ['gear and current speed footer', 'visibility estimate', 'light-pod status'],
    triggerOnlyAlerts: ['red-flag takeover', 'light-failure warning', 'standing-water warning', 'visibility-collapse warning', 'wrong-way warning'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-e', 'rally', 'night', 'fog', 'minimal', 'accessibility'],
    researchNotes: [
      'Safe speed is a conservative derived cue and must show unavailable when visibility or route inputs are insufficient.',
      'The display should minimize luminance to preserve night vision while maintaining text and non-text contrast.'
    ],
    sourceIds: ['S27', 'S37', 'S41'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic low-luminance display reference with no road, headlights, cockpit, or atmospheric photo.',
      sampleReadouts: ['HAZARD 180 m', 'SAFE 74 km/h', 'FOG 68%', 'LIGHT POD OK', 'STAGE 41%'],
      requiredComposition: ['mostly black canvas', 'one narrow luminous cone', 'giant hazard distance inside the cone', 'thin status baseline'],
      legibility: 'The cone edge, distance, and safe-speed value must be crisp without bloom; normal luminance stays subdued.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no photoreal foggy road', 'no flashlight illustration', 'no bright neon or blue glow']
    }
  }
] as const satisfies readonly DashboardPortfolioEntry[]
