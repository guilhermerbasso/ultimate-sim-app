import {
  SETUP_ADJUSTMENT_CODES,
  SETUP_AREA_VALUES,
  SETUP_CORNER_VALUES,
  SETUP_DIRECTION_VALUES,
  SETUP_MAGNITUDE_VALUES,
  SETUP_PHASE_VALUES,
  SETUP_SYMPTOM_VALUES,
  type SetupAdjustmentCode,
  type SetupArea,
  type SetupCorner,
  type SetupDirection,
  type SetupMagnitude,
  type SetupSymptomKind
} from '../../../shared/setup-advisor'
import type { CoachPhase } from '../../../shared/coach'
import type { ResolvedLanguage } from '../i18n'

interface SetupLocaleCopy {
  symptoms: Record<SetupSymptomKind, string>
  areas: Record<SetupArea, string>
  directions: Record<SetupDirection, string>
  magnitudes: Record<SetupMagnitude, string>
  corners: Record<SetupCorner, string>
  phases: Record<CoachPhase, string>
  adjustments: Record<SetupAdjustmentCode, string>
  rationale: {
    understeer: string
    oversteer: string
    overheat: string
    cold: string
    imbalance: string
    camberExcess: string
    camberLack: string
    pressureHigh: string
    pressureLow: string
    frontLock: string
    rearLock: string
  }
  evidence: {
    balance: string
    pressure: string
    camber: string
    average: string
    imbalance: string
    frontLock: string
    rearLock: string
  }
  adjustmentDetails: string
  currentBrakeBias: string
  structuredInsufficient: string
}

function addRecord<T extends string>(
  target: Record<string, string>,
  prefix: string,
  keys: readonly T[],
  values: Record<T, string>
): void {
  for (const key of keys) target[`${prefix}.${key}`] = values[key]
}

function setupCatalog(copy: SetupLocaleCopy): Record<string, string> {
  const catalog: Record<string, string> = {
    'debrief.history.setup.adjustmentDetails': copy.adjustmentDetails,
    'debrief.history.setup.currentBrakeBias': copy.currentBrakeBias,
    'debrief.history.setup.structuredInsufficient': copy.structuredInsufficient
  }
  addRecord(catalog, 'debrief.history.setup.symptom', SETUP_SYMPTOM_VALUES, copy.symptoms)
  addRecord(catalog, 'debrief.history.setup.area', SETUP_AREA_VALUES, copy.areas)
  addRecord(catalog, 'debrief.history.setup.direction', SETUP_DIRECTION_VALUES, copy.directions)
  addRecord(catalog, 'debrief.history.setup.magnitude', SETUP_MAGNITUDE_VALUES, copy.magnitudes)
  addRecord(catalog, 'debrief.history.setup.corner', SETUP_CORNER_VALUES, copy.corners)
  addRecord(catalog, 'debrief.history.setup.phase', SETUP_PHASE_VALUES, copy.phases)
  addRecord(catalog, 'debrief.history.setup.adjustment', SETUP_ADJUSTMENT_CODES, copy.adjustments)

  const rationales: Record<SetupSymptomKind, string> = {
    'understeer-entry': copy.rationale.understeer,
    'understeer-mid': copy.rationale.understeer,
    'understeer-exit': copy.rationale.understeer,
    'oversteer-entry': copy.rationale.oversteer,
    'oversteer-mid': copy.rationale.oversteer,
    'oversteer-exit': copy.rationale.oversteer,
    'tyre-overheat': copy.rationale.overheat,
    'tyre-cold': copy.rationale.cold,
    'tyre-temp-imbalance-lr': copy.rationale.imbalance,
    'camber-excess': copy.rationale.camberExcess,
    'camber-lack': copy.rationale.camberLack,
    'pressure-high': copy.rationale.pressureHigh,
    'pressure-low': copy.rationale.pressureLow,
    'brake-lock-front': copy.rationale.frontLock,
    'brake-lock-rear': copy.rationale.rearLock
  }
  const evidence: Record<SetupSymptomKind, string> = {
    'understeer-entry': copy.evidence.balance,
    'understeer-mid': copy.evidence.balance,
    'understeer-exit': copy.evidence.balance,
    'oversteer-entry': copy.evidence.balance,
    'oversteer-mid': copy.evidence.balance,
    'oversteer-exit': copy.evidence.balance,
    'tyre-overheat': copy.evidence.average,
    'tyre-cold': copy.evidence.average,
    'tyre-temp-imbalance-lr': copy.evidence.imbalance,
    'camber-excess': copy.evidence.camber,
    'camber-lack': copy.evidence.camber,
    'pressure-high': copy.evidence.pressure,
    'pressure-low': copy.evidence.pressure,
    'brake-lock-front': copy.evidence.frontLock,
    'brake-lock-rear': copy.evidence.rearLock
  }
  addRecord(catalog, 'debrief.history.setup.rationale', SETUP_SYMPTOM_VALUES, rationales)
  addRecord(catalog, 'debrief.history.setup.evidence', SETUP_SYMPTOM_VALUES, evidence)
  return catalog
}

