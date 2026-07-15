export const DASHBOARD_PORTFOLIO_IDS = [
  'R2-01', 'R2-02', 'R2-03', 'R2-04', 'R2-05',
  'R2-06', 'R2-07', 'R2-08', 'R2-09', 'R2-10',
  'R2-11', 'R2-12', 'R2-13', 'R2-14', 'R2-15',
  'R2-16', 'R2-17', 'R2-18', 'R2-19', 'R2-20',
  'R2-21', 'R2-22', 'R2-23', 'R2-24', 'R2-25',
  'R2-26', 'R2-27', 'R2-28', 'R2-29', 'R2-30',
  'R2-31', 'R2-32', 'R2-33', 'R2-34', 'R2-35',
  'R2-36', 'R2-37', 'R2-38', 'R2-39', 'R2-40',
  'R2-41', 'R2-42', 'R2-43', 'R2-44', 'R2-45',
  'R2-46', 'R2-47', 'R2-48', 'R2-49', 'R2-50'
] as const

export type DashboardPortfolioId = (typeof DASHBOARD_PORTFOLIO_IDS)[number]

export const DASHBOARD_PORTFOLIO_FAMILY_IDS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'
] as const

export type DashboardPortfolioFamilyId = (typeof DASHBOARD_PORTFOLIO_FAMILY_IDS)[number]

export const DASHBOARD_PORTFOLIO_SOURCE_IDS = [
  'S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11',
  'S12', 'S13', 'S14', 'S15', 'S16', 'S17', 'S18', 'S19', 'S20', 'S21', 'S22',
  'S23', 'S24', 'S25', 'S26', 'S27', 'S28', 'S29', 'S30', 'S31', 'S32', 'S33',
  'S34', 'S35', 'S36', 'S37', 'S38', 'S39', 'S40', 'S41', 'S42', 'S43', 'S44'
] as const

export type DashboardPortfolioSourceId = (typeof DASHBOARD_PORTFOLIO_SOURCE_IDS)[number]

/**
 * Unprefixed IDs mirror the normalized telemetry inventory. Supplemental concepts
 * are deliberately namespaced so a brief never pretends that an unavailable
 * series feed or a future derived model already exists in TelemetrySnapshot.
 */
export const DASHBOARD_PORTFOLIO_TELEMETRY_CONCEPT_IDS = [
  'speed',
  'engineRpm',
  'gear',
  'shiftLights',
  'engineWarnings',
  'oilPressure',
  'oilTemperature',
  'coolantTemperature',
  'systemVoltage',
  'fuelPressure',
  'ersBattery',
  'drsState',
  'pushToPassState',
  'pushToPassAllowance',
  'velocityVector',
  'accelerationVector',
  'attitude',
  'angularRates',
  'geographicPosition',
  'headingNorth',
  'throttle',
  'brake',
  'clutch',
  'steeringAngle',
  'brakeBias',
  'absSetting',
  'absActive',
  'tcSetting',
  'tcActive',
  'engineMap',
  'engineBraking',
  'antiRollFront',
  'antiRollRear',
  'weightJackerRight',
  'currentLap',
  'completedLaps',
  'lapDistance',
  'lapProgress',
  'currentLapTime',
  'lastLapTime',
  'bestLapTime',
  'estimatedLap',
  'deltaBest',
  'deltaSessionBest',
  'deltaOptimal',
  'sessionState',
  'sessionTime',
  'timeOfDay',
  'timeRemaining',
  'lapsRemaining',
  'sessionType',
  'replayTimeline',
  'paceMode',
  'paceFlags',
  'paceFormation',
  'raceFlags',
  'proximity',
  'carIdentity',
  'carNumber',
  'classIdentity',
  'driverIdentity',
  'overallPosition',
  'classPosition',
  'fieldSize',
  'perCarPosition',
  'perCarClassPosition',
  'perCarLap',
  'perCarProgress',
  'perCarEstimatedTime',
  'perCarRelativeTime',
  'perCarPitRoad',
  'perCarTrackLocation',
  'perCarTrackMaterial',
  'perCarLastLap',
  'perCarBestLap',
  'perCarPushToPass',
  'fuelLevel',
  'fuelLevelPct',
  'fuelConsumptionRate',
  'fuelPerLap',
  'fuelCapacity',
  'tyreCarcassTemperature',
  'tyreSurfaceTemperature',
  'tyreColdPressure',
  'tyreWear',
  'brakeLinePressure',
  'brakeTemperature',
  'airTemperature',
  'trackTemperature',
  'fogLevel',
  'humidity',
  'skies',
  'weatherMode',
  'wind',
  'solarPosition',
  'trackWetness',
  'precipitation',
  'trackGrip',
  'declaredWet',
  'playerSurfaceMaterial',
  'trackIdentity',
  'trackLength',
  'onPitRoad',
  'pitLimiter',
  'pitServicesSelected',
  'pitTyreTargets',
  'pitFuelToAdd',
  'repairTime',
  'optionalRepairTime',
  'pitStopActive',
  'pitsOpen',
  'inPitStall',
  'pitServiceStatus',
  'repairRequirement',
  'incidentCounts',
  'incidentLimit',
  'derived:averageSpeed',
  'derived:balanceByCornerPhase',
  'derived:boostCountdown',
  'derived:brakeRecovery',
  'derived:captionUrgency',
  'derived:classDelta',
  'derived:clutchBitePoint',
  'derived:clockSynchronization',
  'derived:closingRate',
  'derived:cornerPhase',
  'derived:correctedPace',
  'derived:decisionRecommendation',
  'derived:draftPackTopology',
  'derived:driverStintTime',
  'derived:energyPerLap',
  'derived:energyTargetMargin',
  'derived:finishability',
  'derived:forecastUncertainty',
  'derived:frictionEnvelope',
  'derived:fuelLapsRemaining',
  'derived:gapTrend',
  'derived:hapticDirection',
  'derived:incidentSeverity',
  'derived:lapValidity',
  'derived:liftTarget',
  'derived:localDelta',
  'derived:paceDecay',
  'derived:pacenoteDistance',
  'derived:peakRecall',
  'derived:pitDistance',
  'derived:pitEta',
  'derived:pitLoss',
  'derived:predictedCatchPoint',
  'derived:predictedStintEnd',
  'derived:predictiveLapTime',
  'derived:pressureLossRate',
  'derived:raceNarrative',
  'derived:rangeToFinish',
  'derived:racingLine',
  'derived:referenceQuality',
  'derived:restartCountdown',
  'derived:safePace',
  'derived:sectorDelta',
  'derived:sectorVariance',
  'derived:setupResponseConfidence',
  'derived:speedLimitDelta',
  'derived:stagePointsProjection',
  'derived:stageProgress',
  'derived:strategicAdvantage',
  'derived:strategyWindow',
  'derived:synchronizedDistanceTrace',
  'derived:targetTimeDeviation',
  'derived:thermalHistory',
  'derived:tyreAge',
  'derived:tyreSlip',
  'derived:visibility',
  'derived:weatherCrossover',
  'derived:yawBalance',
  'external:attackModeTimer',
  'external:attackModeUses',
  'external:cameraEvidence',
  'external:chooseZone',
  'external:damageDiagnostics',
  'external:driverComments',
  'external:driverSwapReadiness',
  'external:driverTimeRules',
  'external:energyDeployment',
  'external:energyRegeneration',
  'external:evidenceDocument',
  'external:hapticOutput',
  'external:incidentReport',
  'external:lightPodStatus',
  'external:lightingState',
  'external:marshalResourceStatus',
  'external:neutralizationZone',
  'external:officialTiming',
  'external:pacenoteSequence',
  'external:penaltyState',
  'external:pitwallWorkflowState',
  'external:raceControlInstruction',
  'external:radioCaption',
  'external:rainRadarEta',
  'external:rallyControlSchedule',
  'external:routeControl',
  'external:safetyCrewReport',
  'external:serviceDistance',
  'external:setupSheet',
  'external:splitTime',
  'external:stageDefinition',
  'external:stagePoints',
  'external:stageTime',
  'external:surfaceReport',
  'external:targetAverageSpeed',
  'external:temporaryPowerZone',
  'external:timeCard',
  'external:tripDistance',
  'external:tyreInventory',
  'external:tyrePressureMonitoring',
  'external:videoTimestamp',
  'external:virtualEnergyAllocation',
  'external:weatherRadar'
] as const

