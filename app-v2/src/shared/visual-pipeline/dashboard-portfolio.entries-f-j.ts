import {
  DASHBOARD_PORTFOLIO_CANVAS,
  DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
  type DashboardPortfolioEntry
} from './dashboard-portfolio.types'

export const DASHBOARD_PORTFOLIO_ENTRIES_F_J = [
  {
    id: 'R2-26',
    name: 'Channel Trace Stack',
    familyId: 'F',
    order: 26,
    priority: 2025,
    persona: 'Data engineer reviewing a completed lap against a trusted reference.',
    raceMoment: 'Post-lap analysis with a synchronized distance cursor moving through braking, apex, and exit.',
    purpose: 'Place speed, controls, gear, RPM, and delta on one distance axis so causal differences remain aligned.',
    informationHierarchy: [
      'Primary: synchronized speed and delta traces across the full lap distance.',
      'Secondary: throttle, brake, steering, gear, and RPM traces.',
      'Tertiary: corner annotations, reference selector, cursor values, and data-quality state.'
    ],
    requiredTelemetryConceptIds: [
      'speed', 'throttle', 'brake', 'steeringAngle', 'gear', 'engineRpm', 'deltaBest',
      'lapDistance', 'lapProgress', 'derived:synchronizedDistanceTrace', 'derived:referenceQuality'
    ],
    layoutGrammar: 'Six stacked waveform panes share one horizontal distance ruler and one vertical cursor; the upper speed/delta pane is twice the height of each input pane.',
    visualLanguage: 'Flat engineering workstation with precise traces, sparse controls, and no dashboard theatrics.',
    materials: ['flat graphite workspace', 'subtle technical grid', 'matte cursor layer'],
    typographyConstraints: 'Small but readable tabular mono, aligned cursor values, explicit units, and no faux terminal text.',
    colorConstraints: 'White reference, cyan current speed, amber brake, green throttle, magenta steering; line pattern and labels duplicate color.',
    differentiation: 'Unlike every driver-facing concept, this is a pure waveform workspace organized by a shared distance axis.',
    candidateWidgetConcepts: ['stacked trace panes', 'shared distance ruler', 'linked cursor readout', 'reference selector', 'corner annotations'],
    ordinaryOverlays: ['selected-lap and reference identifiers', 'cursor value table', 'corner marker rail'],
    triggerOnlyAlerts: ['channel-dropout marker', 'sensor-saturation marker', 'distance-synchronization error'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-f', 'engineer', 'graph', 'delta', 'inputs', 'dataheavy'],
    researchNotes: [
      'The workspace uses only player-car controls; opponent control traces are prohibited by the available telemetry contract.',
      'Reference validity and synchronization quality must remain visible whenever comparative traces are shown.'
    ],
    sourceIds: ['S04', 'S05', 'S09'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on desktop analysis canvas with no monitor bezel, keyboard, person, or office environment.',
      sampleReadouts: ['CURSOR 2,184 m', 'SPEED 186 / REF 191 km/h', 'DELTA +0.142 s', 'BRAKE 78%', 'GEAR 4'],
      requiredComposition: ['six synchronized stacked traces', 'one shared distance ruler', 'single cursor crossing every pane'],
      legibility: 'Traces must remain separable in grayscale through line style; cursor values cannot overlap waveforms.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no generic stock-market chart', 'no 3D graph', 'no opponent throttle or brake traces']
    }
  },
  {
    id: 'R2-27',
    name: 'Delta Microscope',
    familyId: 'F',
    order: 27,
    priority: 2024,
    persona: 'Driver coach investigating why one corner gained or lost time.',
    raceMoment: 'Post-lap forensic review centered on braking, minimum speed, apex, and throttle pickup.',
    purpose: 'Magnify one causal corner segment while preserving enough full-lap context to avoid overfitting.',
    informationHierarchy: [
      'Primary: circular magnified local delta and input difference around one corner.',
      'Secondary: braking point, minimum speed, apex, throttle pickup, and racing-line offset.',
      'Tertiary: full-lap context strip, reference quality, and coaching note.'
    ],
    requiredTelemetryConceptIds: [
      'deltaBest', 'speed', 'brake', 'throttle', 'steeringAngle', 'lapProgress',
      'derived:localDelta', 'derived:referenceQuality', 'derived:racingLine',
      'derived:synchronizedDistanceTrace'
    ],
    layoutGrammar: 'A large circular zoom lens sits over a horizontal distance ruler; the selected corner expands inside the lens while the whole lap remains compressed into a thin context strip.',
    visualLanguage: 'Forensic coaching tool with optical precision and restrained annotation.',
    materials: ['near-black flat workspace', 'fine white ruler', 'subtle frosted lens edge'],
    typographyConstraints: 'Precise monospaced values, short causal coaching verbs, and no narrative paragraphs inside the lens.',
    colorConstraints: 'White reference, cyan current, amber braking difference, green earlier throttle; labels and line styles duplicate color.',
    differentiation: 'Unlike Battle Split Comparator, this brief is a single-corner forensic tool for one driver rather than a live two-competitor narrative.',
    candidateWidgetConcepts: ['magnified corner trace', 'full-lap context strip', 'brake/apex/throttle markers', 'coaching note', 'reference-quality badge'],
    ordinaryOverlays: ['corner identifier and distance', 'reference lap selector', 'minimum-speed and local-delta summary'],
    triggerOnlyAlerts: ['invalid-lap marker', 'traffic-contamination marker', 'mismatched-reference warning'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-f', 'engineer', 'coach', 'delta', 'graph', 'radial'],
    researchNotes: [
      'The coaching conclusion must be based on aligned player telemetry and a valid reference, not generic advice.',
      'Traffic contamination and mismatched car/setup conditions must downgrade the reference visibly.'
    ],
    sourceIds: ['S04', 'S05', 'S06'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic analysis display with a single large circular magnifier over a distance ruler.',
      sampleReadouts: ['T7 / 2,184–2,326 m', 'LOCAL +0.118 s', 'BRAKE +14 m LATE', 'MIN 104 / 108 km/h', 'THROTTLE +0.22 s LATE'],
      requiredComposition: ['large circular zoom lens', 'thin full-lap context strip', 'four causal event markers inside the lens'],
      legibility: 'The selected corner and causal differences must dominate; the full-lap strip stays contextual and uncluttered.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no literal glass magnifying-glass illustration', 'no two-driver broadcast split', 'no generic dashboard cards']
    }
  },
  {
    id: 'R2-28',
    name: 'Friction Bloom G-G',
    familyId: 'F',
    order: 28,
    priority: 2023,
    persona: 'Vehicle-dynamics engineer evaluating grip utilization and balance across corner phases.',
    raceMoment: 'Post-run analysis of entry, apex, exit, lockup, and traction-limit events.',
    purpose: 'Reveal how the car fills its friction envelope and where phase-specific grip is unused or exceeded.',
    informationHierarchy: [
      'Primary: G-G point cloud and limit envelope.',
      'Secondary: entry, apex, and exit clusters with speed bins.',
      'Tertiary: yaw, throttle, brake, tyre-slip context, and linked-lap cursor.'
    ],
    requiredTelemetryConceptIds: [
      'accelerationVector', 'angularRates', 'speed', 'throttle', 'brake',
      'derived:frictionEnvelope', 'derived:tyreSlip', 'derived:cornerPhase'
    ],
    layoutGrammar: 'A radial scatter bloom fills the center; petals represent entry, apex, and exit clusters, with a thin speed-bin ring and a compact linked-event list at the side.',
    visualLanguage: 'Scientific scatter visualization with no pseudo-3D or ornamental particles.',
    materials: ['graphite analysis canvas', 'fine polar grid', 'matte annotation layer'],
    typographyConstraints: 'Fine technical type with readable axis units and explicit phase labels; no perspective-distorted text.',
    colorConstraints: 'CVD-safe phase colors with distinct point shapes; neutral envelope; red reserved for verified outliers or faults.',
    differentiation: 'Unlike every other entry, a scientific scatter distribution is the hero and its petal shape emerges from measured grip use.',
    candidateWidgetConcepts: ['G-G bloom', 'friction envelope', 'speed-bin filter', 'phase legend', 'linked-lap cursor'],
    ordinaryOverlays: ['current filter and sample count', 'phase distribution summary', 'selected outlier readout'],
    triggerOnlyAlerts: ['sensor-bias warning', 'wheel-lift event', 'lockup outlier', 'physically impossible sample'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-f', 'engineer', 'g-force', 'scatter', 'chassis', 'analysis'],
    researchNotes: [
      'The friction envelope is derived from measured samples and must not imply a universal tyre limit.',
      'Point shape and pattern are mandatory so phase clusters remain distinct for color-vision-deficient reviewers.'
    ],
    sourceIds: ['S05', 'S09'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on engineering plot with one dominant polar scatter field.',
      sampleReadouts: ['LAT ±2.1 g', 'LONG +1.3 / -2.4 g', 'ENTRY 1,284 pts', 'APEX 942 pts', 'EXIT 1,106 pts'],
      requiredComposition: ['central radial point bloom', 'visible neutral limit envelope', 'three phase clusters with different shapes'],
      legibility: 'Axes, phase, and outlier meaning must survive grayscale; avoid excessive point density or glow.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no 3D globe', 'no particle-art aesthetic', 'no rainbow scatter without shape coding']
    }
  },
  {
    id: 'R2-29',
    name: 'Setup Correlation Bench',
    familyId: 'F',
    order: 29,
    priority: 2022,
    persona: 'Race engineer comparing setup runs and planning the next controlled test.',
    raceMoment: 'Between practice runs after springs, bars, wing, ride, pressure, or balance changes.',
    purpose: 'Connect configuration changes to measured response, driver comment, confidence, and next-test recommendation.',
    informationHierarchy: [
      'Primary: before/after setup diff and response matrix.',
      'Secondary: balance metrics, sector result, and confidence.',
      'Tertiary: driver comment tags, sample size, and next-test proposal.'
    ],
    requiredTelemetryConceptIds: [
      'antiRollFront', 'antiRollRear', 'brakeBias', 'tyreColdPressure',
      'deltaBest', 'lastLapTime', 'external:setupSheet', 'external:driverComments',
      'derived:balanceByCornerPhase', 'derived:setupResponseConfidence', 'derived:sectorDelta'
    ],
    layoutGrammar: 'Parallel-coordinate matrix links before/after setup columns to measured outcomes; a setup-sheet drawer anchors the left and driver-comment tags anchor the right.',
    visualLanguage: 'Neutral engineering bench with worksheet discipline and explicit evidence confidence.',
    materials: ['neutral gray workspace', 'restrained worksheet texture', 'matte divider rails'],
    typographyConstraints: 'Compact humanist sans for labels, tabular setup values, and consistent signed changes; no spreadsheet toolbar.',
    colorConstraints: 'CVD-safe traces with shape-coded run endpoints; green is not automatically “better” unless the chosen metric improved.',
    differentiation: 'Unlike every other entry, it explicitly links configuration inputs to observed performance outcomes and confidence.',
    candidateWidgetConcepts: ['setup diff drawer', 'parallel-coordinate response matrix', 'confidence badge', 'driver-comment tags', 'next-test card'],
    ordinaryOverlays: ['run identifiers and sample size', 'sector and balance summary', 'selected driver comment'],
    triggerOnlyAlerts: ['illegal-value warning', 'contradictory-evidence warning', 'insufficient-sample warning'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-f', 'engineer', 'setup', 'comparison', 'table', 'analysis'],
    researchNotes: [
      'Setup data and driver comments are external inputs; measured response must remain traceable to player-car telemetry.',
      'Confidence must fall when weather, fuel, tyres, traffic, or reference conditions are not comparable.'
    ],
    sourceIds: ['S04', 'S05'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic engineering bench interface with no office monitor, keyboard, or spreadsheet application chrome.',
      sampleReadouts: ['ARB F 4→3', 'BB 55.8→56.3%', 'S2 -0.18 s', 'MID +2.1°/s YAW', 'CONF 78%'],
      requiredComposition: ['before/after setup columns', 'parallel response traces', 'driver-comment tags and confidence block'],
      legibility: 'Each change must connect visually to one outcome; do not create a dense unreadable parallel-coordinate web.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no Excel-like UI', 'no traffic-light scorecard', 'no causal claim without confidence']
    }
  },
  {
    id: 'R2-30',
    name: 'Sector Variance Lattice',
    familyId: 'F',
    order: 30,
    priority: 2021,
    persona: 'Performance engineer measuring consistency across many laps and conditions.',
    raceMoment: 'Long-run review after tyre age, fuel, traffic, incidents, or track temperature changed.',
    purpose: 'Prioritize distribution and variance so repeatability problems are visible even when the best lap looks strong.',
    informationHierarchy: [
      'Primary: small-multiple lattice of lap and sector variance.',
      'Secondary: confidence bands and corrected-pace distribution.',
      'Tertiary: regime filters for traffic, tyre age, fuel, incidents, and track state.'
    ],
    requiredTelemetryConceptIds: [
      'currentLapTime', 'lastLapTime', 'bestLapTime', 'tyreWear', 'fuelLevel',
      'trackTemperature', 'incidentCounts', 'derived:sectorVariance',
      'derived:correctedPace', 'derived:referenceQuality'
    ],
    layoutGrammar: 'A dense lattice of small variance cells fills the screen; columns are sectors, rows are laps or regimes, and no continuous hero trace is used.',
    visualLanguage: 'Statistical performance page with disciplined small multiples and restrained heat encoding.',
    materials: ['off-black analysis canvas', 'fine cell grid', 'flat filter rail'],
    typographyConstraints: 'Tabular times, readable row/column labels, compact confidence notation, and no illegible microtext.',
    colorConstraints: 'Color-safe sequential scale with numeric values and pattern for outliers; red only for data quality or true anomaly.',
    differentiation: 'Unlike Delta Microscope, this page aggregates many laps into distributions rather than magnifying one local event.',
    candidateWidgetConcepts: ['variance lattice', 'confidence bands', 'regime filters', 'corrected-pace distribution', 'outlier marker'],
    ordinaryOverlays: ['sample-count and confidence header', 'selected-regime filters', 'best / median / variance summary'],
    triggerOnlyAlerts: ['anomalous-lap marker', 'timing-gap warning', 'variance-spike warning', 'track-regime-change marker'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-f', 'engineer', 'consistency', 'heatmap', 'sectors', 'dataheavy'],
    researchNotes: [
      'Corrected pace and regime grouping are derived; assumptions and sample counts must remain visible.',
      'Use sequential perceptual color plus numbers/patterns so variance is never color-only.'
    ],
    sourceIds: ['S04', 'S09', 'S16'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on statistical analysis page with a full lattice and no office software chrome.',
      sampleReadouts: ['12 LAPS', 'S1 σ 0.18 s', 'S2 σ 0.31 s', 'S3 σ 0.12 s', 'CORRECTED 1:47.42 ±0.24'],
      requiredComposition: ['dense but readable small-multiple lattice', 'sector columns and lap rows', 'confidence and regime filter rail'],
      legibility: 'Every cell needs a numeric or patterned cue; preserve clear row and column alignment at review-table scale.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no continuous waveform hero', 'no business heatmap with unlabeled cells', 'no rainbow palette']
    }
  },
  {
    id: 'R2-31',
    name: 'Fuel Horizon',
    familyId: 'G',
    order: 31,
    priority: 2020,
    persona: 'Strategist or engineer forecasting whether the car reaches the finish under changing race states.',
    raceMoment: 'Mid-stint fuel call with uncertainty from pace, caution probability, or reserve policy.',
    purpose: 'Show range-to-finish as an uncertainty cone with an explicit target consumption and reserve.',
    informationHierarchy: [
      'Primary: fan-shaped finish forecast and range margin.',
      'Secondary: target fuel number, reserve, and scenario spread.',
      'Tertiary: pace, caution state, laps/time remaining, and sensor agreement.'
    ],
    requiredTelemetryConceptIds: [
      'fuelLevel', 'fuelPerLap', 'fuelConsumptionRate', 'lapsRemaining', 'timeRemaining',
      'paceMode', 'raceFlags', 'derived:rangeToFinish', 'derived:forecastUncertainty',
      'derived:fuelLapsRemaining'
    ],
    layoutGrammar: 'A fan-shaped forecast cone widens toward a fixed finish line; current range is the center ray, pessimistic/optimistic scenarios form the cone edges, and a target-number gauge anchors the base.',
    visualLanguage: 'Calm strategy forecast with uncertainty made visible instead of hidden behind one precise number.',
    materials: ['dark navy operations canvas', 'matte forecast surface', 'thin titanium datum'],
    typographyConstraints: 'Large tabular margin and target values, explicit units, and plain scenario labels.',
    colorConstraints: 'Cyan forecast center, lighter hatched uncertainty, amber reserve, red shortfall; edge pattern and labels duplicate color.',
    differentiation: 'Unlike Virtual Energy Ledger, this brief visualizes uncertain future fuel range rather than regulated transaction accounting.',
    candidateWidgetConcepts: ['finish horizon', 'forecast cone', 'target-number gauge', 'reserve marker', 'scenario toggles'],
    ordinaryOverlays: ['laps/time remaining', 'current consumption and target', 'caution-model state'],
    triggerOnlyAlerts: ['projected-shortfall takeover', 'reserve-breach warning', 'sensor-disagreement warning', 'race-state model-change marker'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-g', 'strategy', 'fuel', 'forecast', 'endurance', 'graph'],
    researchNotes: [
      'FuelUsePerLap is treated as mass per lap in the current provider; do not relabel it as litres per lap without density conversion.',
      'Forecast uncertainty and caution assumptions must be visible, not hidden behind a single deterministic result.'
    ],
    sourceIds: ['S10', 'S14', 'S40'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic strategy page with one fan forecast, no pit-wall room or people.',
      sampleReadouts: ['MARGIN +1.4 laps', 'TARGET 2.31 kg/lap', 'ACTUAL 2.38', 'RESERVE 0.7 lap', 'FINISH 18 laps'],
      requiredComposition: ['fan-shaped uncertainty cone', 'fixed finish line', 'target gauge at the cone origin'],
      legibility: 'Current, pessimistic, and optimistic outcomes must remain distinct without color; margin and target dominate.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no fuel-pump illustration', 'no virtual-energy ledger rows', 'no finance forecast chart']
    }
  },
  {
    id: 'R2-32',
    name: 'Tyre Thermal Quilt',
    familyId: 'G',
    order: 32,
    priority: 2019,
    persona: 'Tyre engineer studying warm-up, spread, pressure, and degradation over time.',
    raceMoment: 'Long-run analysis, post-pit warm-up, or comparison of tyre sets and corners.',
    purpose: 'Show four evolving thermal profiles as time-based quilts rather than one current-temperature snapshot.',
    informationHierarchy: [
      'Primary: four 3×N tread-zone thermal quilts.',
      'Secondary: hot-window occupancy, pressure, spread, and trend.',
      'Tertiary: load/slip context, tyre age, track temperature, and sensor quality.'
    ],
    requiredTelemetryConceptIds: [
      'tyreColdPressure', 'tyreCarcassTemperature', 'tyreSurfaceTemperature',
      'tyreWear', 'trackTemperature', 'external:tyrePressureMonitoring',
      'derived:thermalHistory', 'derived:tyreSlip', 'derived:tyreAge'
    ],
    layoutGrammar: 'Four horizontal 3×N quilts are stacked by corner; each column is a time slice and each row is inner/middle/outer tread, with pressure and spread rails at the right.',
    visualLanguage: 'Perceptual thermal analysis with pattern overlays and precise four-corner comparison.',
    materials: ['dark gray analysis canvas', 'matte thermal cells', 'fine corner separators'],
    typographyConstraints: 'Compact tabular temperatures and pressures, fixed corner labels, and clear time direction.',
    colorConstraints: 'Perceptually uniform thermal scale with hatching for ranges; red reserved for configured critical state, not merely hottest sample.',
    differentiation: 'Unlike Tyre Cross Side-Rail, this is a time-evolving engineer heatmap rather than a compact driver page.',
    candidateWidgetConcepts: ['four thermal quilts', 'hot-window occupancy', 'tread-spread gauge', 'pressure trend rail', 'sensor-quality marker'],
    ordinaryOverlays: ['tyre age and set identifier', 'track temperature', 'window occupancy percentage'],
    triggerOnlyAlerts: ['puncture or rapid-loss marker', 'pressure-floor warning', 'overheat warning', 'corner-imbalance warning', 'sensor-loss marker'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-g', 'engineer', 'tyres', 'heatmap', 'thermal', 'endurance'],
    researchNotes: [
      'Live pressure requires a separately identified TPMS feed; the current normalized inventory only guarantees cold set points.',
      'Thermal windows are configurable by tyre and car, never universal.'
    ],
    sourceIds: ['S13', 'S17', 'S18'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on tyre analysis canvas with four stacked quilts and no tyre photographs.',
      sampleReadouts: ['LF 82|88|84°C / 176 kPa', 'RF 86|91|87°C / 178 kPa', 'LR 78|82|80°C', 'RR 80|84|81°C', 'TRACK 31°C'],
      requiredComposition: ['four stacked 3×N quilts', 'clear time direction', 'pressure and tread-spread rails on the right'],
      legibility: 'Corner and tread-zone identity must survive grayscale; no smooth decorative gradient without cells and values.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no tyre photo render', 'no four-card current-value grid', 'no rainbow heat scale']
    }
  },
  {
    id: 'R2-33',
    name: 'Brake Envelope Four-Corner',
    familyId: 'G',
    order: 33,
    priority: 2018,
    persona: 'Brake engineer or driver warming brakes and monitoring recovery.',
    raceMoment: 'Out-lap, restart, repeated heavy braking, or cooling phase before pit entry.',
    purpose: 'Show four brake operating envelopes, peaks, and recovery relative to target bands.',
    informationHierarchy: [
      'Primary: four vertical brake-temperature columns and target bands.',
      'Secondary: peak and recovery slope plus front/rear balance bridge.',
      'Tertiary: line pressure, speed, ambient temperature, bias, and duct/setup state.'
    ],
    requiredTelemetryConceptIds: [
      'brakeTemperature', 'brakeLinePressure', 'speed', 'airTemperature', 'brakeBias',
      'external:setupSheet', 'derived:brakeRecovery'
    ],
    layoutGrammar: 'Four tall thermal columns sit around a horizontal front/rear axle datum; target windows are fixed bands and recovery tails descend beside each column.',
    visualLanguage: 'Brake-system engineering page with physical operating bands and no generic heatmap.',
    materials: ['charcoal face', 'etched axle line', 'matte thermal columns'],
    typographyConstraints: 'Condensed tabular temperatures, fixed LF/RF/LR/RR labels, explicit peak values, and no small legends.',
    colorConstraints: 'White and amber operating bands, cyan cool/recovery cue, red only for configured critical temperature; pattern marks target windows.',
    differentiation: 'Unlike Tyre Thermal Quilt, this page models brake operating envelopes and recovery as vertical columns rather than tread-zone history.',
    candidateWidgetConcepts: ['four brake columns', 'target bands', 'recovery tails', 'axle-balance bridge', 'pressure footer'],
    ordinaryOverlays: ['brake bias and line pressure', 'ambient temperature', 'peak and recovery values'],
    triggerOnlyAlerts: ['too-cold start warning', 'overtemperature warning', 'diagonal-imbalance warning', 'sensor-failure marker'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-g', 'engineer', 'brakes', 'temperature', 'corner-grid', 'barv'],
    researchNotes: [
      'Operating bands and duct state are car/setup specific; no universal brake temperature target is implied.',
      'Brake temperature availability is simulator/car dependent and must be NaN-safe.'
    ],
    sourceIds: ['S04', 'S43', 'S44'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic brake engineering display with four vertical columns and no brake-disc photograph.',
      sampleReadouts: ['LF 612°C / PEAK 694', 'RF 628°C / PEAK 706', 'LR 482°C', 'RR 476°C', 'BB 56.1%'],
      requiredComposition: ['four vertical thermal columns', 'fixed target bands', 'front/rear axle bridge and recovery tails'],
      legibility: 'Current, peak, target band, and recovery direction must be distinct without color.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no glowing photoreal brake rotors', 'no tyre quilt', 'no generic thermometer cards']
    }
  },
  {
    id: 'R2-34',
    name: 'Pit Window Gantt',
    familyId: 'G',
    order: 34,
    priority: 2017,
    persona: 'Endurance strategist planning stints, drivers, tyres, and fuel or energy resources.',
    raceMoment: 'Pre-race planning or live recalculation after a caution, weather change, or pit conflict.',
    purpose: 'Place the full-race resource plan on one horizontal schedule so legal and physical windows remain visible together.',
    informationHierarchy: [
      'Primary: horizontal stint and pit-window Gantt.',
      'Secondary: driver-time bands, tyre inventory, and fuel/energy range.',
      'Tertiary: projected laps, pit loss, and neutralization scenarios.'
    ],
    requiredTelemetryConceptIds: [
      'fuelLevel', 'fuelPerLap', 'ersBattery', 'lapsRemaining', 'timeRemaining',
      'driverIdentity', 'pitServicesSelected', 'pitFuelToAdd', 'raceFlags',
      'external:driverTimeRules', 'external:tyreInventory',
      'derived:strategyWindow', 'derived:pitLoss', 'derived:driverStintTime'
    ],
    layoutGrammar: 'Horizontal bars span the entire race timeline; rows are car stint, driver eligibility, tyre sets, and scenarios, with pit events as vertical gates.',
    visualLanguage: 'Dense operations schedule with hard-edged resource bars and clear legal constraints.',
    materials: ['dark operations-gray canvas', 'matte timeline bars', 'fine vertical event gates'],
    typographyConstraints: 'Tabular time/lap ticks, readable driver names, short tyre-set codes, and no project-management software chrome.',
    colorConstraints: 'Distinct resource colors with patterns, neutral time axis, red only for conflict or breach; every bar includes text.',
    differentiation: 'Unlike Steward Review Timeline, this Gantt plans future strategy and resource allocation rather than reconstructing past evidence.',
    candidateWidgetConcepts: ['stint bars', 'driver-time bands', 'tyre-set inventory', 'scenario lanes', 'pit-event gates'],
    ordinaryOverlays: ['current race cursor', 'projected pit loss', 'fuel/energy range labels'],
    triggerOnlyAlerts: ['window-opening marker', 'window-closing marker', 'driver-time breach', 'unavailable-tyre warning', 'pit-conflict warning'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-g', 'strategy', 'endurance', 'pit', 'timeline', 'dataheavy'],
    researchNotes: [
      'Driver rules and tyre inventory are external operational inputs and must be versioned and freshness-labeled.',
      'Scenario bars must state assumptions; caution timing must not be presented as certain.'
    ],
    sourceIds: ['S13', 'S14', 'S15'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on full-race operations timeline with no pit-wall room, staff, or project-management application frame.',
      sampleReadouts: ['STINT 3 L42–58', 'DRIVER B 00:47 / 01:10', 'TYRE SET M3', 'PIT LOSS 62 s', 'FCY ALT L49'],
      requiredComposition: ['full-width horizontal Gantt', 'separate driver and tyre rows', 'vertical pit-event gates and current cursor'],
      legibility: 'Resource ownership and legal windows must be readable without color; avoid bars thinner than their labels.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no Jira or project-plan UI', 'no evidence scrubber', 'no unlabeled colored bars']
    }
  },
  {
    id: 'R2-35',
    name: 'Rain Crossover Board',
    familyId: 'G',
    order: 35,
    priority: 2016,
    persona: 'Weather and strategy engineer deciding when to switch tyre type.',
    raceMoment: 'Rain approaching, sectors becoming wet at different rates, or a drying crossover after a storm.',
    purpose: 'Answer when the wet or dry tyre becomes faster by combining spatial weather with intersecting pace curves.',
    informationHierarchy: [
      'Primary: dry/wet crossover time and confidence.',
      'Secondary: radar arrival, sector wetness, and pit-loss marker.',
      'Tertiary: tyre warm-up, temperatures, race-control pit state, and aquaplaning risk.'
    ],
    requiredTelemetryConceptIds: [
      'trackWetness', 'precipitation', 'trackTemperature', 'airTemperature',
      'tyreCarcassTemperature', 'raceFlags', 'pitsOpen',
      'external:weatherRadar', 'external:rainRadarEta',
      'derived:weatherCrossover', 'derived:pitLoss'
    ],
    layoutGrammar: 'A diagonal split divides a spatial radar pane from two intersecting dry/wet pace curves; the crossover point aligns to a vertical pit-loss marker.',
    visualLanguage: 'Weather decision board with one spatial half and one analytical half.',
    materials: ['midnight-blue operations canvas', 'matte radar surface', 'fine curve grid'],
    typographyConstraints: 'Weather-map labels on the radar, tabular time on curves, and one large crossover recommendation.',
    colorConstraints: 'Rain cyan, dry amber, white confidence band, red only for aquaplaning or closure; line style and labels duplicate color.',
    differentiation: 'Unlike Surface Grip Atlas, this brief answers when to switch tyres rather than where grip differs along a route.',
    candidateWidgetConcepts: ['radar pane', 'dry/wet crossover curves', 'pit-loss marker', 'sector-wetness strip', 'confidence band'],
    ordinaryOverlays: ['radar ETA and intensity', 'sector wetness', 'tyre warm-up and pit loss'],
    triggerOnlyAlerts: ['rain-arrival warning', 'crossover-reached recommendation', 'aquaplaning-risk warning', 'pit-closure state'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-g', 'strategy', 'weather', 'rain', 'graph', 'track-map'],
    researchNotes: [
      'Weather radar and ETA are external inputs; local wetness and precipitation alone cannot provide a future radar picture.',
      'Crossover is a derived estimate and must show confidence and pit-loss assumptions.'
    ],
    sourceIds: ['S13', 'S17', 'S33'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic weather strategy board with a diagonal split and no satellite photograph or TV weather studio.',
      sampleReadouts: ['RAIN ETA 06:40', 'S2 WET 48%', 'CROSSOVER +2.1 laps', 'PIT LOSS 58 s', 'CONF 81%'],
      requiredComposition: ['diagonal split', 'spatial radar on one side', 'intersecting wet/dry pace curves on the other'],
      legibility: 'Crossover recommendation and confidence must dominate; radar must remain schematic and labeled.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no generic weather app', 'no surface atlas', 'no color-only radar cells']
    }
  },
  {
    id: 'R2-36',
    name: 'Shape-Coded Timing Tower',
    familyId: 'H',
    order: 36,
    priority: 2015,
    persona: 'Broadcast producer and viewer tracking the full field and class race continuously.',
    raceMoment: 'Persistent live race coverage with lead changes, pit cycles, penalties, and retirements.',
    purpose: 'Provide a continuously visible full-field leaderboard that remains class-readable for color-vision-deficient viewers.',
    informationHierarchy: [
      'Primary: overall and class position rows with gaps.',
      'Secondary: tyre/energy age, pit state, and class leader.',
      'Tertiary: penalties, investigations, flags, and retirements.'
    ],
    requiredTelemetryConceptIds: [
      'overallPosition', 'classIdentity', 'perCarPosition', 'perCarClassPosition',
      'perCarRelativeTime', 'perCarPitRoad', 'perCarLastLap', 'raceFlags',
      'external:officialTiming', 'external:penaltyState', 'derived:tyreAge'
    ],
    layoutGrammar: 'A persistent vertical timing tower uses shape-coded class tabs, patterned row edges, and aligned gaps; the leader row is stable rather than animated.',
    visualLanguage: 'Clean broadcast information design with redundant class encoding and restrained motion.',
    materials: ['broadcast gray surface', 'flat matte rows', 'high-contrast class tabs'],
    typographyConstraints: 'Humanist sans for names, tabular gaps and positions, mixed case, and minimum readable broadcast sizes.',
    colorConstraints: 'Okabe–Ito-compatible accents plus shapes, patterns, and labels; no class or status may rely on hue alone.',
    differentiation: 'Unlike every other entry, this is a continuously visible full-field leaderboard rather than a driver, engineer, or event-specific page.',
    candidateWidgetConcepts: ['position rows', 'shape-coded class tabs', 'pit/penalty glyphs', 'leader separator', 'retirement state'],
    ordinaryOverlays: ['race-state header', 'class tabs and leader markers', 'pit and tyre/energy age columns'],
    triggerOnlyAlerts: ['overall-lead change', 'class-lead change', 'retirement marker', 'penalty or investigation marker'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', 'portrait', 'family-h', 'broadcast', 'standings', 'multiclass', 'accessibility', 'table'],
    researchNotes: [
      'Official timing and penalty state are external authoritative feeds; local arrays must not be presented as official when incomplete.',
      'Shape, pattern, label, and lightness are mandatory alongside class color.'
    ],
    sourceIds: ['S16', 'S34', 'S42'],
    imagePromptConstraints: {
      canvas: '620x1080 portrait broadcast tower, straight-on',
      viewpoint: 'Isolated timing tower graphic with no race footage, TV frame, commentator, or official series branding.',
      sampleReadouts: ['1 ▲ CAR 07', '2 ● CAR 51 +2.482', '3 ■ CAR 12 +5.901', 'PIT', 'INV'],
      requiredComposition: ['persistent vertical full-field rows', 'shape-coded class tabs', 'aligned gap and pit/penalty columns'],
      legibility: 'Rows and class identity must survive grayscale and downscaling; avoid scrolling or decorative motion blur.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no official F1/WEC/IMSA broadcast skin', 'no color-only classes', 'no driver portraits']
    }
  },
  {
    id: 'R2-37',
    name: 'Battle Split Comparator',
    familyId: 'H',
    order: 37,
    priority: 2014,
    persona: 'Commentator or director explaining one live fight between two competitors.',
    raceMoment: 'A closing battle before an overtake zone, temporary-power use, or divergent pit strategy.',
    purpose: 'Communicate which of exactly two competitors has the immediate and strategic advantage.',
    informationHierarchy: [
      'Primary: center convergence gauge and live gap trend.',
      'Secondary: lap pace, tyre age/compound, energy or boost, and passing aid.',
      'Tertiary: speed trap, pit history, and next overtaking zone.'
    ],
    requiredTelemetryConceptIds: [
      'perCarRelativeTime', 'perCarLastLap', 'perCarBestLap', 'perCarPitRoad',
      'perCarPushToPass', 'classIdentity', 'external:officialTiming',
      'external:tyreInventory', 'derived:gapTrend', 'derived:strategicAdvantage',
      'derived:tyreAge'
    ],
    layoutGrammar: 'Exactly two mirrored competitor lanes converge toward a central signed-gap gauge; advantage arrows and the next overtaking-zone marker sit on the center axis.',
    visualLanguage: 'Focused two-car broadcast narrative with hard symmetry and no full-field clutter.',
    materials: ['near-black broadcast canvas', 'flat mirrored lanes', 'neutral center datum'],
    typographyConstraints: 'Neutral broadcast sans, aligned names/numbers, tabular gaps, and no team-specific fonts.',
    colorConstraints: 'Two pattern-coded accents with equal luminance, neutral center gauge, red only for contact or fault; patterns distinguish competitors.',
    differentiation: 'Unlike Delta Microscope, this is a live two-car narrative rather than a single-driver forensic analysis.',
    candidateWidgetConcepts: ['mirrored duel lanes', 'convergence gauge', 'advantage arrows', 'overtake-zone marker', 'pit-history chips'],
    ordinaryOverlays: ['last-lap and tyre-age comparison', 'boost/energy state', 'speed-trap and pit-history chips'],
    triggerOnlyAlerts: ['imminent-pass marker', 'temporary-power activation', 'contact marker', 'pit-divergence marker'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-h', 'broadcast', 'battle', 'comparison', 'traffic', 'race'],
    researchNotes: [
      'Use official or verified timing for broadcast claims; do not infer hidden opponent controls or setup.',
      'Exactly two competitors are shown so the composition stays distinct from a timing tower.'
    ],
    sourceIds: ['S16', 'S33', 'S42'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on broadcast comparator with no race footage, portraits, cars, or official lower-third package.',
      sampleReadouts: ['CAR 07 +0.384 s CAR 51', 'TREND -0.06 s/lap', 'TYRE 12 / 6 laps', 'P2P 18 / 31 s', 'ZONE T1'],
      requiredComposition: ['exactly two mirrored lanes', 'central convergence gauge', 'advantage arrows and overtaking-zone marker'],
      legibility: 'Both competitors must have equal visual weight; advantage must not rely on color alone.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no third competitor', 'no driver portraits', 'no official broadcast package']
    }
  },
  {
    id: 'R2-38',
    name: 'Race Control Incident Wall',
    familyId: 'H',
    order: 38,
    priority: 2013,
    persona: 'Race director triaging simultaneous incidents and operational responses.',
    raceMoment: 'Live multi-incident period with stopped cars, flags, marshal deployment, recovery, or a red-flag recommendation.',
    purpose: 'Centralize field state, incident priority, and response acknowledgement without losing the spatial track picture.',
    informationHierarchy: [
      'Primary: incident queue severity and central track map.',
      'Secondary: stopped-car state, marshal/recovery resources, and flags.',
      'Tertiary: message log, pit state, and acknowledgement timers.'
    ],
    requiredTelemetryConceptIds: [
      'raceFlags', 'perCarProgress', 'perCarTrackLocation', 'perCarRelativeTime',
      'pitsOpen', 'external:incidentReport', 'external:marshalResourceStatus',
      'external:raceControlInstruction', 'derived:incidentSeverity'
    ],
    layoutGrammar: 'A dense incident mosaic surrounds a central track map; the left queue is severity ordered, the right rail shows resources and acknowledgements, and the bottom is a terse message log.',
    visualLanguage: 'Operational control-room interface with safety hierarchy and restrained alarm color.',
    materials: ['matte charcoal control surface', 'flat incident panes', 'high-contrast map layer'],
    typographyConstraints: 'Monospaced control text, large incident IDs, verb-first status, and no small scrolling prose.',
    colorConstraints: 'Safety yellow and red only for operational severity, with icons and labels; neutral gray for acknowledged or closed events.',
    differentiation: 'Unlike Nine-Zone Marshal Map, this wall triages many simultaneous field-wide incidents rather than guiding one car through one procedure.',
    candidateWidgetConcepts: ['incident queue', 'central track pins', 'resource-status rail', 'acknowledgement timers', 'message log'],
    ordinaryOverlays: ['track-state header', 'resource availability', 'acknowledged incident history'],
    triggerOnlyAlerts: ['new high-severity incident', 'exposed-recovery warning', 'red-flag recommendation', 'unacknowledged-instruction timer'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-h', 'race-control', 'incidents', 'track-map', 'operations', 'dense'],
    researchNotes: [
      'Incident reports, marshal resources, and acknowledgements are external operational data; telemetry alone cannot authorize a response.',
      'Red-flag recommendation is advisory and must never masquerade as an official command.'
    ],
    sourceIds: ['S16', 'S41'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic race-control interface only, with no control-room photograph, people, video feeds, or official branding.',
      sampleReadouts: ['INC 14 / T6 / STOPPED', 'INC 15 / PIT EXIT', 'RECOVERY 2 EN ROUTE', 'ACK 00:18', 'RED FLAG REVIEW'],
      requiredComposition: ['central track map', 'incident mosaic around it', 'resource rail and terse message log'],
      legibility: 'Severity, location, and acknowledgement state must remain obvious without flashing or color-only meaning.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no CCTV video thumbnails', 'no official FIA control UI', 'no decorative command-center sci-fi']
    }
  },
  {
    id: 'R2-39',
    name: 'Steward Review Timeline',
    familyId: 'H',
    order: 39,
    priority: 2012,
    persona: 'Steward reconstructing one incident from synchronized evidence.',
    raceMoment: 'Post-event adjudication around the exact contact, flag, or instruction timestamp.',
    purpose: 'Align telemetry, camera time, track position, messages, and evidence documents on one auditable timeline.',
    informationHierarchy: [
      'Primary: exact contact moment and synchronized evidence lanes.',
      'Secondary: multi-car position/relative traces, flags, and camera timestamps.',
      'Tertiary: message evidence, document pins, clock quality, and missing-evidence state.'
    ],
    requiredTelemetryConceptIds: [
      'replayTimeline', 'perCarProgress', 'perCarRelativeTime', 'raceFlags',
      'external:videoTimestamp', 'external:cameraEvidence', 'external:evidenceDocument',
      'external:raceControlInstruction', 'derived:clockSynchronization',
      'derived:synchronizedDistanceTrace'
    ],
    layoutGrammar: 'A horizontal scrubber spans the screen; camera, telemetry, flag, message, and document lanes align vertically, with the contact instant pinned by one immutable center line.',
    visualLanguage: 'Neutral evidence workstation with exact time alignment and no dramatic animation.',
    materials: ['neutral gray workspace', 'matte evidence lanes', 'fine white synchronization line'],
    typographyConstraints: 'Restrained tabular sans, exact timestamps, source labels, and no editorial verdict language in the evidence lanes.',
    colorConstraints: 'White and amber evidence, neutral gray context, red only for missing/conflicting data; source icons and labels duplicate color.',
    differentiation: 'Unlike Race Control Incident Wall, this is post-event evidence reconstruction for one incident rather than live field triage.',
    candidateWidgetConcepts: ['evidence scrubber', 'synchronized lanes', 'contact pin', 'camera/source badges', 'document drawer'],
    ordinaryOverlays: ['incident and car identifiers', 'clock-offset readout', 'selected evidence source'],
    triggerOnlyAlerts: ['missing-evidence marker', 'clock-mismatch warning', 'conflicting-identity warning'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-h', 'steward', 'timeline', 'evidence', 'race-control', 'analysis'],
    researchNotes: [
      'Video and document evidence are external sources; telemetry timestamps must show synchronization quality.',
      'The interface must remain neutral and avoid visually implying guilt or a decision before review.'
    ],
    sourceIds: ['S04', 'S09', 'S41'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on evidence timeline with no actual race footage, identifiable drivers, official documents, or courtroom imagery.',
      sampleReadouts: ['CONTACT 14:32:18.442', 'CAM 2 OFFSET +0.018 s', 'CAR 07 / CAR 51', 'YELLOW +1.24 s', 'MSG 14:32:16.901'],
      requiredComposition: ['full-width horizontal scrubber', 'five synchronized evidence lanes', 'fixed center contact line'],
      legibility: 'Timestamp source and alignment must be clear; no animation blur or overlapping pins.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no actual video thumbnails', 'no guilty/innocent verdict graphics', 'no future-strategy Gantt']
    }
  },
  {
    id: 'R2-40',
    name: 'Multiclass Story Mosaic',
    familyId: 'H',
    order: 40,
    priority: 2011,
    persona: 'Endurance broadcast director choosing the most important live race narrative.',
    raceMoment: 'Class lead swap, pit-cycle inversion, driver-time pressure, live battle, or rain arrival.',
    purpose: 'Summarize one hero story and four supporting class/strategy threads without becoming a timing wall.',
    informationHierarchy: [
      'Primary: one editorial hero panel with the current race story.',
      'Secondary: four hard-edged panels for class leaders, pit cycle, driver stint, and weather.',
      'Tertiary: energy/fuel state, penalties, and live battle cues.'
    ],
    requiredTelemetryConceptIds: [
      'perCarClassPosition', 'driverIdentity', 'perCarPitRoad', 'perCarLastLap',
      'precipitation', 'classIdentity', 'external:officialTiming',
      'external:driverTimeRules', 'derived:raceNarrative',
      'derived:driverStintTime', 'derived:strategyWindow'
    ],
    layoutGrammar: 'One large editorial hero occupies the left half; four hard-edged supporting panels form a 2×2 mosaic on the right, connected by a thin pit-cycle ribbon.',
    visualLanguage: 'Dark studio-blue endurance storytelling with patterned class accents and restrained editorial typography.',
    materials: ['dark studio-blue canvas', 'flat hard-edged panels', 'matte ribbon separators'],
    typographyConstraints: 'Wide humanist sans for the hero statement, tabular timing in support panels, and no headline longer than seven words.',
    colorConstraints: 'Patterned class accents with equal lightness, neutral body text, amber developing story, red only for confirmed critical state.',
    differentiation: 'Unlike Multiclass Traffic Loom, this page summarizes viewer-facing stories rather than predicting immediate driver traffic.',
    candidateWidgetConcepts: ['editorial hero', 'class-leader panel', 'pit-cycle ribbon', 'driver-stint panel', 'weather panel'],
    ordinaryOverlays: ['class leader summaries', 'pit-cycle and driver-time state', 'weather and penalty context'],
    triggerOnlyAlerts: ['lead-swap hero change', 'strategy-inversion marker', 'driver-limit warning', 'penalty marker', 'rain-arrival story'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-h', 'broadcast', 'multiclass', 'story', 'endurance', 'tile'],
    researchNotes: [
      'Race narrative is derived from verified timing and operational data; editorial confidence must drop when feeds disagree.',
      'Use generic class labels and no official broadcaster, series, manufacturer, team, or sponsor branding.'
    ],
    sourceIds: ['S13', 'S16', 'S42'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on broadcast story board with no race footage, presenters, portraits, or official network package.',
      sampleReadouts: ['HERO: GT LEAD FLIPS IN PIT CYCLE', 'HYP P1 +4.2 s', 'GT P1 18 s STOP', 'DRIVER 08:12 LEFT', 'RAIN ETA 11 min'],
      requiredComposition: ['one large hero panel', 'exactly four supporting panels', 'thin pit-cycle ribbon connecting the mosaic'],
      legibility: 'The hero story must dominate but every support panel remains readable; class meaning must not rely on hue.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no official broadcast graphics', 'no traffic-prediction strands', 'no generic news website cards']
    }
  },
  {
    id: 'R2-41',
    name: 'Color-Safe Driver DDU',
    familyId: 'I',
    order: 41,
    priority: 2010,
    persona: 'Color-vision-deficient GT driver at race pace.',
    raceMoment: 'Normal racing with shifting, delta, flags, controls, tyres, fuel, and critical health changes.',
    purpose: 'Deliver a complete conventional driver DDU where every status remains understandable without hue discrimination.',
    informationHierarchy: [
      'Primary: gear, patterned shift cells, speed, and signed delta.',
      'Secondary: flags, fuel, controls, and tyre state.',
      'Tertiary: lap timing, position, and engine health.'
    ],
    requiredTelemetryConceptIds: [
      'gear', 'engineRpm', 'shiftLights', 'speed', 'deltaBest', 'raceFlags',
      'tcSetting', 'absSetting', 'brakeBias', 'tyreCarcassTemperature',
      'tyreColdPressure', 'fuelLevel', 'engineWarnings', 'overallPosition'
    ],
    layoutGrammar: 'Asymmetric but stable blocks use patterned shift cells, labeled flag shapes, textured status chips, and a large gear/speed anchor.',
    visualLanguage: 'Competition DDU designed from the start for redundant non-color encoding.',
    materials: ['matte black face', 'anti-glare display glass', 'tactile-looking pattern cells'],
    typographyConstraints: 'Robust sans with open counters, tabular numerals, readable mixed-case status, and no ultra-thin type.',
    colorConstraints: 'Okabe–Ito-compatible accents, minimum 3:1 non-text contrast, and mandatory shape/text/pattern duplication for every status.',
    differentiation: 'Unlike GT Gear Monolith, the defining design decision is complete redundant non-color encoding rather than strict symmetry and gear dominance.',
    candidateWidgetConcepts: ['patterned shift cells', 'labeled flag shapes', 'textured control chips', 'signed delta block', 'four-corner tyre state'],
    ordinaryOverlays: ['lap and position strip', 'fuel and controls', 'tyre and engine-health status'],
    triggerOnlyAlerts: ['flag takeover with text/icon/pattern', 'low-fuel warning', 'tyre warning', 'critical-engine warning'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-i', 'accessibility', 'color-safe', 'driver', 'ddu-inspired', 'race'],
    researchNotes: [
      'Every state requires redundant text, shape, lightness, and pattern; color may reinforce but never carry meaning alone.',
      'Use configured telemetry thresholds and honest pressure availability.'
    ],
    sourceIds: ['S34', 'S36', 'S38'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic driver DDU reference with no cockpit or proprietary hardware housing.',
      sampleReadouts: ['GEAR 4', 'SPEED 226 km/h', 'DELTA -0.18 s', 'FUEL 8.4 laps', 'YELLOW FLAG'],
      requiredComposition: ['large gear/speed anchor', 'patterned shift cells', 'labeled flag shape and textured status chips'],
      legibility: 'The complete state must remain understandable in simulated grayscale and common CVD previews.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no red-versus-green-only delta', 'no unlabeled colored LEDs', 'no thin low-contrast type']
    }
  },
  {
    id: 'R2-42',
    name: 'Low-Vision One-Action Dash',
    familyId: 'I',
    order: 42,
    priority: 2009,
    persona: 'Low-vision driver who needs one immediate action or state at a time.',
    raceMoment: 'Normal shifting interrupted by a pit, slow, stop, flag, limiter, or critical-fault instruction.',
    purpose: 'Suppress secondary telemetry so the one required action remains unmistakable.',
    informationHierarchy: [
      'Primary: one enormous actionable word and icon, or gear during normal running.',
      'Secondary: speed and shift point.',
      'Tertiary: optional signed delta only when no action state is active.'
    ],
    requiredTelemetryConceptIds: [
      'gear', 'speed', 'shiftLights', 'raceFlags', 'pitLimiter', 'engineWarnings', 'deltaBest'
    ],
    layoutGrammar: 'One full-screen action tile occupies almost the entire canvas; a giant gear numeral replaces it during normal running, with only a minimal speed footer.',
    visualLanguage: 'Extreme low-vision simplicity with stable placement and no visual noise.',
    materials: ['flat matte black surface', 'high-contrast white display', 'single amber status accent'],
    typographyConstraints: 'Very large heavy sans, target 7:1 text contrast, one or two words maximum, and no condensed microtext.',
    colorConstraints: 'Black and white primary, one amber accent, red only for STOP; action words and large icons duplicate color.',
    differentiation: 'Unlike every other entry, the dashboard intentionally displays only one actionable message at a time.',
    candidateWidgetConcepts: ['full-screen command', 'giant gear numeral', 'minimal speed footer', 'single shift cue'],
    ordinaryOverlays: ['giant gear during normal state', 'minimal speed footer', 'single shift cue'],
    triggerOnlyAlerts: ['PIT full-screen command', 'SLOW full-screen command', 'STOP full-screen command', 'FLAG full-screen command'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-i', 'accessibility', 'low-vision', 'minimal', 'driver', 'bignum'],
    researchNotes: [
      'Action replacement must be deterministic and stable; do not stack or cycle simultaneous messages.',
      'Text contrast targets 7:1 and non-text symbols remain large with clear shape.'
    ],
    sourceIds: ['S35', 'S37'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on full-screen low-vision display with no bezel detail or cockpit context.',
      sampleReadouts: ['SLOW', '80 km/h', 'large triangular caution icon'],
      requiredComposition: ['one enormous centered action word', 'one large matching icon', 'minimal speed footer'],
      legibility: 'The action must be readable at severe blur and 20% scale; use at least 7:1 text contrast.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no secondary card grid', 'no blinking', 'no more than one active command']
    }
  },
  {
    id: 'R2-43',
    name: 'Haptic Proximity Compass',
    familyId: 'I',
    order: 43,
    priority: 2008,
    persona: 'Driver using visual, audio, and seat or pedal haptic redundancy for spatial threats.',
    raceMoment: 'Side-by-side traffic, rapid closing, wheel lock, traction loss, or track-limit excursion.',
    purpose: 'Map threat direction directly to eight visual and haptic sectors while keeping center telemetry minimal.',
    informationHierarchy: [
      'Primary: eight-sector threat compass and active haptic direction.',
      'Secondary: overlap, closing rate, and threat severity.',
      'Tertiary: ABS/TC, wheel-slip, track-limit, gear, and speed.'
    ],
    requiredTelemetryConceptIds: [
      'proximity', 'perCarRelativeTime', 'absActive', 'tcActive',
      'playerSurfaceMaterial', 'gear', 'speed', 'external:hapticOutput',
      'derived:hapticDirection', 'derived:closingRate', 'derived:tyreSlip'
    ],
    layoutGrammar: 'An eight-sector radial compass surrounds a minimal gear/speed center; active sectors use pattern, glyph, direction labels, and a mirrored haptic-output preview.',
    visualLanguage: 'Multimodal proximity instrument where visual geometry maps one-to-one to physical haptic zones.',
    materials: ['charcoal face', 'matte sector wedges', 'anti-glare center lens'],
    typographyConstraints: 'Large directional labels, compact center numerals, and no tiny legend for haptic meaning.',
    colorConstraints: 'CVD-safe sector accents plus patterns and glyphs; severity also changes wedge thickness and pulse notation.',
    differentiation: 'Unlike Q-Delta Compass, this radial instrument represents physical proximity and haptic direction rather than lap-time performance.',
    candidateWidgetConcepts: ['eight-sector threat compass', 'haptic-output preview', 'overlap glyphs', 'minimal center telemetry', 'slip/ABS/TC cue'],
    ordinaryOverlays: ['gear and speed center', 'haptic channel health', 'compact ABS/TC state'],
    triggerOnlyAlerts: ['directional overlap pulse', 'rapid-closing pulse', 'lockup pulse', 'traction-loss pulse', 'off-track pulse'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-i', 'accessibility', 'haptic', 'radar', 'driver', 'radial'],
    researchNotes: [
      'Haptic output is an external actuator state; the visual preview must match actual configured zones rather than imply hardware exists.',
      'Direction, glyph, audio/haptic mapping, and color should be redundant, not contradictory.'
    ],
    sourceIds: ['S34', 'S39', 'S40'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic multimodal display reference with no seat, pedal, wheel, driver, or hardware photograph.',
      sampleReadouts: ['LEFT OVERLAP', 'RIGHT REAR +0.4 s', 'HAPTIC L2 ACTIVE', 'ABS PULSE', 'GEAR 4 / 184 km/h'],
      requiredComposition: ['eight visible radial sectors', 'minimal center gear/speed', 'haptic-output preview aligned to sectors'],
      legibility: 'Threat direction and severity must be understandable in grayscale and without animation.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no delta compass', 'no vibration-wave decoration', 'no color-only sectors']
    }
  },
  {
    id: 'R2-44',
    name: 'Captioned Radio/Race-State Board',
    familyId: 'I',
    order: 44,
    priority: 2007,
    persona: 'Deaf or hard-of-hearing driver reading spotter, crew, and race-control intent.',
    raceMoment: 'Live radio instruction with urgency, expiry, proximity, flag, penalty, or pit relevance.',
    purpose: 'Convert communications into concise, source-labeled, verb-first captions with one pinned urgent instruction.',
    informationHierarchy: [
      'Primary: pinned urgent caption and expiry.',
      'Secondary: source, speaker/intent, and recent caption lane.',
      'Tertiary: proximity, flag, penalty, and pit context.'
    ],
    requiredTelemetryConceptIds: [
      'raceFlags', 'proximity', 'pitsOpen', 'external:radioCaption',
      'external:raceControlInstruction', 'external:penaltyState',
      'derived:captionUrgency'
    ],
    layoutGrammar: 'A horizontal caption lane scrolls beneath one large pinned instruction; source badges sit left, expiry bars sit right, and race-state icons remain fixed at the bottom.',
    visualLanguage: 'Readable communication board with broadcast-caption discipline and no chat-app styling.',
    materials: ['matte black face', 'flat caption lane', 'high-contrast pinned panel'],
    typographyConstraints: 'Readable mixed-case sans, verb-first phrases, maximum one short line per caption, and no all-caps paragraph blocks.',
    colorConstraints: 'White captions, amber urgency, red only for stop-level commands; source badge, icon, and text duplicate state.',
    differentiation: 'Unlike Pacenote Cascade, this board records communications and race state rather than predictive road geometry.',
    candidateWidgetConcepts: ['pinned urgent caption', 'source badge', 'caption history lane', 'expiry bar', 'race-state footer'],
    ordinaryOverlays: ['recent caption history', 'source and timestamp', 'fixed proximity/flag/pit context'],
    triggerOnlyAlerts: ['CAR LEFT caption', 'CLEAR caption', 'PIT caption', 'PENALTY caption', 'FLAG caption'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-i', 'accessibility', 'captions', 'race-control', 'driver', 'text'],
    researchNotes: [
      'Caption text is an external speech/race-control feed and must preserve source and freshness.',
      'Only concise operational intent is shown; uncertain transcription must be visibly marked rather than silently asserted.'
    ],
    sourceIds: ['S34', 'S40', 'S41'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on caption board with no chat application, radio handset, people, or race footage.',
      sampleReadouts: ['SPOTTER: CAR LEFT', 'CREW: PIT THIS LAP', 'CONTROL: YELLOW T8', 'EXPIRES 04 s'],
      requiredComposition: ['one large pinned urgent caption', 'one-line recent caption lane', 'source badges and expiry bars'],
      legibility: 'Captions must be readable at a glance with mixed case and strong contrast; no message may wrap beyond one line.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no chat bubbles', 'no auto-scrolling wall of text', 'no color-only urgency']
    }
  },
  {
    id: 'R2-45',
    name: 'Calm Cognitive Pitwall',
    familyId: 'I',
    order: 45,
    priority: 2006,
    persona: 'Novice strategist or operator who is sensitive to overload and needs guided decisions.',
    raceMoment: 'A pit, tyre, weather, fuel, or driver-time decision with multiple evidence inputs.',
    purpose: 'Present one decision, its evidence, recommendation, and confirmation as a stable progressive-disclosure workflow.',
    informationHierarchy: [
      'Primary: one current decision and recommended action.',
      'Secondary: concise evidence summary and consequence.',
      'Tertiary: confirmation step, queued next decision, and race-state context.'
    ],
    requiredTelemetryConceptIds: [
      'fuelLevel', 'tyreWear', 'trackWetness', 'precipitation', 'pitsOpen',
      'driverIdentity', 'raceFlags', 'external:driverTimeRules',
      'external:pitwallWorkflowState', 'derived:strategyWindow',
      'derived:decisionRecommendation'
    ],
    layoutGrammar: 'A stable four-step vertical flow—DECIDE, EVIDENCE, RECOMMEND, CONFIRM—reveals one section at a time while preserving fixed positions and large targets.',
    visualLanguage: 'Warm, calm operations interface with deliberate pacing and no reordering or alarm cascade.',
    materials: ['warm dark-gray matte surface', 'soft-touch visual panels', 'low-glare flat controls'],
    typographyConstraints: 'Humanist sans, plain language, large targets, short sentences, and no dense abbreviations without explanation.',
    colorConstraints: 'Teal neutral/confirmed, amber attention, red only for critical stop; no blinking, no color-only meaning, no moving cards.',
    differentiation: 'Unlike every other engineer page, this brief behaves as a guided task workflow rather than a simultaneous data workspace.',
    candidateWidgetConcepts: ['decision step', 'evidence summary', 'recommendation block', 'confirmation control', 'single-alert queue'],
    ordinaryOverlays: ['race-state header', 'next decision queue count', 'source/freshness footer'],
    triggerOnlyAlerts: ['one queued decision alert at a time', 'critical stop recommendation', 'required acknowledgement for consequential change'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-i', 'accessibility', 'cognitive', 'strategy', 'workflow', 'minimal'],
    researchNotes: [
      'The workflow must never reorder itself or show multiple competing alarms; consequential changes require explicit acknowledgement.',
      'Recommendations are derived and must state evidence, confidence, and unavailable inputs.'
    ],
    sourceIds: ['S34', 'S35', 'S36', 'S37'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic guided pit-wall workflow with no office scene, people, or generic web application frame.',
      sampleReadouts: ['DECISION: PIT IN 3 LAPS?', 'EVIDENCE: FUEL +0.4 / RAIN ETA 8 MIN', 'RECOMMEND: STAY OUT', 'CONFIRM'],
      requiredComposition: ['four stable labeled steps', 'one expanded current step', 'large confirmation target and one-alert queue'],
      legibility: 'No blinking, movement, or reordering; each step uses plain language and large readable text.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no kanban cards', 'no toast notification pile', 'no simultaneous conflicting recommendations']
    }
  },
  {
    id: 'R2-46',
    name: 'Needle-and-Strip Tach',
    familyId: 'J',
    order: 46,
    priority: 2005,
    persona: 'Historic or club driver preserving engine health while racing.',
    raceMoment: 'Race pace with frequent RPM checks and limited digital instrumentation.',
    purpose: 'Combine a dominant mechanical tachometer with a narrow modern strip for gear, speed, and critical vitals.',
    informationHierarchy: [
      'Primary: large semicircular analog RPM needle and redline.',
      'Secondary: gear and speed strip plus external shift lamps.',
      'Tertiary: oil pressure/temperature, coolant temperature, and voltage.'
    ],
    requiredTelemetryConceptIds: [
      'engineRpm', 'speed', 'gear', 'oilPressure', 'oilTemperature',
      'coolantTemperature', 'systemVoltage', 'shiftLights', 'engineWarnings'
    ],
    layoutGrammar: 'One large semicircular needle occupies the upper two-thirds; a narrow segmented LCD strip runs below, with five discrete external lamps above the arc.',
    visualLanguage: 'Original heritage racing instrument with mechanical tactility and modern data honesty.',
    materials: ['cream and black dial face', 'carbon-composite surround', 'restrained chrome-like trim', 'smoked LCD'],
    typographyConstraints: 'Original period-inspired condensed numerals, not a copied typeface; segmented LCD values remain tabular and explicit.',
    colorConstraints: 'Cream/black dial, restrained redline, amber tell-tales, blue shift flash; no faux patina that reduces contrast.',
    differentiation: 'Unlike Qualifying Needle, this needle is visibly mechanical and RPM-centered rather than a modern lap-start readiness instrument.',
    candidateWidgetConcepts: ['semicircular tach needle', 'narrow gear/speed LCD', 'five-stage external lamps', 'engine-vital tell-tales'],
    ordinaryOverlays: ['gear and speed strip', 'oil / water / voltage row', 'redline and peak marker'],
    triggerOnlyAlerts: ['over-rev lamp takeover', 'low-oil-pressure warning', 'high-temperature warning'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-j', 'historic', 'club', 'analog', 'rpm', 'needle'],
    researchNotes: [
      'The design may evoke period instrumentation but must use original geometry, numerals, and branding-free materials.',
      'Critical thresholds remain configurable by the specific historic car.'
    ],
    sourceIds: ['S08'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on isolated heritage instrument panel with no car interior, steering wheel, hands, or manufacturer badge.',
      sampleReadouts: ['RPM 6,420', 'GEAR 4', 'SPEED 168 km/h', 'OIL 410 kPa / 104°C', 'WATER 92°C'],
      requiredComposition: ['large semicircular analog tach', 'narrow LCD strip below', 'five discrete lamps above'],
      legibility: 'Needle position, redline, gear, and oil pressure must remain clear; texture stays subtle.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no replica Stack ST8100 face', 'no manufacturer badge', 'no excessive vintage distress']
    }
  },
  {
    id: 'R2-47',
    name: 'Classic Enduro Chronograph',
    familyId: 'J',
    order: 47,
    priority: 2004,
    persona: 'Vintage endurance driver tracking race, stint, lap, and fuel reserve.',
    raceMoment: 'Long historic race stint where elapsed time and range matter more than modern predictive graphics.',
    purpose: 'Make layered elapsed-time reading tactile and immediate while retaining fuel and basic health.',
    informationHierarchy: [
      'Primary: elapsed race, stint, and lap chronograph subdials.',
      'Secondary: mechanical odometer-style lap count and fuel reserve.',
      'Tertiary: speed and basic engine health.'
    ],
    requiredTelemetryConceptIds: [
      'sessionTime', 'currentLapTime', 'completedLaps', 'fuelLevel', 'speed',
      'engineWarnings', 'oilPressure', 'derived:driverStintTime',
      'derived:fuelLapsRemaining'
    ],
    layoutGrammar: 'Three chronograph subdials overlap a larger elapsed-race dial; a mechanical odometer window and fuel reserve aperture sit along the bottom.',
    visualLanguage: 'Original classic endurance timepiece translated into a legible racing display.',
    materials: ['black and cream dial', 'brushed aluminum', 'leather-like trim', 'domed anti-glare glass'],
    typographyConstraints: 'Original period-style tabular numerals, clear subdial labels, and no luxury-watch branding or copied dial furniture.',
    colorConstraints: 'Black/cream primary, low-luminance amber backlight, restrained red reserve marker; no glossy gold ornament.',
    differentiation: 'Unlike Night Driver-Swap Continuity, this is a heritage elapsed-time instrument without operational handoff tasks.',
    candidateWidgetConcepts: ['race chronograph', 'stint subdial', 'lap hand', 'odometer window', 'fuel reserve aperture'],
    ordinaryOverlays: ['speed and lap count', 'oil-pressure tell-tale', 'fuel reserve window'],
    triggerOnlyAlerts: ['reserve-fuel warning', 'stint-limit warning', 'pit-call marker', 'low-oil-pressure warning'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-j', 'historic', 'endurance', 'analog', 'clock', 'dial'],
    researchNotes: [
      'Driver stint limits require external rules where applicable; the visual chronograph itself must remain original.',
      'Avoid any recognizable luxury-watch or commercial motorsport-instrument dial.'
    ],
    sourceIds: ['S08', 'S13'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Orthographic heritage chronograph panel with no wristwatch, car cabin, driver, or product branding.',
      sampleReadouts: ['RACE 03:42:18', 'STINT 00:47:12', 'LAP 01:58.442', 'LAPS 112', 'FUEL 14 laps'],
      requiredComposition: ['three chronograph subdials', 'mechanical odometer window', 'fuel reserve aperture'],
      legibility: 'Each clock must have a distinct scale and label; hands cannot obscure numeric windows.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no luxury watch branding', 'no driver-swap checklist', 'no photoreal wristwatch']
    }
  },
  {
    id: 'R2-48',
    name: 'Mechanical Health Sextant',
    familyId: 'J',
    order: 48,
    priority: 2003,
    persona: 'Historic racer preserving fragile engine and electrical systems.',
    raceMoment: 'Sustained racing or recovery after a warning when mechanical survival outranks pace.',
    purpose: 'Place six critical health gauges in one coherent mechanical arc with clear peak memory.',
    informationHierarchy: [
      'Primary: oil pressure, oil temperature, and coolant temperature.',
      'Secondary: fuel pressure, voltage, and RPM.',
      'Tertiary: peak recall and one central master warning lamp.'
    ],
    requiredTelemetryConceptIds: [
      'oilPressure', 'oilTemperature', 'coolantTemperature',
      'fuelPressure', 'systemVoltage', 'engineRpm',
      'engineWarnings', 'derived:peakRecall'
    ],
    layoutGrammar: 'Six small analog gauges form a sextant arc around one central master lamp; each gauge carries a current needle and a retained peak or minimum marker.',
    visualLanguage: 'Purposeful historic mechanical-survival panel with no strategy or lap-time content.',
    materials: ['crackle-black face', 'cream ticks', 'subtle metal bezels', 'matte glass'],
    typographyConstraints: 'Mechanical-style numerals with explicit units, readable gauge names, and no decorative script.',
    colorConstraints: 'Cream ticks, white needles, limited red danger zones, amber master lamp; zones remain labeled.',
    differentiation: 'Unlike Stint Health Quadrant, this brief excludes strategy and focuses solely on vintage mechanical survival.',
    candidateWidgetConcepts: ['six analog gauges', 'central master lamp', 'peak/minimum markers', 'engine-health summary'],
    ordinaryOverlays: ['current values and units', 'peak/minimum markers', 'master warning state'],
    triggerOnlyAlerts: ['oil-pressure collapse', 'oil or coolant overtemperature', 'fuel-pressure loss', 'voltage failure'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-j', 'historic', 'engine', 'analog', 'warning', 'gauge'],
    researchNotes: [
      'Thresholds and red zones are car-specific and must be configurable.',
      'The sextant arrangement is original and must not copy a Stack, MoTeC, or period manufacturer cluster.'
    ],
    sourceIds: ['S03', 'S08'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on isolated six-gauge panel with no vehicle interior or manufacturer badge.',
      sampleReadouts: ['OIL P 410 kPa', 'OIL T 104°C', 'WATER 92°C', 'FUEL P 3.4 bar', 'VOLT 13.8 V', 'RPM 5,860'],
      requiredComposition: ['six equal analog gauges in a sextant arc', 'one central master lamp', 'visible peak/minimum markers'],
      legibility: 'Gauge identity and current value must remain readable; needles cannot hide units or peak markers.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no strategy data', 'no copied period cluster', 'no excessive chrome or patina']
    }
  },
  {
    id: 'R2-49',
    name: 'Club Sprint Predictive Strip',
    familyId: 'J',
    order: 49,
    priority: 2002,
    persona: 'Club sprint or hillclimb driver using compact late-1990s-style instrumentation.',
    raceMoment: 'One timed run where external shift lamps and predicted result dominate.',
    purpose: 'Deliver prediction and peak recall through deliberately constrained segmented-display technology.',
    informationHierarchy: [
      'Primary: five external shift lamps and predicted finish time.',
      'Secondary: current run time and split.',
      'Tertiary: peak speed/RPM, validity, and engine alarms.'
    ],
    requiredTelemetryConceptIds: [
      'engineRpm', 'shiftLights', 'currentLapTime', 'estimatedLap', 'speed',
      'engineWarnings', 'derived:peakRecall', 'derived:predictiveLapTime',
      'derived:lapValidity'
    ],
    layoutGrammar: 'A tiny segmented LCD strip sits below five large external lamps; prediction, current time, and peak recall share one fixed-width line.',
    visualLanguage: 'Constrained late-1990s club instrumentation with authentic limits but original geometry.',
    materials: ['black carbon composite', 'greenish monochrome LCD', 'discrete amber/red lamps'],
    typographyConstraints: 'Segmented fixed-width numerals only, short mode codes, and no anti-aliased modern typography inside the LCD.',
    colorConstraints: 'Greenish LCD, amber approach lamps, red over-rev, blue shift flash if configured; lamp state also uses count and pattern.',
    differentiation: 'Unlike Sprint RPM Blade, this brief embraces deliberately limited compact LCD technology instead of a modern ultra-wide strip.',
    candidateWidgetConcepts: ['five external lamps', 'predictive time strip', 'current run clock', 'peak recall', 'validity marker'],
    ordinaryOverlays: ['current and predicted run time', 'peak speed/RPM recall', 'split and validity code'],
    triggerOnlyAlerts: ['over-rev lamp takeover', 'low-oil-pressure code', 'temperature code', 'invalid-run code', 'finish confirmation'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', 'family-j', 'club', 'sprint', 'historic', 'segment', 'rpm', 'minimal'],
    researchNotes: [
      'The constrained display language is original and must not reproduce a Stack or AiM product face.',
      'Prediction and validity are derived and must show blank or dashed states when unavailable.'
    ],
    sourceIds: ['S02', 'S08'],
    imagePromptConstraints: {
      canvas: '1280x360 ultra-wide compact instrument, straight-on',
      viewpoint: 'Isolated lamp-and-LCD strip with no dash panel, wheel, car, or manufacturer branding.',
      sampleReadouts: ['RUN 48.214', 'PRED 47.982', 'SPLIT -0.118', 'MAX 183 km/h', 'RPM 7,920'],
      requiredComposition: ['five discrete lamps above', 'tiny single-line segmented LCD below', 'prediction and peak recall on the same strip'],
      legibility: 'The limited LCD must remain readable and authentic without simulating broken or deformed segments.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no modern full-color screen', 'no copied Stack/AiM housing', 'no tall dashboard body']
    }
  },
  {
    id: 'R2-50',
    name: 'Historic Rally Tripmaster',
    familyId: 'J',
    order: 50,
    priority: 2001,
    persona: 'Historic or regularity rally co-driver managing distance, target time, and average speed.',
    raceMoment: 'Road section or regularity stage approaching the next route control.',
    purpose: 'Replace RPM-centric racing data with navigation and schedule deviation in a period-compatible instrument.',
    informationHierarchy: [
      'Primary: twin trip counters, target time, and average-speed deviation.',
      'Secondary: route distance and next-control schedule.',
      'Tertiary: heading, speed, battery, red flag, and manual-reset state.'
    ],
    requiredTelemetryConceptIds: [
      'speed', 'geographicPosition', 'headingNorth', 'raceFlags', 'systemVoltage',
      'external:tripDistance', 'external:targetAverageSpeed',
      'external:routeControl', 'external:timeCard',
      'derived:targetTimeDeviation', 'derived:averageSpeed'
    ],
    layoutGrammar: 'Twin mechanical-style counters sit beside a narrow paper-card slot; a deviation needle bridges them and small warning lamps line the lower edge.',
    visualLanguage: 'Original historic tripmaster with warm backlight and functional paper-route context.',
    materials: ['black painted metal', 'warm green/amber backlight', 'paper-card texture', 'small metal reset knobs'],
    typographyConstraints: 'Drum-style monospaced numerals, clear units, short control codes, and no copied period-brand typography.',
    colorConstraints: 'Warm green/amber normal lighting, red only for flag or severe deviation, white paper card; lamps include labels.',
    differentiation: 'Unlike every other entry, regularity navigation and schedule deviation replace RPM and lap-performance priorities.',
    candidateWidgetConcepts: ['twin trip counters', 'deviation needle', 'control schedule', 'paper-card slot', 'manual-reset indicator'],
    ordinaryOverlays: ['next-control schedule', 'heading and current speed', 'manual reset and battery state'],
    triggerOnlyAlerts: ['early-arrival warning', 'late-arrival warning', 'missed-waypoint warning', 'route-deviation warning', 'battery warning', 'red-flag takeover'],
    tags: ['dashboard', 'release-b', 'telemetry-framework', '1024x600', 'family-j', 'historic', 'rally', 'navigation', 'analog', 'timing'],
    researchNotes: [
      'Trip, target average, route control, and time card are external regularity-rally inputs; GPS alone cannot infer the official route schedule.',
      'Use original generic counter geometry and no Halda, Brantz, Stack, or event branding.'
    ],
    sourceIds: ['S08', 'S27', 'S29'],
    imagePromptConstraints: {
      canvas: DASHBOARD_PORTFOLIO_CANVAS,
      viewpoint: 'Straight-on isolated tripmaster panel with no rally cockpit, hands, road book, event logo, or vehicle.',
      sampleReadouts: ['TRIP A 042.18 km', 'TRIP B 006.42 km', 'TARGET 72.0 km/h', 'DEV +00:11', 'CTRL 14 / 3.8 km'],
      requiredComposition: ['two mechanical-style counters', 'central deviation needle', 'paper-card slot and small labeled warning lamps'],
      legibility: 'Trip, target, and deviation must remain readable under warm low light; paper texture cannot obscure text.',
      avoid: DASHBOARD_PORTFOLIO_PROMPT_PROHIBITIONS,
      avoidAlso: ['no branded tripmaster replica', 'no RPM tachometer', 'no GPS navigation-app map']
    }
  }
] as const satisfies readonly DashboardPortfolioEntry[]