const en = setupCatalog({
  symptoms: {
    'understeer-entry': 'Entry understeer',
    'understeer-mid': 'Mid-corner understeer',
    'understeer-exit': 'Exit understeer',
    'oversteer-entry': 'Entry oversteer',
    'oversteer-mid': 'Mid-corner oversteer',
    'oversteer-exit': 'Exit oversteer',
    'tyre-overheat': 'Tyre overheating',
    'tyre-cold': 'Cold tyre',
    'tyre-temp-imbalance-lr': 'Left/right tyre-temperature imbalance',
    'camber-excess': 'Excess negative camber',
    'camber-lack': 'Insufficient negative camber',
    'pressure-high': 'Tyre pressure too high',
    'pressure-low': 'Tyre pressure too low',
    'brake-lock-front': 'Front axle lock-up',
    'brake-lock-rear': 'Rear axle lock-up'
  },
  areas: {
    aero: 'Aerodynamics',
    arb: 'Anti-roll bars',
    springs: 'Springs',
    dampers: 'Dampers',
    differential: 'Differential',
    tyres: 'Tyres',
    brakes: 'Brakes',
    alignment: 'Alignment',
    'ride-height': 'Ride height / cross-weight'
  },
  directions: {
    increase: 'Increase',
    decrease: 'Decrease',
    soften: 'Soften',
    stiffen: 'Stiffen',
    forward: 'Move forward',
    rearward: 'Move rearward',
    adjust: 'Adjust'
  },
  magnitudes: { small: 'Small step', medium: 'Medium step', large: 'Large step' },
  corners: {
    lf: 'left-front tyre',
    rf: 'right-front tyre',
    lr: 'left-rear tyre',
    rr: 'right-rear tyre',
    front: 'front axle',
    rear: 'rear axle',
    left: 'left side',
    right: 'right side',
    all: 'all tyres'
  },
  phases: { entry: 'corner entry', mid: 'mid-corner', exit: 'corner exit' },
  adjustments: {
    'tyre-pressure-decrease-cold': 'Reduce {corner} cold pressure by {pressureStep}.',
    'tyre-pressure-decrease-repeat': 'Repeat in medium steps until the centre and edges converge.',
    'tyre-pressure-increase-cold': 'Increase {corner} cold pressure by {pressureStep}.',
    'tyre-pressure-increase-repeat': 'Repeat in medium steps until the centre and edges converge.',
    'camber-negative-decrease': 'Reduce negative camber on the {corner} by about 0.2–0.4°.',
    'tyre-pressure-increase-camber-fallback': 'If needed, raise {corner} pressure one small step and recheck the tread profile.',
    'camber-negative-increase': 'Increase negative camber on the {corner} by about 0.2–0.4°.',
    'tyre-pressure-decrease-overheat': 'Reduce {corner} cold pressure one small step, then recheck temperature.',
    'axle-aero-load-decrease': 'Reduce aerodynamic load on the affected axle one small step.',
    'tyre-pressure-increase-heat': 'Increase {corner} cold pressure one small step to build heat.',
    'axle-load-increase': 'Increase load transfer to the affected axle one small step.',
    'cross-weight-adjust': 'Adjust cross-weight or ride height one small step to balance the {corner}.',
    'axle-pressure-equalize': 'Equalize cold pressures across the {corner}, then validate hot pressures.',
    'front-arb-soften': 'Soften the front anti-roll bar one click.',
    'brake-bias-rearward': 'Move brake bias rearward by about 1%.',
    'front-springs-soften': 'Soften the front springs one small step.',
    'front-aero-increase': 'Increase front wing or splitter one point.',
    'rear-arb-stiffen': 'Stiffen the rear anti-roll bar one click.',
    'front-camber-increase': 'Add one small step of front negative camber.',
    'power-diff-lock-decrease': 'Reduce differential lock under power one small step.',
    'rear-arb-soften': 'Soften the rear anti-roll bar one click.',
    'rear-aero-decrease': 'Reduce rear wing one point.',
    'rear-aero-increase': 'Increase rear wing one point.',
    'brake-bias-forward': 'Move brake bias forward by about 1%.',
    'front-arb-stiffen': 'Stiffen the front anti-roll bar one click.',
    'brake-pressure-decrease': 'Reduce maximum brake pressure one small step.'
  },
  rationale: {
    understeer: 'The validated balance signal shows understeer during {phase}; a small support change can recover front grip.',
    oversteer: 'The validated balance signal shows oversteer during {phase}; a small support change can recover rear stability.',
    overheat: '{corner} is above its working temperature window; a small pressure or load change can reduce heat.',
    cold: '{corner} is below its working temperature window; a small pressure or load change can build heat.',
    imbalance: 'The {corner} has a repeatable left/right temperature split; check cross-weight and side-to-side pressures.',
    camberExcess: 'The inner edge of {corner} is much hotter than the outer edge, indicating excessive negative camber.',
    camberLack: 'The outer edge of {corner} is much hotter than the inner edge, indicating insufficient negative camber.',
    pressureHigh: 'The centre of {corner} is hotter than both edges, indicating excessive pressure and a reduced contact patch.',
    pressureLow: 'Both edges of {corner} are hotter than the centre, indicating low pressure and excess carcass flex.',
    frontLock: 'An explicit front-axle lock signal indicates too much front braking for this run.',
    rearLock: 'An explicit rear-axle lock signal indicates too much rear braking for this run.'
  },
  evidence: {
    balance: 'Validated {phase} balance signal: {bias}.',
    pressure: 'Centre {middle}; edge average {edges}; measured difference {delta}.',
    camber: 'Inner edge {inner}; outer edge {outer}; measured difference {delta}.',
    average: 'Measured average tyre temperature: {average}.',
    imbalance: '{corner}: left {left}; right {right}; measured difference {delta}.',
    frontLock: 'Explicit front-axle lock signal recorded. {biasDetail}',
    rearLock: 'Explicit rear-axle lock signal recorded. {biasDetail}'
  },
  adjustmentDetails: '{area} · {direction} · {magnitude} · {context}',
  currentBrakeBias: 'Current front brake bias: {bias}.',
  structuredInsufficient: 'This archived suggestion lacks the structured code or measured metrics required for truthful localization. No persisted prose is shown. Capture clean laps with tyre temperatures, pressures, wear, or validated handling signals.'
})