export type DashboardTelemetryConceptId =
  (typeof DASHBOARD_PORTFOLIO_TELEMETRY_CONCEPT_IDS)[number]

export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]]

export const DASHBOARD_PORTFOLIO_CANVAS =
  '1024x600 full-frame dashboard, straight-on orthographic reference' as const

export const DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS = [
  'No official series, manufacturer, team, sponsor, or product logos.',
  'No copied proprietary DDU geometry, trade dress, or pixel-for-pixel commercial screen recreation.',
  'No generic business-dashboard cards, KPI tiles, office charts, browser chrome, or glassmorphism admin UI.',
  'No cockpit, steering wheel, hands, car interior, photoreal vehicle, decorative sci-fi, clipping, overlap, or deformed text.',
  'Reference image only: the final dashboard must be rebuilt from live telemetry components, never used as a static background.'
] as const satisfies NonEmptyReadonlyArray<string>

export interface DashboardPortfolioFamilyDefinition {
  id: DashboardPortfolioFamilyId
  name: string
  entryIds: readonly [
    DashboardPortfolioId,
    DashboardPortfolioId,
    DashboardPortfolioId,
    DashboardPortfolioId,
    DashboardPortfolioId
  ]
  primaryGrammar: string
  mission: string
  coverage: NonEmptyReadonlyArray<string>
  promptGuardrail: string
}

export interface DashboardImagePromptConstraints {
  canvas: string
  viewpoint: string
  sampleReadouts: NonEmptyReadonlyArray<string>
  requiredComposition: NonEmptyReadonlyArray<string>
  legibility: string
  avoid: NonEmptyReadonlyArray<string>
  avoidAlso: NonEmptyReadonlyArray<string>
}

export interface DashboardPortfolioEntry {
  id: DashboardPortfolioId
  name: string
  familyId: DashboardPortfolioFamilyId
  order: number
  priority: number
  persona: string
  raceMoment: string
  purpose: string
  informationHierarchy: NonEmptyReadonlyArray<string>
  requiredTelemetryConceptIds: NonEmptyReadonlyArray<DashboardTelemetryConceptId>
  layoutGrammar: string
  visualLanguage: string
  materials: NonEmptyReadonlyArray<string>
  typographyConstraints: string
  colorConstraints: string
  differentiation: string
  candidateWidgetConcepts: NonEmptyReadonlyArray<string>
  ordinaryOverlays: NonEmptyReadonlyArray<string>
  triggerOnlyAlerts: NonEmptyReadonlyArray<string>
  tags: NonEmptyReadonlyArray<string>
  researchNotes: NonEmptyReadonlyArray<string>
  sourceIds: NonEmptyReadonlyArray<DashboardPortfolioSourceId>
  imagePromptConstraints: DashboardImagePromptConstraints
}

export interface DashboardPortfolioSource {
  id: DashboardPortfolioSourceId
  label: string
  url: string
  domain: string
}