const pt = setupCatalog({
  symptoms: {
    'understeer-entry': 'Subesterço na entrada',
    'understeer-mid': 'Subesterço no meio da curva',
    'understeer-exit': 'Subesterço na saída',
    'oversteer-entry': 'Sobresterço na entrada',
    'oversteer-mid': 'Sobresterço no meio da curva',
    'oversteer-exit': 'Sobresterço na saída',
    'tyre-overheat': 'Superaquecimento do pneu',
    'tyre-cold': 'Pneu frio',
    'tyre-temp-imbalance-lr': 'Desequilíbrio térmico esquerda/direita',
    'camber-excess': 'Cambagem negativa excessiva',
    'camber-lack': 'Cambagem negativa insuficiente',
    'pressure-high': 'Pressão do pneu alta',
    'pressure-low': 'Pressão do pneu baixa',
    'brake-lock-front': 'Travamento do eixo dianteiro',
    'brake-lock-rear': 'Travamento do eixo traseiro'
  },
  areas: {
    aero: 'Aerodinâmica',
    arb: 'Barras estabilizadoras',
    springs: 'Molas',
    dampers: 'Amortecedores',
    differential: 'Diferencial',
    tyres: 'Pneus',
    brakes: 'Freios',
    alignment: 'Alinhamento',
    'ride-height': 'Altura / peso cruzado'
  },
  directions: {
    increase: 'Aumentar',
    decrease: 'Reduzir',
    soften: 'Amaciar',
    stiffen: 'Endurecer',
    forward: 'Mover para frente',
    rearward: 'Mover para trás',
    adjust: 'Ajustar'
  },
  magnitudes: { small: 'Passo pequeno', medium: 'Passo médio', large: 'Passo grande' },
  corners: {
    lf: 'pneu dianteiro esquerdo',
    rf: 'pneu dianteiro direito',
    lr: 'pneu traseiro esquerdo',
    rr: 'pneu traseiro direito',
    front: 'eixo dianteiro',
    rear: 'eixo traseiro',
    left: 'lado esquerdo',
    right: 'lado direito',
    all: 'todos os pneus'
  },
  phases: { entry: 'entrada da curva', mid: 'meio da curva', exit: 'saída da curva' },
  adjustments: {
    'tyre-pressure-decrease-cold': 'Reduza a pressão a frio do {corner} em {pressureStep}.',
    'tyre-pressure-decrease-repeat': 'Repita em passos médios até o centro e as bordas convergirem.',
    'tyre-pressure-increase-cold': 'Aumente a pressão a frio do {corner} em {pressureStep}.',
    'tyre-pressure-increase-repeat': 'Repita em passos médios até o centro e as bordas convergirem.',
    'camber-negative-decrease': 'Reduza a cambagem negativa do {corner} em cerca de 0,2–0,4°.',
    'tyre-pressure-increase-camber-fallback': 'Se necessário, aumente a pressão do {corner} um passo pequeno e confira o perfil.',
    'camber-negative-increase': 'Aumente a cambagem negativa do {corner} em cerca de 0,2–0,4°.',
    'tyre-pressure-decrease-overheat': 'Reduza a pressão a frio do {corner} um passo pequeno e confira a temperatura.',
    'axle-aero-load-decrease': 'Reduza a carga aerodinâmica no eixo afetado um passo pequeno.',
    'tyre-pressure-increase-heat': 'Aumente a pressão a frio do {corner} um passo pequeno para gerar calor.',
    'axle-load-increase': 'Aumente a transferência de carga para o eixo afetado um passo pequeno.',
    'cross-weight-adjust': 'Ajuste o peso cruzado ou a altura um passo pequeno para equilibrar o {corner}.',
    'axle-pressure-equalize': 'Iguale as pressões a frio no {corner} e valide as pressões quentes.',
    'front-arb-soften': 'Amacie a barra estabilizadora dianteira em um clique.',
    'brake-bias-rearward': 'Mova o balanço de freio cerca de 1% para trás.',
    'front-springs-soften': 'Amacie as molas dianteiras um passo pequeno.',
    'front-aero-increase': 'Aumente a asa dianteira ou o splitter em um ponto.',
    'rear-arb-stiffen': 'Endureça a barra estabilizadora traseira em um clique.',
    'front-camber-increase': 'Adicione um passo pequeno de cambagem negativa dianteira.',
    'power-diff-lock-decrease': 'Reduza o bloqueio do diferencial em aceleração um passo pequeno.',
    'rear-arb-soften': 'Amacie a barra estabilizadora traseira em um clique.',
    'rear-aero-decrease': 'Reduza a asa traseira em um ponto.',
    'rear-aero-increase': 'Aumente a asa traseira em um ponto.',
    'brake-bias-forward': 'Mova o balanço de freio cerca de 1% para frente.',
    'front-arb-stiffen': 'Endureça a barra estabilizadora dianteira em um clique.',
    'brake-pressure-decrease': 'Reduza a pressão máxima de freio um passo pequeno.'
  },
  rationale: {
    understeer: 'O sinal de equilíbrio validado mostra subesterço na {phase}; uma pequena mudança de apoio pode recuperar aderência dianteira.',
    oversteer: 'O sinal de equilíbrio validado mostra sobresterço na {phase}; uma pequena mudança de apoio pode recuperar estabilidade traseira.',
    overheat: 'O {corner} está acima da janela de trabalho; uma pequena mudança de pressão ou carga pode reduzir o calor.',
    cold: 'O {corner} está abaixo da janela de trabalho; uma pequena mudança de pressão ou carga pode gerar calor.',
    imbalance: 'O {corner} apresenta diferença térmica repetível entre esquerda e direita; confira peso cruzado e pressões laterais.',
    camberExcess: 'A borda interna do {corner} está muito mais quente que a externa, indicando cambagem negativa excessiva.',
    camberLack: 'A borda externa do {corner} está muito mais quente que a interna, indicando cambagem negativa insuficiente.',
    pressureHigh: 'O centro do {corner} está mais quente que as bordas, indicando pressão excessiva e menor área de contato.',
    pressureLow: 'As bordas do {corner} estão mais quentes que o centro, indicando pressão baixa e flexão excessiva.',
    frontLock: 'Um sinal explícito de travamento dianteiro indica freio demais no eixo dianteiro nesta volta.',
    rearLock: 'Um sinal explícito de travamento traseiro indica freio demais no eixo traseiro nesta volta.'
  },
  evidence: {
    balance: 'Sinal de equilíbrio validado na {phase}: {bias}.',
    pressure: 'Centro {middle}; média das bordas {edges}; diferença medida {delta}.',
    camber: 'Borda interna {inner}; borda externa {outer}; diferença medida {delta}.',
    average: 'Temperatura média medida do pneu: {average}.',
    imbalance: '{corner}: esquerda {left}; direita {right}; diferença medida {delta}.',
    frontLock: 'Sinal explícito de travamento dianteiro registrado. {biasDetail}',
    rearLock: 'Sinal explícito de travamento traseiro registrado. {biasDetail}'
  },
  adjustmentDetails: '{area} · {direction} · {magnitude} · {context}',
  currentBrakeBias: 'Balanço atual de freio dianteiro: {bias}.',
  structuredInsufficient: 'Esta sugestão arquivada não contém o código estruturado ou as métricas necessárias para uma tradução fiel. O texto persistido não é exibido. Faça voltas limpas com temperaturas, pressões, desgaste dos pneus ou sinais de comportamento validados.'
})

const es = setupCatalog({
  symptoms: {
    'understeer-entry': 'Subviraje en entrada',
    'understeer-mid': 'Subviraje en mitad de curva',
    'understeer-exit': 'Subviraje en salida',
    'oversteer-entry': 'Sobreviraje en entrada',
    'oversteer-mid': 'Sobreviraje en mitad de curva',
    'oversteer-exit': 'Sobreviraje en salida',
    'tyre-overheat': 'Neumático sobrecalentado',
    'tyre-cold': 'Neumático frío',
    'tyre-temp-imbalance-lr': 'Desequilibrio térmico izquierda/derecha',
    'camber-excess': 'Caída negativa excesiva',
    'camber-lack': 'Caída negativa insuficiente',
    'pressure-high': 'Presión del neumático alta',
    'pressure-low': 'Presión del neumático baja',
    'brake-lock-front': 'Bloqueo del eje delantero',
    'brake-lock-rear': 'Bloqueo del eje trasero'
  },
  areas: {
    aero: 'Aerodinámica',
    arb: 'Barras estabilizadoras',
    springs: 'Muelles',
    dampers: 'Amortiguadores',
    differential: 'Diferencial',
    tyres: 'Neumáticos',
    brakes: 'Frenos',
    alignment: 'Alineación',
    'ride-height': 'Altura / peso cruzado'
  },
  directions: {
    increase: 'Aumentar',
    decrease: 'Reducir',
    soften: 'Ablandar',
    stiffen: 'Endurecer',
    forward: 'Mover hacia delante',
    rearward: 'Mover hacia atrás',
    adjust: 'Ajustar'
  },
  magnitudes: { small: 'Paso pequeño', medium: 'Paso medio', large: 'Paso grande' },
  corners: {
    lf: 'neumático delantero izquierdo',
    rf: 'neumático delantero derecho',
    lr: 'neumático trasero izquierdo',
    rr: 'neumático trasero derecho',
    front: 'eje delantero',
    rear: 'eje trasero',
    left: 'lado izquierdo',
    right: 'lado derecho',
    all: 'todos los neumáticos'
  },
  phases: { entry: 'entrada de curva', mid: 'mitad de curva', exit: 'salida de curva' },
  adjustments: {
    'tyre-pressure-decrease-cold': 'Reduce la presión en frío del {corner} en {pressureStep}.',
    'tyre-pressure-decrease-repeat': 'Repite en pasos medios hasta que centro y bordes converjan.',
    'tyre-pressure-increase-cold': 'Aumenta la presión en frío del {corner} en {pressureStep}.',
    'tyre-pressure-increase-repeat': 'Repite en pasos medios hasta que centro y bordes converjan.',
    'camber-negative-decrease': 'Reduce la caída negativa del {corner} unos 0,2–0,4°.',
    'tyre-pressure-increase-camber-fallback': 'Si hace falta, aumenta un paso la presión del {corner} y revisa el perfil.',
    'camber-negative-increase': 'Aumenta la caída negativa del {corner} unos 0,2–0,4°.',
    'tyre-pressure-decrease-overheat': 'Reduce un paso la presión en frío del {corner} y revisa la temperatura.',
    'axle-aero-load-decrease': 'Reduce un paso la carga aerodinámica del eje afectado.',
    'tyre-pressure-increase-heat': 'Aumenta un paso la presión en frío del {corner} para generar calor.',
    'axle-load-increase': 'Aumenta un paso la transferencia de carga al eje afectado.',
    'cross-weight-adjust': 'Ajusta un paso el peso cruzado o la altura para equilibrar el {corner}.',
    'axle-pressure-equalize': 'Iguala las presiones en frío del {corner} y valida las presiones calientes.',
    'front-arb-soften': 'Ablanda un clic la barra estabilizadora delantera.',
    'brake-bias-rearward': 'Mueve el reparto de frenada cerca de un 1% hacia atrás.',
    'front-springs-soften': 'Ablanda un paso los muelles delanteros.',
    'front-aero-increase': 'Aumenta un punto el ala delantera o splitter.',
    'rear-arb-stiffen': 'Endurece un clic la barra estabilizadora trasera.',
    'front-camber-increase': 'Añade un paso de caída negativa delantera.',
    'power-diff-lock-decrease': 'Reduce un paso el bloqueo del diferencial en aceleración.',
    'rear-arb-soften': 'Ablanda un clic la barra estabilizadora trasera.',
    'rear-aero-decrease': 'Reduce un punto el ala trasera.',
    'rear-aero-increase': 'Aumenta un punto el ala trasera.',
    'brake-bias-forward': 'Mueve el reparto de frenada cerca de un 1% hacia delante.',
    'front-arb-stiffen': 'Endurece un clic la barra estabilizadora delantera.',
    'brake-pressure-decrease': 'Reduce un paso la presión máxima de frenado.'
  },
  rationale: {
    understeer: 'La señal de equilibrio validada muestra subviraje en {phase}; un cambio pequeño puede recuperar agarre delantero.',
    oversteer: 'La señal de equilibrio validada muestra sobreviraje en {phase}; un cambio pequeño puede recuperar estabilidad trasera.',
    overheat: 'El {corner} supera su ventana de trabajo; un pequeño cambio de presión o carga puede reducir la temperatura.',
    cold: 'El {corner} está por debajo de su ventana de trabajo; un pequeño cambio de presión o carga puede generar calor.',
    imbalance: 'El {corner} presenta una diferencia térmica repetible entre izquierda y derecha; revisa peso cruzado y presiones.',
    camberExcess: 'El borde interior del {corner} está mucho más caliente que el exterior, señal de caída negativa excesiva.',
    camberLack: 'El borde exterior del {corner} está mucho más caliente que el interior, señal de caída negativa insuficiente.',
    pressureHigh: 'El centro del {corner} está más caliente que los bordes, señal de presión excesiva y menor huella.',
    pressureLow: 'Los bordes del {corner} están más calientes que el centro, señal de presión baja y flexión excesiva.',
    frontLock: 'Una señal explícita de bloqueo delantero indica exceso de frenada delantera en esta tanda.',
    rearLock: 'Una señal explícita de bloqueo trasero indica exceso de frenada trasera en esta tanda.'
  },
  evidence: {
    balance: 'Señal de equilibrio validada en {phase}: {bias}.',
    pressure: 'Centro {middle}; media de bordes {edges}; diferencia medida {delta}.',
    camber: 'Borde interior {inner}; borde exterior {outer}; diferencia medida {delta}.',
    average: 'Temperatura media medida del neumático: {average}.',
    imbalance: '{corner}: izquierda {left}; derecha {right}; diferencia medida {delta}.',
    frontLock: 'Se registró una señal explícita de bloqueo delantero. {biasDetail}',
    rearLock: 'Se registró una señal explícita de bloqueo trasero. {biasDetail}'
  },
  adjustmentDetails: '{area} · {direction} · {magnitude} · {context}',
  currentBrakeBias: 'Reparto delantero actual: {bias}.',
  structuredInsufficient: 'Esta sugerencia archivada no contiene el código estructurado o las métricas necesarias para localizarla con fidelidad. No se muestra el texto persistido. Completa vueltas limpias con temperaturas, presiones, desgaste o señales de comportamiento validadas.'
})

const fr = setupCatalog({
  symptoms: {
    'understeer-entry': 'Sous-virage à l’entrée',
    'understeer-mid': 'Sous-virage à mi-virage',
    'understeer-exit': 'Sous-virage à la sortie',
    'oversteer-entry': 'Survirage à l’entrée',
    'oversteer-mid': 'Survirage à mi-virage',
    'oversteer-exit': 'Survirage à la sortie',
    'tyre-overheat': 'Surchauffe du pneu',
    'tyre-cold': 'Pneu froid',
    'tyre-temp-imbalance-lr': 'Déséquilibre thermique gauche/droite',
    'camber-excess': 'Carrossage négatif excessif',
    'camber-lack': 'Carrossage négatif insuffisant',
    'pressure-high': 'Pression du pneu trop élevée',
    'pressure-low': 'Pression du pneu trop basse',
    'brake-lock-front': 'Blocage de l’essieu avant',
    'brake-lock-rear': 'Blocage de l’essieu arrière'
  },
  areas: {
    aero: 'Aérodynamique',
    arb: 'Barres antiroulis',
    springs: 'Ressorts',
    dampers: 'Amortisseurs',
    differential: 'Différentiel',
    tyres: 'Pneus',
    brakes: 'Freins',
    alignment: 'Géométrie',
    'ride-height': 'Hauteur / poids croisé'
  },
  directions: {
    increase: 'Augmenter',
    decrease: 'Réduire',
    soften: 'Assouplir',
    stiffen: 'Raidir',
    forward: 'Déplacer vers l’avant',
    rearward: 'Déplacer vers l’arrière',
    adjust: 'Ajuster'
  },
  magnitudes: { small: 'Petit pas', medium: 'Pas moyen', large: 'Grand pas' },
  corners: {
    lf: 'pneu avant gauche',
    rf: 'pneu avant droit',
    lr: 'pneu arrière gauche',
    rr: 'pneu arrière droit',
    front: 'essieu avant',
    rear: 'essieu arrière',
    left: 'côté gauche',
    right: 'côté droit',
    all: 'tous les pneus'
  },
  phases: { entry: 'entrée du virage', mid: 'milieu du virage', exit: 'sortie du virage' },
  adjustments: {
    'tyre-pressure-decrease-cold': 'Réduisez la pression à froid du {corner} de {pressureStep}.',
    'tyre-pressure-decrease-repeat': 'Répétez par pas moyens jusqu’à convergence du centre et des bords.',
    'tyre-pressure-increase-cold': 'Augmentez la pression à froid du {corner} de {pressureStep}.',
    'tyre-pressure-increase-repeat': 'Répétez par pas moyens jusqu’à convergence du centre et des bords.',
    'camber-negative-decrease': 'Réduisez le carrossage négatif du {corner} d’environ 0,2–0,4°.',
    'tyre-pressure-increase-camber-fallback': 'Si nécessaire, augmentez légèrement la pression du {corner} et revérifiez le profil.',
    'camber-negative-increase': 'Augmentez le carrossage négatif du {corner} d’environ 0,2–0,4°.',
    'tyre-pressure-decrease-overheat': 'Réduisez légèrement la pression à froid du {corner}, puis revérifiez la température.',
    'axle-aero-load-decrease': 'Réduisez légèrement l’appui aérodynamique sur l’essieu concerné.',
    'tyre-pressure-increase-heat': 'Augmentez légèrement la pression à froid du {corner} pour produire de la chaleur.',
    'axle-load-increase': 'Augmentez légèrement le transfert de charge vers l’essieu concerné.',
    'cross-weight-adjust': 'Ajustez légèrement le poids croisé ou la hauteur pour équilibrer l’{corner}.',
    'axle-pressure-equalize': 'Égalisez les pressions à froid sur l’{corner}, puis validez à chaud.',
    'front-arb-soften': 'Assouplissez la barre antiroulis avant d’un cran.',
    'brake-bias-rearward': 'Déplacez la répartition de freinage d’environ 1 % vers l’arrière.',
    'front-springs-soften': 'Assouplissez légèrement les ressorts avant.',
    'front-aero-increase': 'Augmentez l’aileron avant ou le splitter d’un point.',
    'rear-arb-stiffen': 'Raidissez la barre antiroulis arrière d’un cran.',
    'front-camber-increase': 'Ajoutez un petit pas de carrossage négatif à l’avant.',
    'power-diff-lock-decrease': 'Réduisez légèrement le blocage du différentiel à l’accélération.',
    'rear-arb-soften': 'Assouplissez la barre antiroulis arrière d’un cran.',
    'rear-aero-decrease': 'Réduisez l’aileron arrière d’un point.',
    'rear-aero-increase': 'Augmentez l’aileron arrière d’un point.',
    'brake-bias-forward': 'Déplacez la répartition de freinage d’environ 1 % vers l’avant.',
    'front-arb-stiffen': 'Raidissez la barre antiroulis avant d’un cran.',
    'brake-pressure-decrease': 'Réduisez légèrement la pression maximale de freinage.'
  },
  rationale: {
    understeer: 'Le signal d’équilibre validé montre du sous-virage en {phase} ; un petit changement peut restaurer l’adhérence avant.',
    oversteer: 'Le signal d’équilibre validé montre du survirage en {phase} ; un petit changement peut restaurer la stabilité arrière.',
    overheat: 'Le {corner} dépasse sa fenêtre de fonctionnement ; un petit changement de pression ou de charge peut réduire la chaleur.',
    cold: 'Le {corner} est sous sa fenêtre de fonctionnement ; un petit changement de pression ou de charge peut produire de la chaleur.',
    imbalance: 'L’{corner} présente un écart thermique gauche/droite répétable ; vérifiez le poids croisé et les pressions.',
    camberExcess: 'Le bord intérieur du {corner} est beaucoup plus chaud que l’extérieur, signe d’un carrossage négatif excessif.',
    camberLack: 'Le bord extérieur du {corner} est beaucoup plus chaud que l’intérieur, signe d’un carrossage négatif insuffisant.',
    pressureHigh: 'Le centre du {corner} est plus chaud que les bords, signe d’une pression excessive et d’une empreinte réduite.',
    pressureLow: 'Les bords du {corner} sont plus chauds que le centre, signe d’une pression basse et d’une flexion excessive.',
    frontLock: 'Un signal explicite de blocage avant indique trop de freinage sur l’essieu avant.',
    rearLock: 'Un signal explicite de blocage arrière indique trop de freinage sur l’essieu arrière.'
  },
  evidence: {
    balance: 'Signal d’équilibre validé en {phase} : {bias}.',
    pressure: 'Centre {middle} ; moyenne des bords {edges} ; écart mesuré {delta}.',
    camber: 'Bord intérieur {inner} ; bord extérieur {outer} ; écart mesuré {delta}.',
    average: 'Température moyenne mesurée du pneu : {average}.',
    imbalance: '{corner} : gauche {left} ; droite {right} ; écart mesuré {delta}.',
    frontLock: 'Signal explicite de blocage avant enregistré. {biasDetail}',
    rearLock: 'Signal explicite de blocage arrière enregistré. {biasDetail}'
  },
  adjustmentDetails: '{area} · {direction} · {magnitude} · {context}',
  currentBrakeBias: 'Répartition avant actuelle : {bias}.',
  structuredInsufficient: 'Cette suggestion archivée ne contient pas le code structuré ou les mesures nécessaires à une localisation fidèle. Le texte persistant n’est pas affiché. Effectuez des tours propres avec températures, pressions, usure ou signaux de comportement validés.'
})

const de = setupCatalog({
  symptoms: {
    'understeer-entry': 'Untersteuern am Kurveneingang',
    'understeer-mid': 'Untersteuern in der Kurvenmitte',
    'understeer-exit': 'Untersteuern am Kurvenausgang',
    'oversteer-entry': 'Übersteuern am Kurveneingang',
    'oversteer-mid': 'Übersteuern in der Kurvenmitte',
    'oversteer-exit': 'Übersteuern am Kurvenausgang',
    'tyre-overheat': 'Reifenüberhitzung',
    'tyre-cold': 'Kalter Reifen',
    'tyre-temp-imbalance-lr': 'Reifen-Temperaturunterschied links/rechts',
    'camber-excess': 'Zu viel negativer Sturz',
    'camber-lack': 'Zu wenig negativer Sturz',
    'pressure-high': 'Reifendruck zu hoch',
    'pressure-low': 'Reifendruck zu niedrig',
    'brake-lock-front': 'Blockieren der Vorderachse',
    'brake-lock-rear': 'Blockieren der Hinterachse'
  },
  areas: {
    aero: 'Aerodynamik',
    arb: 'Stabilisatoren',
    springs: 'Federn',
    dampers: 'Dämpfer',
    differential: 'Differenzial',
    tyres: 'Reifen',
    brakes: 'Bremsen',
    alignment: 'Achsgeometrie',
    'ride-height': 'Fahrhöhe / Kreuzgewicht'
  },
  directions: {
    increase: 'Erhöhen',
    decrease: 'Verringern',
    soften: 'Weicher',
    stiffen: 'Härter',
    forward: 'Nach vorn',
    rearward: 'Nach hinten',
    adjust: 'Anpassen'
  },
  magnitudes: { small: 'Kleiner Schritt', medium: 'Mittlerer Schritt', large: 'Großer Schritt' },
  corners: {
    lf: 'linker Vorderreifen',
    rf: 'rechter Vorderreifen',
    lr: 'linker Hinterreifen',
    rr: 'rechter Hinterreifen',
    front: 'Vorderachse',
    rear: 'Hinterachse',
    left: 'linke Seite',
    right: 'rechte Seite',
    all: 'alle Reifen'
  },
  phases: { entry: 'Kurveneingang', mid: 'Kurvenmitte', exit: 'Kurvenausgang' },
  adjustments: {
    'tyre-pressure-decrease-cold': 'Kaltluftdruck für {corner} um {pressureStep} senken.',
    'tyre-pressure-decrease-repeat': 'In mittleren Schritten wiederholen, bis Mitte und Kanten übereinstimmen.',
    'tyre-pressure-increase-cold': 'Kaltluftdruck für {corner} um {pressureStep} erhöhen.',
    'tyre-pressure-increase-repeat': 'In mittleren Schritten wiederholen, bis Mitte und Kanten übereinstimmen.',
    'camber-negative-decrease': 'Negativen Sturz für {corner} um etwa 0,2–0,4° verringern.',
    'tyre-pressure-increase-camber-fallback': 'Falls nötig, Druck für {corner} leicht erhöhen und das Profil erneut prüfen.',
    'camber-negative-increase': 'Negativen Sturz für {corner} um etwa 0,2–0,4° erhöhen.',
    'tyre-pressure-decrease-overheat': 'Kaltluftdruck für {corner} leicht senken und Temperatur erneut prüfen.',
    'axle-aero-load-decrease': 'Aerodynamische Last an der betroffenen Achse leicht verringern.',
    'tyre-pressure-increase-heat': 'Kaltluftdruck für {corner} leicht erhöhen, um Wärme aufzubauen.',
    'axle-load-increase': 'Lastübertragung zur betroffenen Achse leicht erhöhen.',
    'cross-weight-adjust': 'Kreuzgewicht oder Fahrhöhe leicht anpassen, um die {corner} auszugleichen.',
    'axle-pressure-equalize': 'Kaltdrücke an der {corner} angleichen und Heißdrücke validieren.',
    'front-arb-soften': 'Vorderen Stabilisator um einen Klick weicher stellen.',
    'brake-bias-rearward': 'Bremsbalance um etwa 1 % nach hinten verschieben.',
    'front-springs-soften': 'Vordere Federn einen kleinen Schritt weicher stellen.',
    'front-aero-increase': 'Frontflügel oder Splitter um einen Punkt erhöhen.',
    'rear-arb-stiffen': 'Hinteren Stabilisator um einen Klick härter stellen.',
    'front-camber-increase': 'Vorn einen kleinen Schritt mehr negativen Sturz einstellen.',
    'power-diff-lock-decrease': 'Differenzialsperre unter Last leicht verringern.',
    'rear-arb-soften': 'Hinteren Stabilisator um einen Klick weicher stellen.',
    'rear-aero-decrease': 'Heckflügel um einen Punkt verringern.',
    'rear-aero-increase': 'Heckflügel um einen Punkt erhöhen.',
    'brake-bias-forward': 'Bremsbalance um etwa 1 % nach vorn verschieben.',
    'front-arb-stiffen': 'Vorderen Stabilisator um einen Klick härter stellen.',
    'brake-pressure-decrease': 'Maximalen Bremsdruck einen kleinen Schritt verringern.'
  },
  rationale: {
    understeer: 'Das validierte Balance-Signal zeigt Untersteuern am {phase}; eine kleine Änderung kann Vorderachsgrip zurückbringen.',
    oversteer: 'Das validierte Balance-Signal zeigt Übersteuern am {phase}; eine kleine Änderung kann Hinterachsstabilität zurückbringen.',
    overheat: 'Die Messung für {corner} liegt über dem Arbeitsfenster; eine kleine Druck- oder Laständerung kann Hitze reduzieren.',
    cold: 'Die Messung für {corner} liegt unter dem Arbeitsfenster; eine kleine Druck- oder Laständerung kann Wärme aufbauen.',
    imbalance: 'Die {corner} zeigt einen wiederholbaren Temperaturunterschied links/rechts; Kreuzgewicht und Drücke prüfen.',
    camberExcess: 'Bei {corner} ist die Innenkante deutlich heißer als außen, ein Hinweis auf zu viel negativen Sturz.',
    camberLack: 'Bei {corner} ist die Außenkante deutlich heißer als innen, ein Hinweis auf zu wenig negativen Sturz.',
    pressureHigh: 'Bei {corner} ist die Mitte heißer als die Kanten, ein Hinweis auf zu hohen Druck und kleinere Aufstandsfläche.',
    pressureLow: 'Bei {corner} sind die Kanten heißer als die Mitte, ein Hinweis auf zu niedrigen Druck und starke Walkarbeit.',
    frontLock: 'Ein explizites Vorderachs-Blockiersignal zeigt zu viel Bremswirkung vorn.',
    rearLock: 'Ein explizites Hinterachs-Blockiersignal zeigt zu viel Bremswirkung hinten.'
  },
  evidence: {
    balance: 'Validiertes Balance-Signal am {phase}: {bias}.',
    pressure: 'Mitte {middle}; Kantendurchschnitt {edges}; gemessene Differenz {delta}.',
    camber: 'Innenkante {inner}; Außenkante {outer}; gemessene Differenz {delta}.',
    average: 'Gemessene mittlere Reifentemperatur: {average}.',
    imbalance: '{corner}: links {left}; rechts {right}; gemessene Differenz {delta}.',
    frontLock: 'Explizites Vorderachs-Blockiersignal aufgezeichnet. {biasDetail}',
    rearLock: 'Explizites Hinterachs-Blockiersignal aufgezeichnet. {biasDetail}'
  },
  adjustmentDetails: '{area} · {direction} · {magnitude} · {context}',
  currentBrakeBias: 'Aktuelle Bremsbalance vorn: {bias}.',
  structuredInsufficient: 'Dieser archivierten Empfehlung fehlen der strukturierte Code oder die Messwerte für eine verlässliche Übersetzung. Gespeicherter Freitext wird nicht angezeigt. Fahre saubere Runden mit Reifentemperaturen, Drücken, Verschleiß oder validierten Fahrverhaltenssignalen.'
})

const zh = setupCatalog({
  symptoms: {
    'understeer-entry': '入弯转向不足',
    'understeer-mid': '弯中转向不足',
    'understeer-exit': '出弯转向不足',
    'oversteer-entry': '入弯转向过度',
    'oversteer-mid': '弯中转向过度',
    'oversteer-exit': '出弯转向过度',
    'tyre-overheat': '轮胎过热',
    'tyre-cold': '轮胎温度过低',
    'tyre-temp-imbalance-lr': '左右轮胎温差',
    'camber-excess': '负外倾角过大',
    'camber-lack': '负外倾角不足',
    'pressure-high': '胎压过高',
    'pressure-low': '胎压过低',
    'brake-lock-front': '前轴抱死',
    'brake-lock-rear': '后轴抱死'
  },
  areas: {
    aero: '空气动力学',
    arb: '防倾杆',
    springs: '弹簧',
    dampers: '减振器',
    differential: '差速器',
    tyres: '轮胎',
    brakes: '制动',
    alignment: '车轮定位',
    'ride-height': '车高 / 交叉配重'
  },
  directions: {
    increase: '增加',
    decrease: '减少',
    soften: '调软',
    stiffen: '调硬',
    forward: '向前移动',
    rearward: '向后移动',
    adjust: '调整'
  },
  magnitudes: { small: '小幅', medium: '中幅', large: '大幅' },
  corners: {
    lf: '左前轮胎',
    rf: '右前轮胎',
    lr: '左后轮胎',
    rr: '右后轮胎',
    front: '前轴',
    rear: '后轴',
    left: '左侧',
    right: '右侧',
    all: '全部轮胎'
  },
  phases: { entry: '入弯', mid: '弯中', exit: '出弯' },
  adjustments: {
    'tyre-pressure-decrease-cold': '将{corner}冷胎压降低 {pressureStep}。',
    'tyre-pressure-decrease-repeat': '以中等步幅重复，直至胎面中心与边缘温度接近。',
    'tyre-pressure-increase-cold': '将{corner}冷胎压提高 {pressureStep}。',
    'tyre-pressure-increase-repeat': '以中等步幅重复，直至胎面中心与边缘温度接近。',
    'camber-negative-decrease': '将{corner}负外倾角减小约 0.2–0.4°。',
    'tyre-pressure-increase-camber-fallback': '如有需要，小幅提高{corner}胎压并重新检查胎面温度。',
    'camber-negative-increase': '将{corner}负外倾角增加约 0.2–0.4°。',
    'tyre-pressure-decrease-overheat': '小幅降低{corner}冷胎压，然后重新检查温度。',
    'axle-aero-load-decrease': '小幅降低受影响车轴的空气动力负载。',
    'tyre-pressure-increase-heat': '小幅提高{corner}冷胎压以增加温度。',
    'axle-load-increase': '小幅增加向受影响车轴的载荷转移。',
    'cross-weight-adjust': '小幅调整交叉配重或车高，使{corner}更平衡。',
    'axle-pressure-equalize': '统一{corner}两侧冷胎压，并验证热胎压。',
    'front-arb-soften': '将前防倾杆调软一档。',
    'brake-bias-rearward': '将制动力分配向后移动约 1%。',
    'front-springs-soften': '将前弹簧小幅调软。',
    'front-aero-increase': '将前翼或分流器增加一档。',
    'rear-arb-stiffen': '将后防倾杆调硬一档。',
    'front-camber-increase': '小幅增加前轮负外倾角。',
    'power-diff-lock-decrease': '小幅降低加速时的差速器锁止率。',
    'rear-arb-soften': '将后防倾杆调软一档。',
    'rear-aero-decrease': '将后翼降低一档。',
    'rear-aero-increase': '将后翼增加一档。',
    'brake-bias-forward': '将制动力分配向前移动约 1%。',
    'front-arb-stiffen': '将前防倾杆调硬一档。',
    'brake-pressure-decrease': '小幅降低最大制动压力。'
  },
  rationale: {
    understeer: '已验证的平衡信号显示在{phase}出现转向不足；小幅支撑调整可恢复前轴抓地力。',
    oversteer: '已验证的平衡信号显示在{phase}出现转向过度；小幅支撑调整可恢复后轴稳定性。',
    overheat: '{corner}高于工作温度窗口；小幅调整胎压或载荷可降低温度。',
    cold: '{corner}低于工作温度窗口；小幅调整胎压或载荷可增加温度。',
    imbalance: '{corner}存在可重复的左右温差；请检查交叉配重和左右胎压。',
    camberExcess: '{corner}内侧明显高于外侧，表明负外倾角过大。',
    camberLack: '{corner}外侧明显高于内侧，表明负外倾角不足。',
    pressureHigh: '{corner}胎面中心高于两侧，表明胎压过高且接地面积减小。',
    pressureLow: '{corner}胎面两侧高于中心，表明胎压过低且胎体形变过大。',
    frontLock: '明确的前轴抱死信号表明本次运行前轴制动力过大。',
    rearLock: '明确的后轴抱死信号表明本次运行后轴制动力过大。'
  },
  evidence: {
    balance: '已验证的{phase}平衡信号：{bias}。',
    pressure: '中心 {middle}；边缘平均 {edges}；实测差值 {delta}。',
    camber: '内侧 {inner}；外侧 {outer}；实测差值 {delta}。',
    average: '实测轮胎平均温度：{average}。',
    imbalance: '{corner}：左侧 {left}；右侧 {right}；实测差值 {delta}。',
    frontLock: '已记录明确的前轴抱死信号。{biasDetail}',
    rearLock: '已记录明确的后轴抱死信号。{biasDetail}'
  },
  adjustmentDetails: '{area} · {direction} · {magnitude} · {context}',
  currentBrakeBias: '当前前轴制动力分配：{bias}。',
  structuredInsufficient: '此存档建议缺少可靠本地化所需的结构化代码或实测指标。不会显示存档中的自由文本。请完成包含轮胎温度、压力、磨损或已验证操控信号的干净圈。'
})

const ja = setupCatalog({
  symptoms: {
    'understeer-entry': '進入時のアンダーステア',
    'understeer-mid': 'コーナー中盤のアンダーステア',
    'understeer-exit': '脱出時のアンダーステア',
    'oversteer-entry': '進入時のオーバーステア',
    'oversteer-mid': 'コーナー中盤のオーバーステア',
    'oversteer-exit': '脱出時のオーバーステア',
    'tyre-overheat': 'タイヤの過熱',
    'tyre-cold': 'タイヤ温度不足',
    'tyre-temp-imbalance-lr': '左右タイヤ温度差',
    'camber-excess': 'ネガティブキャンバー過多',
    'camber-lack': 'ネガティブキャンバー不足',
    'pressure-high': 'タイヤ空気圧が高い',
    'pressure-low': 'タイヤ空気圧が低い',
    'brake-lock-front': 'フロント車軸のロック',
    'brake-lock-rear': 'リア車軸のロック'
  },
  areas: {
    aero: '空力',
    arb: 'アンチロールバー',
    springs: 'スプリング',
    dampers: 'ダンパー',
    differential: 'デファレンシャル',
    tyres: 'タイヤ',
    brakes: 'ブレーキ',
    alignment: 'アライメント',
    'ride-height': '車高 / クロスウェイト'
  },
  directions: {
    increase: '増やす',
    decrease: '減らす',
    soften: '柔らかくする',
    stiffen: '硬くする',
    forward: '前方へ移動',
    rearward: '後方へ移動',
    adjust: '調整'
  },
  magnitudes: { small: '小変更', medium: '中変更', large: '大変更' },
  corners: {
    lf: '左フロントタイヤ',
    rf: '右フロントタイヤ',
    lr: '左リアタイヤ',
    rr: '右リアタイヤ',
    front: 'フロント車軸',
    rear: 'リア車軸',
    left: '左側',
    right: '右側',
    all: '全タイヤ'
  },
  phases: { entry: 'コーナー進入', mid: 'コーナー中盤', exit: 'コーナー脱出' },
  adjustments: {
    'tyre-pressure-decrease-cold': '{corner}の冷間空気圧を {pressureStep} 下げます。',
    'tyre-pressure-decrease-repeat': '中央と両端が近づくまで中程度の幅で繰り返します。',
    'tyre-pressure-increase-cold': '{corner}の冷間空気圧を {pressureStep} 上げます。',
    'tyre-pressure-increase-repeat': '中央と両端が近づくまで中程度の幅で繰り返します。',
    'camber-negative-decrease': '{corner}のネガティブキャンバーを約 0.2–0.4° 減らします。',
    'tyre-pressure-increase-camber-fallback': '必要なら{corner}の空気圧を小幅に上げ、温度分布を再確認します。',
    'camber-negative-increase': '{corner}のネガティブキャンバーを約 0.2–0.4° 増やします。',
    'tyre-pressure-decrease-overheat': '{corner}の冷間空気圧を小幅に下げ、温度を再確認します。',
    'axle-aero-load-decrease': '対象車軸の空力荷重を小幅に減らします。',
    'tyre-pressure-increase-heat': '{corner}の冷間空気圧を小幅に上げ、温度を作ります。',
    'axle-load-increase': '対象車軸への荷重移動を小幅に増やします。',
    'cross-weight-adjust': 'クロスウェイトまたは車高を小幅に調整し、{corner}を均衡させます。',
    'axle-pressure-equalize': '{corner}の左右冷間空気圧を揃え、温間空気圧を検証します。',
    'front-arb-soften': 'フロントのアンチロールバーを 1 クリック柔らかくします。',
    'brake-bias-rearward': 'ブレーキバイアスを約 1% 後方へ移します。',
    'front-springs-soften': 'フロントスプリングを小幅に柔らかくします。',
    'front-aero-increase': 'フロントウイングまたはスプリッターを 1 段増やします。',
    'rear-arb-stiffen': 'リアのアンチロールバーを 1 クリック硬くします。',
    'front-camber-increase': 'フロントのネガティブキャンバーを小幅に増やします。',
    'power-diff-lock-decrease': '加速時のデフロックを小幅に減らします。',
    'rear-arb-soften': 'リアのアンチロールバーを 1 クリック柔らかくします。',
    'rear-aero-decrease': 'リアウイングを 1 段減らします。',
    'rear-aero-increase': 'リアウイングを 1 段増やします。',
    'brake-bias-forward': 'ブレーキバイアスを約 1% 前方へ移します。',
    'front-arb-stiffen': 'フロントのアンチロールバーを 1 クリック硬くします。',
    'brake-pressure-decrease': '最大ブレーキ圧を小幅に下げます。'
  },
  rationale: {
    understeer: '検証済みのバランス信号は{phase}のアンダーステアを示しています。小さな支持変更でフロントグリップを回復できます。',
    oversteer: '検証済みのバランス信号は{phase}のオーバーステアを示しています。小さな支持変更でリアの安定性を回復できます。',
    overheat: '{corner}が作動温度範囲を超えています。空気圧または荷重の小変更で温度を下げられます。',
    cold: '{corner}が作動温度範囲を下回っています。空気圧または荷重の小変更で温度を上げられます。',
    imbalance: '{corner}に再現性のある左右温度差があります。クロスウェイトと左右空気圧を確認してください。',
    camberExcess: '{corner}の内側が外側より大幅に高温で、ネガティブキャンバー過多を示しています。',
    camberLack: '{corner}の外側が内側より大幅に高温で、ネガティブキャンバー不足を示しています。',
    pressureHigh: '{corner}の中央が両端より高温で、空気圧過多と接地面減少を示しています。',
    pressureLow: '{corner}の両端が中央より高温で、空気圧不足と過度な変形を示しています。',
    frontLock: '明示的なフロントロック信号は、この走行で前輪制動が強すぎることを示します。',
    rearLock: '明示的なリアロック信号は、この走行で後輪制動が強すぎることを示します。'
  },
  evidence: {
    balance: '検証済みの{phase}バランス信号：{bias}。',
    pressure: '中央 {middle}、両端平均 {edges}、実測差 {delta}。',
    camber: '内側 {inner}、外側 {outer}、実測差 {delta}。',
    average: '実測タイヤ平均温度：{average}。',
    imbalance: '{corner}：左 {left}、右 {right}、実測差 {delta}。',
    frontLock: '明示的なフロント車軸ロック信号を記録しました。{biasDetail}',
    rearLock: '明示的なリア車軸ロック信号を記録しました。{biasDetail}'
  },
  adjustmentDetails: '{area} · {direction} · {magnitude} · {context}',
  currentBrakeBias: '現在のフロントブレーキバイアス：{bias}。',
  structuredInsufficient: 'この保存済み提案には、正確なローカライズに必要な構造化コードまたは実測値がありません。保存された自由文は表示しません。タイヤ温度、空気圧、摩耗、または検証済みハンドリング信号を含むクリーンラップを記録してください。'
})

const keys: Partial<Record<ResolvedLanguage, Record<string, string>>> = {
  en,
  'pt-BR': pt,
  es,
  fr,
  de,
  zh,
  ja
}

export default keys
