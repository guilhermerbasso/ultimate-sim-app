import { describe, expect, it } from 'vitest'
import type { CoachCornerMetrics, CoachFinding, CoachFindingKind } from './coach'
import {
  analyzeGapTrend,
  areCoachLapsComparable,
  buildQualiStartSummary,
  buildRacecraftAdvice as buildAdvice,
  buildRacecraftHistoryEvidence,
  classifyCoachTrackCondition,
  comparableCoachLaps,
  controlledDefinitionResponse,
  detectRacecraftQuestion,
  detectRacecraftQuestionWithLanguage,
  detectRacecraftLikeQuestionLanguage,
  detectTyreSelectionQuestionLanguage,
  isExplicitSafeInformationalQuestion,
  MAX_QUALI_BRIEFING_LENGTH,
  MAX_RACECRAFT_ADVICE_LENGTH,
  MAX_RACECRAFT_SPEECH_LENGTH,
  parseDefinitionQuestion,
  isCoachHistorySessionKind,
  racecraftSafetyFromSnapshot,
  racecraftSafetyReason,
  type CoachComparableIdentity,
  type CoachLapHistoryEntry,
  type RacecraftAdviceContext,
  type CoachAdviceLanguage
} from './coach-racecraft'
import type { Flags, TelemetrySnapshot } from './telemetry'
import { sessionKindFromProvider } from './telemetry'

function finding(
  kind: CoachFindingKind,
  overrides: Partial<CoachFinding> = {}
): CoachFinding {
  return {
    id: `${kind}:${overrides.corner ?? overrides.sector ?? 1}`,
    kind,
    phase: overrides.phase,
    sector: overrides.sector ?? 1,
    corner: overrides.corner,
    zonePctStart: overrides.zonePctStart ?? 0.2,
    zonePctEnd: overrides.zonePctEnd ?? 0.3,
    severity: overrides.severity ?? 'med',
    estTimeLossSec: overrides.estTimeLossSec ?? 0.2,
    estTimeDeltaSec: overrides.estTimeDeltaSec ?? -0.2,
    sign: overrides.sign ?? 'loss',
    title: overrides.title ?? kind,
    detail: overrides.detail ?? kind,
    evidence: overrides.evidence ?? 'player telemetry',
    confidence: overrides.confidence ?? 0.9,
    metrics: overrides.metrics ?? {},
    ...overrides
  }
}

const DRY_IDENTITY: CoachComparableIdentity = {
  sim: 'iracing',
  trackName: 'Interlagos',
  trackConfigName: 'Grand Prix',
  carName: 'GT3 R',
  carPath: 'gt3r',
  carClassId: 7,
  carClassName: 'GT3',
  condition: 'dry',
  airTempC: 24,
  trackTempC: 35
}

function historyLap(
  id: string,
  identity: CoachComparableIdentity,
  findings: CoachFinding[],
  overrides: Partial<CoachLapHistoryEntry> = {}
): CoachLapHistoryEntry {
  return {
    id,
    at: Number(id.replace(/\D/g, '')) || 1,
    valid: true,
    verification: 'verified-clean',
    sessionKind: 'race',
    identity,
    findings,
    cornerMetrics: [],
    ...overrides
  }
}

const KNOWN_SAFE_RACE = {
  connected: true,
  onTrack: true,
  onPitRoad: false,
  flagsKnown: true,
  pitStateKnown: true,
  paceStateKnown: true,
  paceMode: 'notPacing' as const,
  sessionKind: 'race' as const,
  replayState: 'live' as const
}

function safeAdvice(
  intent: Parameters<typeof buildAdvice>[0],
  context: RacecraftAdviceContext,
  opts?: Parameters<typeof buildAdvice>[2]
) {
  const last = context.gaps?.[context.gaps.length - 1]
  const currentGapSample =
    context.currentGapSample ??
    (
      context.currentGapAheadSec !== undefined || context.currentGapBehindSec !== undefined
        ? {
            at: last?.at ?? 1,
            aheadSec: context.currentGapAheadSec,
            behindSec: context.currentGapBehindSec,
            aheadCarIdx: last?.aheadCarIdx ?? (context.currentGapAheadSec !== undefined ? 10 : undefined),
            behindCarIdx: last?.behindCarIdx ?? (context.currentGapBehindSec !== undefined ? 20 : undefined)
          }
        : undefined
    )
  const gaps =
    context.gaps ??
    (
      currentGapSample
        ? [
            { ...currentGapSample, at: currentGapSample.at - 1_000 },
            currentGapSample
          ]
        : undefined
    )
  return buildAdvice(
    intent,
    {
      safety: KNOWN_SAFE_RACE,
      ...context,
      gaps,
      currentGapSample
    },
    opts
  )
}

describe('racecraft question routing', () => {
  it('recognizes overtake and pull-away questions in every app language', () => {
    const cases: Array<[string, 'overtake' | 'pull-away', CoachAdviceLanguage]> = [
      ['What should I do to pass the car ahead?', 'overtake', 'en-US'],
      ['How do I pull away from the car behind?', 'pull-away', 'en-US'],
      ['Como ultrapassar o carro da frente?', 'overtake', 'pt-BR'],
      ['Como abrir o gap para o carro de trás?', 'pull-away', 'pt-BR'],
      ['¿Cómo adelantar al coche de delante?', 'overtake', 'es'],
      ['¿Cómo alejarme del coche de detrás?', 'pull-away', 'es'],
      ['Comment dépasser la voiture devant ?', 'overtake', 'fr'],
      ['Comment distancer la voiture derrière ?', 'pull-away', 'fr'],
      ['Wie kann ich das Auto vor mir überholen?', 'overtake', 'de'],
      ['Wie kann ich mich vom Auto hinter mir absetzen?', 'pull-away', 'de'],
      ['怎么超过前车？', 'overtake', 'zh'],
      ['怎么甩开后车？', 'pull-away', 'zh'],
      ['前の車をどう追い越す？', 'overtake', 'ja'],
      ['後ろの車をどう引き離す？', 'pull-away', 'ja']
    ]
    for (const [question, intent, language] of cases) {
      expect(detectRacecraftQuestion(question), question).toBe(intent)
      expect(detectRacecraftQuestionWithLanguage(question), question).toEqual({ intent, language })
    }
  })

  it.each([
    ['get past the car in front', 'en-US'],
    ['passar pelo carro que está na minha frente', 'pt-BR'],
    ['superar al coche que tengo delante', 'es'],
    ['passer la voiture qui me précède', 'fr'],
    ['wie komme ich am vorausfahrenden Auto vorbei', 'de'],
    ['怎么超过我前面的车', 'zh'],
    ['前を走る車をどう抜けばいい', 'ja']
  ] as Array<[string, CoachAdviceLanguage]>)(
    'recognizes adversarial overtake paraphrase %s',
    (question, language) => {
      expect(detectRacecraftQuestionWithLanguage(question)).toEqual({
        intent: 'overtake',
        language
      })
    }
  )

  it.each([
    'Can I pass on the next corner?',
    'C.a.n I p@ss on the next c0rner?',
    'Would it be smart to go for it around the outside into T1?',
    'Is there room to make a move at the next turn?',
    'Should I push past this car after the restart?',
    'Do you think the door stays open into the hairpin?',
    'Is now a good time to get alongside?',
    'Could I gain the position before the braking zone?',
    'Should I fight for position on this lap?'
  ])('conservatively classifies tactical or obfuscated wording: %s', (question) => {
    expect(detectRacecraftLikeQuestionLanguage(question)).toBe('en-US')
  })

  it.each([
    'What is an overtake?',
    'Define divebomb.',
    'Explain the term racing move.'
  ])('allows non-tactical informational wording through the conservative gate: %s', (question) => {
    expect(detectRacecraftLikeQuestionLanguage(question)).toBeNull()
  })

  it.each([
    'What is understeer?',
    'What does ABS do?',
    'Define an overtake.',
    'Explain the meaning of a yellow flag.',
    'O que é subviragem?',
    'Was ist ein Safety Car?'
  ])('allowlists an explicitly informational non-tactical question: %s', (question) => {
    expect(isExplicitSafeInformationalQuestion(question)).toBe(true)
  })

  it.each([
    'Can I pass on the next corner?',
    'How should I approach this corner?',
    'Tell me how to push harder now.',
    'What is the best way to attack the car ahead?',
    'Explain whether I should send it.',
    'Explain understeer then how I overtake the leader.',
    'Define the best overtake line into Turn 1.',
    'Define oversteer so I can overtake the leader immediately.',
    'Explain apex and which apex to take to overtake here.'
  ])('does not allowlist actionable or ambiguous driving wording: %s', (question) => {
    expect(isExplicitSafeInformationalQuestion(question)).toBe(false)
  })

  it.each([
    ['Define divebomb.', 'en-US', 'controlled glossary'],
    ['Defina cambagem.', 'pt-BR', 'glossário controlado'],
    ['Define aerodinámica activa.', 'es', 'glosario controlado'],
    ['Explique le bump steer.', 'fr', 'glossaire contrôlé'],
    ['Definiere Bumpsteer.', 'de', 'kontrollierten Glossar'],
    ['主动空气动力学是什么', 'zh', '受控术语表'],
    ['主动空气动力学是什么？', 'zh', '受控术语表'],
    ['ダイブボムとは何', 'ja', '用語集'],
    ['ダイブボムとは？', 'ja', '用語集']
  ] as Array<[string, CoachAdviceLanguage, string]>)(
    'returns a localized controlled response for unsupported definition %s',
    (question, language, marker) => {
      expect(controlledDefinitionResponse(question, language)).toContain(marker)
    }
  )

  it('does not classify ordinary free-form prose as a definition request', () => {
    expect(controlledDefinitionResponse('Tell me about my race.', 'en-US')).toBeNull()
  })

  it.each([
    ['Definition of understeer', 'understeer'],
    ['Meaning of oversteer', 'oversteer'],
    ['Tell me about the concept of ABS', 'abs'],
    ['What is traction control?', 'traction-control'],
    ['Que significa bandera amarilla?', 'yellow-flag'],
    ['O que é safety car?', 'safety-car'],
    ["What's understeer?", 'understeer'],
    ['Please define oversteer.', 'oversteer'],
    ['Could you explain ABS?', 'abs'],
    ['Can you tell me what traction control means?', 'traction-control'],
    ['Could you tell me about understeer?', 'understeer'],
    ['Would you tell me the meaning of oversteer?', 'oversteer'],
    ['Definition: yellow flag.', 'yellow-flag'],
    ['Tell me about the concept of safety car.', 'safety-car'],
    ['Por favor, poderia você explicar subviragem?', 'understeer'],
    ['Pode me explicar subviragem?', 'understeer'],
    ['Você pode me explicar subviragem?', 'understeer'],
    ['Qual é o significado de subviragem?', 'understeer'],
    ['O que significa subviragem?', 'understeer'],
    ['Me explique sobreviragem.', 'oversteer'],
    ['¿Podrías explicar el sobreviraje?', 'oversteer'],
    ['¿Puedes explicarme el subviraje?', 'understeer'],
    ['¿Me puedes explicar el subviraje?', 'understeer'],
    ['Peux-tu expliquer le sous-virage ?', 'understeer'],
    ["Pouvez-vous m'expliquer le survirage ?", 'oversteer'],
    ['Bitte kannst du ABS erklären?', 'abs'],
    ['Kannst du mir Untersteuern erklären?', 'understeer'],
    ['Können Sie Untersteuern erklären?', 'understeer'],
    ["What's the meaning of understeer?", 'understeer'],
    ['How is understeer defined?', 'understeer'],
    ['Me explicas el subviraje?', 'understeer'],
    ['Explíqueme el subviraje.', 'understeer'],
    ['Expliquez-moi le sous-virage.', 'understeer'],
    ['Pouvez-vous définir le sous-virage?', 'understeer'],
    ['Was heißt Untersteuern?', 'understeer'],
    ['Could understeer be explained?', 'understeer'],
    ['¿Podría definirme el subviraje?', 'understeer'],
    ['Définissez le sous-virage.', 'understeer'],
    ['Können Sie Untersteuern definieren?', 'understeer'],
    ['アンダーステアについて説明してください', 'understeer']
  ] as const)('parses localized definition form %s', (question, topic) => {
    expect(parseDefinitionQuestion(question)).toMatchObject({
      pure: true,
      topic
    })
  })

  it('routes an unmatched French definition envelope to the controlled unsupported response', () => {
    expect(
      controlledDefinitionResponse('Comment expliquer le bump steer?', 'fr')
    ).toContain('glossaire contrôlé')
  })

  it.each([
    'Define tyre compound.',
    'What does tyre compound mean?',
    'Explain tyre pressure.',
    'Define tyre change.',
    'What does tyre change mean?',
    'What does change tyres mean?',
    'What does choose a compound mean?',
    'Give me the meaning of change tyres.',
    'How is change tyres defined?',
    'Could change tyres be explained?',
    'What does "change tyres" mean?',
    'What is the definition of change tyres?',
    'Could you define change tyres?',
    'Please explain the meaning of change tyres.',
    'Explain the term change tyres.',
    'Explain the definition of change tyres.',
    'Tell me about the concept of change tyres.',
    'Defina trocar pneus.',
    'Definissez changer les pneus.',
    'Definiere Reifen wechseln.',
    'Explique o termo trocar pneus.',
    'Explique el término cambiar neumáticos.',
    'Explique le terme changer les pneus.',
    'Erkläre den Begriff Reifen wechseln.',
    'Você pode me explicar trocar pneus?',
    '¿Podría explicarme cambiar neumáticos?',
    'Expliquez-moi changer les pneus.',
    'Können Sie mir Reifen wechseln erklären?'
  ])('keeps telemetry-noun definitions inside the controlled glossary: %s', (question) => {
    expect(parseDefinitionQuestion(question)).toMatchObject({ pure: true })
    expect(controlledDefinitionResponse(question, 'en-US')).toContain(
      'controlled glossary'
    )
  })

  it.each([
    'I definitely need to save fuel.',
    'Give me explicit fuel data.',
    'How do I save fuel? Explain.',
    'Please save fuel and explain why.',
    'What tyre pressure should I use? Explain.',
    'Could you explain how to conserve fuel?',
    'Please explain how to reduce tyre pressure.',
    'Please explain whether I should lower tyre pressure.',
    'Could you explain what tyre pressure I should run?',
    'Explain which tyre compound I should pick.',
    'What is the tyre pressure I should run?',
    'What is the compound I should choose?',
    'Define how I should conserve fuel.',
    'Could you explain what tyre pressure we should run?',
    'Explain which compound would be best.',
    'Please explain whether to lower tyre pressure.',
    'Explain what tyre pressure to run.',
    'Explain which compound is best.',
    'Explain whether lowering tyre pressure is a good idea.',
    'Explique quando trocar pneus.',
    'Explique cuándo cambiar neumáticos.',
    'Explique quand changer les pneus.',
    'Können Sie mir erklären, wann Reifen wechseln?',
    'Explique qual pneu usar.',
    'Explique qué neumático usar.',
    'Explique quel composé choisir.',
    'Erklären Sie, welche Reifen wir verwenden.'
  ])('does not mistake ordinary words for definition markers: %s', (question) => {
    expect(parseDefinitionQuestion(question)?.pure ?? false).toBe(false)
    expect(controlledDefinitionResponse(question, 'en-US')).toBeNull()
  })

  it.each([
    ['pt-BR', 'Quais pneus devo usar?'],
    ['pt-BR', 'Por favor, quais compostos você recomendaria?'],
    ['pt-BR', 'Você pode me explicar quais são os melhores pneus?'],
    ['pt-BR', 'Poderia me dizer qual seria o pneu mais adequado?'],
    ['pt-BR', 'Você poderia explicar quais compostos seriam melhores?'],
    ['pt-BR', 'Você pode me explicar se os pneus macios seriam melhores?'],
    ['pt-BR', 'Por favor, diga se o composto duro seria melhor.'],
    ['pt-BR', 'Você pode explicar se o melhor é o pneu macio?'],
    ['pt-BR', 'Por favor, diga se os melhores seriam os compostos macios.'],
    ['pt-BR', 'se o pneu macio é superior'],
    ['pt-BR', 'Por favor, diga se extraordinário é o composto duro.'],
    ['pt-BR', 'Explique se o pneu médio não é vantajoso.'],
    ['es', '¿Qué neumáticos debo usar?'],
    ['es', 'Por favor, ¿cuáles compuestos recomendaría?'],
    ['es', '¿Podría explicarme cuáles son los mejores neumáticos?'],
    ['es', 'Por favor, ¿cuál sería el neumático más adecuado?'],
    ['es', '¿Me explica qué compuestos serían mejores?'],
    ['es', '¿Podría explicarme si los neumáticos blandos serían mejores?'],
    ['es', 'Por favor, dime si el compuesto duro sería mejor.'],
    ['es', '¿Podría explicar si el mejor es el neumático blando?'],
    ['es', 'Por favor, dime si los mejores serían los compuestos blandos.'],
    ['es', 'si el neumático blando es superior'],
    ['es', 'Por favor, dime si sobresaliente es el compuesto duro.'],
    ['es', 'Explique si el neumático medio no conviene.'],
    ['fr', 'Quels pneus dois-je utiliser ?'],
    ['fr', 'S’il vous plaît, quels composés recommanderiez-vous ?'],
    ['fr', 'Expliquez-moi quels sont les meilleurs pneus.'],
    ['fr', 'Pourriez-vous me dire quel serait le pneu le plus adapté ?'],
    ['fr', 'Quels composés seraient meilleurs, s’il vous plaît ?'],
    ['fr', 'Expliquez-moi si les pneus tendres seraient meilleurs.'],
    ['fr', 'Pourriez-vous dire si la gomme dure serait meilleure ?'],
    ['fr', 'Expliquez-moi si le meilleur est le pneu tendre.'],
    ['fr', 'Dites-moi, s’il vous plaît, si les meilleurs seraient les composés tendres.'],
    ['fr', 'si le pneu tendre est supérieur'],
    ['fr', 'Dites-moi si remarquable est la gomme dure.'],
    ['fr', 'Expliquez si le pneu moyen n’est guère avantageux.'],
    ['de', 'Welchen Reifen soll ich verwenden?'],
    ['de', 'Welche Reifen würden Sie bitte empfehlen?'],
    ['de', 'Erkläre mir, welche die besten Reifen sind.'],
    ['de', 'Könnten Sie mir erklären, welcher Reifen besser wäre?'],
    ['de', 'Welchem Reifen sollte ich bitte den Vorzug geben?'],
    ['de', 'Erkläre mir bitte, ob die weichen Reifen besser wären.'],
    ['de', 'Könnten Sie sagen, ob die harte Mischung besser wäre?'],
    ['de', 'Erkläre mir, ob der beste der weiche Reifen ist.'],
    ['de', 'Sagen Sie mir bitte, ob die besten die weichen Mischungen sind.'],
    ['de', 'ob der weiche Reifen überlegen ist'],
    ['de', 'Sagen Sie bitte, ob außergewöhnlich die harte Mischung ist.'],
    ['de', 'Erklären Sie, ob der mittlere Reifen keineswegs taugt.']
  ] as const)('default-denies localized tyre-choice structure: %s — %s', (language, question) => {
    expect(detectTyreSelectionQuestionLanguage(question)).toBe(language)
    expect(parseDefinitionQuestion(question)?.pure ?? false).toBe(false)
    expect(controlledDefinitionResponse(question, language)).toBeNull()
  })

  it.each([
    'Quais são as pressões dos pneus?',
    '¿Cuáles son las presiones de los neumáticos?',
    'Quelles sont les pressions des pneus ?',
    'Wie hoch sind die Reifendrücke?',
    'What are the tyre pressures?',
    'Se a pressão dos pneus está em 180 kPa?',
    'Si la presión de los neumáticos es 180 kPa?',
    'Si la pression des pneus est de 180 kPa ?',
    'Ob der Reifendruck 180 kPa beträgt?'
  ])('does not mistake read-only tyre status for compound selection: %s', (question) => {
    expect(detectTyreSelectionQuestionLanguage(question)).toBeNull()
  })

  it.each([
    ['pt-BR', 'O que significa pneu?'],
    ['es', '¿Qué significa neumático?'],
    ['fr', 'Que signifie pneu ?'],
    ['de', 'Was bedeutet Reifen?']
  ] as const)('preserves factual localized tyre definitions: %s — %s', (language, question) => {
    expect(detectTyreSelectionQuestionLanguage(question)).toBeNull()
    expect(parseDefinitionQuestion(question)).toMatchObject({ pure: true })
    expect(controlledDefinitionResponse(question, language)).not.toBeNull()
  })

  it.each([
    ['pt-BR', 'O que significa a frase "se o pneu macio é superior"?'],
    ['es', '¿Qué significa la frase "si el neumático blando es superior"?'],
    ['fr', 'Que signifie la phrase « si le pneu tendre est supérieur » ?'],
    ['de', 'Was bedeutet der Satz „ob der weiche Reifen überlegen ist“?']
  ] as const)('keeps narrow quoted phrase-meaning requests controlled: %s — %s', (language, question) => {
    expect(detectTyreSelectionQuestionLanguage(question)).toBeNull()
    expect(parseDefinitionQuestion(question)).toMatchObject({ pure: true })
    expect(controlledDefinitionResponse(question, language)).not.toBeNull()
  })

  it.each([
    'Could you tell me the meaning of change tyres?',
    'Can you tell me what change tyres means?',
    'Give me the meaning of change tyres.',
    'How is change tyres defined?',
    'Could change tyres be explained?'
  ])('keeps alternate explicit meaning envelopes controlled: %s', (question) => {
    expect(parseDefinitionQuestion(question)).toMatchObject({ pure: true })
    expect(controlledDefinitionResponse(question, 'en-US')).toContain(
      'controlled glossary'
    )
  })

  it('parses tactical compound definitions once and marks them impure', () => {
    expect(
      parseDefinitionQuestion('Explain understeer then how I overtake the leader.')
    ).toMatchObject({
      pure: false,
      topic: null
    })
  })

  it.each([
    'Me explique como faço para frear melhor.',
    'Explícame cómo mejorar mi frenada.',
    'Explique-moi comment améliorer mon freinage.',
    'Erkläre mir, wie ich besser bremsen kann.',
    'Tell me about Turn 3.',
    'Tell me about the last lap.',
    'Tell me about the car ahead.',
    'Tell me about P2.',
    'Tell me about the leader.'
  ])('does not treat personal coaching wording as a pure glossary request: %s', (question) => {
    expect(parseDefinitionQuestion(question)).toMatchObject({ pure: false })
    expect(controlledDefinitionResponse(question, 'en-US')).toBeNull()
  })

  it.each([
    ['Should I send it down the inside?', 'en-US'],
    ['Devo mergulhar por dentro?', 'pt-BR'],
    ['¿Debo tirarme por dentro?', 'es'],
    ['Dois-je plonger à l’intérieur ?', 'fr'],
    ['Soll ich innen reinstechen?', 'de'],
    ['我该钻内线吗？', 'zh'],
    ['インに飛び込むべき？', 'ja']
  ] as Array<[string, CoachAdviceLanguage]>)(
    'classifies unknown tactical paraphrase %s for grounded clarification',
    (question, language) => {
      expect(detectRacecraftQuestionWithLanguage(question)).toBeNull()
      expect(detectRacecraftLikeQuestionLanguage(question)).toBe(language)
    }
  )

  it.each([
    [{ flagRed: true, flagYellow: true, flagBlue: true }, 'red-flag'],
    [{ flagBlack: true, flagYellow: true }, 'black-flag'],
    [{ flagDisqualify: true, flagYellow: true, flagBlue: true }, 'disqualify'],
    [{ flagCheckered: true, flagYellow: true }, 'checkered']
  ] as const)('gives terminal flags precedence for %j', (safety, expected) => {
    expect(racecraftSafetyReason(safety)).toBe(expected)
  })

  it('fails closed for an explicit unknown provider session kind', () => {
    expect(
      racecraftSafetyReason(
        racecraftSafetyFromSnapshot({
          sim: 'acc',
          connected: true,
          sessionKind: 'unknown'
        } as TelemetrySnapshot)
      )
    ).toBe('non-racing')
  })

  it('fails closed with localized guidance when provider safety channels are unavailable', () => {
    const copy: Record<CoachAdviceLanguage, string> = {
      'en-US': 'RACE-CONTROL STATE UNAVAILABLE',
      'pt-BR': 'ESTADO DA DIREÇÃO DE PROVA INDISPONÍVEL',
      es: 'ESTADO DE CONTROL DE CARRERA NO DISPONIBLE',
      fr: 'ÉTAT DE LA DIRECTION DE COURSE INDISPONIBLE',
      de: 'RENNLEITUNGSSTATUS NICHT VERFÜGBAR',
      zh: '无法获取赛会控制状态',
      ja: 'レースコントロール状態を取得できません'
    }
    for (const sim of ['acc', 'ac', 'ams2'] as const) {
      const safety = racecraftSafetyFromSnapshot({
        sim,
        connected: true,
        sessionKind: 'race'
      } as TelemetrySnapshot)
      for (const language of Object.keys(copy) as CoachAdviceLanguage[]) {
        for (const intent of ['overtake', 'pull-away'] as const) {
          const advice = buildAdvice(
            intent,
            {
              safety,
              findings: [finding('throttle-late', { corner: 2, phase: 'exit' })],
              currentGapAheadSec: 0.8,
              currentGapBehindSec: 0.8
            },
            { language }
          )
          expect(advice).toMatchObject({
            mode: 'suppressed',
            suppressedReason: 'race-control-unknown',
            items: []
          })
          expect(advice.text).toContain(copy[language])
        }
      }
    }
  })

  it('treats an explicit provider race-control unknown state as unknown even if a stale flags object exists', () => {
    const safety = racecraftSafetyFromSnapshot({
      sim: 'acc',
      connected: true,
      onTrack: true,
      onPitRoad: false,
      paceMode: 'notPacing',
      sessionKind: 'race',
      raceControlState: 'unknown',
      raceControlUnknownReason: 'acc-flag-unsupported:99',
      flags: {
        green: false,
        yellow: false,
        blue: false,
        white: false,
        checkered: false,
        red: false,
        black: false,
        meatball: false,
        repair: false,
        disqualify: false,
        greenWhiteCheckered: false
      }
    } as TelemetrySnapshot)

    expect(safety.flagsKnown).toBe(false)
    expect(safety.raceControlUnknownReason).toBe('acc-flag-unsupported:99')
    expect(racecraftSafetyReason(safety)).toBe('race-control-unknown')
  })

  it.each(['acc', 'ac', 'ams2'] as const)(
    'allows tactical advice for %s only when all safety channels are known-safe',
    (sim) => {
      const safety = racecraftSafetyFromSnapshot({
        sim,
        connected: true,
        sessionKind: 'race',
        onTrack: true,
        onPitRoad: false,
        paceMode: 'notPacing',
        flags: {
          green: true,
          yellow: false,
          blue: false,
          white: false,
          checkered: false,
          red: false,
          black: false,
          meatball: false,
          repair: false,
          disqualify: false,
          greenWhiteCheckered: false
        }
      } as TelemetrySnapshot)
      for (const language of ['en-US', 'pt-BR', 'es', 'fr', 'de', 'zh', 'ja'] as const) {
        const advice = buildAdvice(
          'overtake',
          {
            safety,
            findings: [finding('throttle-late', { corner: 2, phase: 'exit' })],
            currentGapAheadSec: 0.8,
            gaps: [
              { at: 0, aheadSec: 0.9, aheadCarIdx: 10 },
              { at: 1, aheadSec: 0.8, aheadCarIdx: 10 }
            ],
            currentGapSample: { at: 1, aheadSec: 0.8, aheadCarIdx: 10 }
          },
          { language }
        )
        expect(advice.mode).toBe('overtake')
        expect(advice.suppressedReason).toBeUndefined()
        expect(advice.items.length).toBeGreaterThan(0)
      }
    }
  )

  it.each([
    { carLeftRight: 'left' as const },
    { carLeftRight: 'right' as const },
    { carLeftRight: 'both' as const },
    { carsAlongsideCount: 1 },
    { radarClosestMeters: 4 },
    { gapAheadSec: 0.2 },
    { gapBehindSec: 0.2 }
  ])('suppresses both tactical intents during overlap/proximity %#', (proximity) => {
    for (const intent of ['overtake', 'pull-away'] as const) {
      const advice = buildAdvice(intent, {
        safety: { ...KNOWN_SAFE_RACE, ...proximity },
        findings: [finding('throttle-late', { corner: 2, phase: 'exit' })],
        currentGapAheadSec: 0.8,
        currentGapBehindSec: 0.8,
        gaps: [
          { at: 1, aheadSec: 0.9, behindSec: 0.9, aheadCarIdx: 10, behindCarIdx: 20 },
          { at: 2, aheadSec: 0.8, behindSec: 0.8, aheadCarIdx: 10, behindCarIdx: 20 }
        ],
        currentGapSample: {
          at: 2,
          aheadSec: 0.8,
          behindSec: 0.8,
          aheadCarIdx: 10,
          behindCarIdx: 20
        }
      })
      expect(advice.mode).toBe('suppressed')
      expect(['overlap', 'proximity']).toContain(advice.suppressedReason)
      expect(advice.items).toEqual([])
    }
  })

  it('requires stable non-overlap samples after separation before tactical advice resumes', () => {
    const base: RacecraftAdviceContext = {
      safety: KNOWN_SAFE_RACE,
      findings: [finding('throttle-late', { corner: 2, phase: 'exit' })],
      currentGapAheadSec: 0.8,
      currentGapSample: { at: 2, aheadSec: 0.8, aheadCarIdx: 10 }
    }
    const firstClear = buildAdvice('overtake', {
      ...base,
      gaps: [{ at: 2, aheadSec: 0.8, aheadCarIdx: 10 }]
    })
    const stableClear = buildAdvice('overtake', {
      ...base,
      gaps: [
        { at: 1, aheadSec: 0.9, aheadCarIdx: 10 },
        { at: 2, aheadSec: 0.8, aheadCarIdx: 10 }
      ]
    })
    expect(firstClear.mode).toBe('lap-improvement')
    expect(stableClear.mode).toBe('overtake')
  })
})

describe('buildRacecraftAdvice', () => {
  const cornerMetrics: CoachCornerMetrics[] = [
    {
      corner: 7,
      entrySpeedKmh: 201,
      minSpeedKmh: 92,
      exitSpeedKmh: 141,
      brakeStartPct: 0.421,
      steerStartPct: 0.438,
      throttleStartPct: 0.572,
      tcActivePct: 0.22
    }
  ]

  it('builds an OVERTAKE plan from player exit evidence and a closing car-ahead gap', () => {
    const advice = safeAdvice('overtake', {
      findings: [
        finding('brake-early', { corner: 4, sector: 1, phase: 'entry', estTimeLossSec: 0.3 }),
        finding('throttle-hesitation', { corner: 7, sector: 2, phase: 'exit', estTimeLossSec: 0.18 })
      ],
      cornerMetrics,
      gaps: [
        { at: 1000, aheadSec: 1.2, aheadCarIdx: 10 },
        { at: 3000, aheadSec: 1.0, aheadCarIdx: 10 },
        { at: 5000, aheadSec: 0.8, aheadCarIdx: 10 }
      ],
      currentGapAheadSec: 0.8
    })

    expect(advice.mode).toBe('overtake')
    expect(advice.gapTrend).toBe('closing')
    expect(advice.opponentData).toBe('timing-only')
    expect(advice.items[0]).toMatchObject({ corner: 7, phase: 'exit' })
    expect(advice.items[0].text).toContain('exit 141 km/h')
    expect(advice.items[0].text).toContain('throttle return 57.2% lap')
    expect(advice.evidenceSource).toBe('current-lap')
    expect(advice.text).toContain('OVERTAKE')
    expect(advice.text).toContain('opponent controls are unavailable')
  })

  it('builds a DEFEND plan when the car behind is close and closing', () => {
    const advice = safeAdvice('pull-away', {
      findings: [finding('brake-early', { corner: 2, sector: 1, phase: 'entry' })],
      cornerMetrics: [
        { corner: 2, entrySpeedKmh: 188, minSpeedKmh: 84, brakeStartPct: 0.22 }
      ],
      gaps: [
        { at: 1000, behindSec: 1.1, behindCarIdx: 20 },
        { at: 3000, behindSec: 0.9, behindCarIdx: 20 },
        { at: 5000, behindSec: 0.7, behindCarIdx: 20 }
      ],
      currentGapBehindSec: 0.7
    })

    expect(advice.mode).toBe('defend')
    expect(advice.gapTrend).toBe('closing')
    expect(advice.items[0].phase).toBe('entry')
    expect(advice.items[0].expectedBenefit).toContain('prevent a stronger run')
    expect(advice.text).toContain('DEFEND')
  })

  it('falls back to condition-matched player history for both ahead and behind advice', () => {
    const recurring = finding('throttle-late', {
      corner: 7,
      sector: 2,
      phase: 'exit',
      estTimeLossSec: 0.24
    })
    const history = [
      historyLap('1', DRY_IDENTITY, [recurring], {
        lapTimeSec: 90,
        cornerMetrics: [{ corner: 7, entrySpeedKmh: 198, minSpeedKmh: 91, exitSpeedKmh: 138, throttleStartPct: 0.58 }]
      }),
      historyLap('2', DRY_IDENTITY, [recurring], {
        lapTimeSec: 89,
        cornerMetrics: [{ corner: 7, entrySpeedKmh: 199, minSpeedKmh: 92, exitSpeedKmh: 140, throttleStartPct: 0.57 }]
      }),
      historyLap('3', DRY_IDENTITY, [recurring], {
        lapTimeSec: 88,
        cornerMetrics: [{ corner: 7, entrySpeedKmh: 201, minSpeedKmh: 94, exitSpeedKmh: 145, throttleStartPct: 0.55 }]
      })
    ]
    const historyEvidence = buildRacecraftHistoryEvidence(DRY_IDENTITY, history)

    const overtake = safeAdvice('overtake', {
      condition: 'dry',
      historyEvidence,
      currentGapAheadSec: 0.9
    })
    const defend = safeAdvice('pull-away', {
      condition: 'dry',
      historyEvidence,
      currentGapBehindSec: 0.7
    })

    expect(overtake).toMatchObject({
      mode: 'overtake',
      evidenceSource: 'history',
      comparableHistoryLaps: 3
    })
    expect(overtake.items[0]).toMatchObject({
      corner: 7,
      source: 'history',
      evidence: {
        source: 'history',
        referenceSource: 'history-best',
        lapsSeen: 3,
        lapsCompared: 3
      }
    })
    expect(overtake.text).toContain('exit 138 km/h vs 145 km/h')
    expect(overtake.text.match(/Player history:/g)).toHaveLength(1)
    expect(defend.mode).toBe('defend')
    expect(defend.items[0].source).toBe('history')
    for (const text of [overtake.text, defend.text]) {
      expect(text).toContain('opponent controls are unavailable')
      expect(text).not.toMatch(/opponent (?:brak|throttle|turn|entry|exit)/i)
    }
  })

  it('normalizes signed relative gaps without inventing opponent controls', () => {
    const advice = safeAdvice('pull-away', {
      findings: [finding('throttle-late', { corner: 2, phase: 'exit' })],
      currentGapBehindSec: -0.8
    })

    expect(advice.mode).toBe('defend')
    expect(advice.gapSec).toBe(0.8)
    expect(advice.text).toContain('opponent controls are unavailable')
  })

  it('falls back to general lap improvement when opponent timing is missing', () => {
    const advice = safeAdvice('overtake', {
      findings: [finding('steering-late', { corner: 5, sector: 2 })]
    })

    expect(advice.mode).toBe('lap-improvement')
    expect(advice.opponentData).toBe('unavailable')
    expect(advice.gapSec).toBeUndefined()
    expect(advice.text).toContain('no reliable gap to the car ahead')
    expect(advice.text).toContain('opponent controls are unavailable')
    expect(advice.text).not.toMatch(/\b\d+\.\d+s\b/)
  })

  it('uses general lap improvement when the car ahead is not yet in passing range', () => {
    const advice = safeAdvice('overtake', {
      findings: [finding('throttle-late', { corner: 7, sector: 2, phase: 'exit' })],
      currentGapAheadSec: 5.2
    })

    expect(advice.mode).toBe('lap-improvement')
    expect(advice.opponentData).toBe('timing-only')
    expect(advice.text).toContain('LAP IMPROVEMENT')
  })

  it('does not combine gap trends from different opponents', () => {
    const trend = analyzeGapTrend(
      [
        { at: 1000, aheadSec: 1.8, aheadCarIdx: 10 },
        { at: 2000, aheadSec: 0.5, aheadCarIdx: 20 },
        { at: 4000, aheadSec: 0.7, aheadCarIdx: 20 },
        { at: 7000, aheadSec: 0.9, aheadCarIdx: 20 }
      ],
      'ahead'
    )

    expect(trend.trend).toBe('opening')
    expect(trend.deltaSec).toBeCloseTo(0.4)
  })

  it('requires a contiguous suffix for one stable opponent identity', () => {
    const interrupted = analyzeGapTrend(
      [
        { at: 1000, aheadSec: 1.8, aheadCarIdx: 10 },
        { at: 2000, aheadSec: 1.5, aheadCarIdx: 10 },
        { at: 3000, aheadSec: 1.2, aheadCarIdx: 20 },
        { at: 4000, aheadSec: 1.0, aheadCarIdx: 10 },
        { at: 5000, aheadSec: 0.8, aheadCarIdx: 10 }
      ],
      'ahead',
      0.8
    )
    const missingLatestIdentity = analyzeGapTrend(
      [
        { at: 1000, aheadSec: 1.4, aheadCarIdx: 10 },
        { at: 3000, aheadSec: 1.1, aheadCarIdx: 10 },
        { at: 5000, aheadSec: 0.8 }
      ],
      'ahead',
      0.8
    )

    expect(interrupted).toMatchObject({ trend: 'unknown', confidence: 0, sampleCount: 2 })
    expect(missingLatestIdentity).toMatchObject({ trend: 'unknown', confidence: 0, sampleCount: 0 })
  })

  it('distinguishes entry improvement from exit/traction improvement', () => {
    const entry = safeAdvice('overtake', {
      findings: [finding('brake-early', { corner: 7, sector: 2, phase: 'entry' })],
      cornerMetrics,
      currentGapAheadSec: 0.9
    })
    const exit = safeAdvice('overtake', {
      findings: [finding('tc-overuse', { corner: 7, sector: 2, phase: 'exit' })],
      cornerMetrics,
      currentGapAheadSec: 0.9
    })
    const turnIn = safeAdvice('overtake', {
      findings: [finding('steering-late', { corner: 7, sector: 2, phase: 'entry' })],
      cornerMetrics,
      currentGapAheadSec: 0.9
    })

    expect(entry.items[0].text).toContain('brake point 42.1% lap')
    expect(entry.items[0].action).toContain('brake later')
    expect(turnIn.items[0].text).toContain('turn-in 43.8% lap')
    expect(turnIn.items[0].text).not.toContain('brake point')
    expect(exit.items[0].evidence.tractionQuality).toBe('tc-limited')
    expect(exit.items[0].text).toContain('exit 141 km/h')
    expect(exit.items[0].expectedBenefit).toContain('passing run')
  })

  it('keeps messages concise, capped, and removes contradictory recommendations', () => {
    const advice = safeAdvice(
      'pull-away',
      {
        currentGapBehindSec: 0.8,
        findings: [
          finding('brake-early', { corner: 1, sector: 1, zonePctStart: 0.1, zonePctEnd: 0.14, estTimeLossSec: 0.1 }),
          finding('brake-late', { corner: 1, sector: 1, zonePctStart: 0.1, zonePctEnd: 0.14, estTimeLossSec: 0.35 }),
          finding('throttle-late', { corner: 2, sector: 1, zonePctStart: 0.25, zonePctEnd: 0.29, estTimeLossSec: 0.25 }),
          finding('steering-late', { corner: 3, sector: 2, zonePctStart: 0.5, zonePctEnd: 0.54, estTimeLossSec: 0.2 }),
          finding('coast', { corner: 4, sector: 3, zonePctStart: 0.75, zonePctEnd: 0.79, estTimeLossSec: 0.15 })
        ]
      },
      { maxItems: 3 }
    )

    expect(advice.items.length).toBeGreaterThan(0)
    expect(advice.items.length).toBeLessThanOrEqual(3)
    expect(advice.text.length).toBeLessThanOrEqual(MAX_RACECRAFT_ADVICE_LENGTH)
    expect(advice.text).toContain('brake a touch earlier')
    expect(advice.text).not.toContain('brake later toward')
  })

  it.each([
    ['yellow-flag', { flagYellow: true }],
    ['blue-flag', { flagBlue: true }],
    ['red-flag', { flagRed: true }],
    ['black-flag', { flagBlack: true }],
    ['meatball', { flagMeatball: true }],
    ['repair', { flagRepair: true }],
    ['disqualify', { flagDisqualify: true }],
    ['checkered', { flagCheckered: true }],
    ['caution', { caution: true }],
    ['pacing', { paceMode: 'doubleFileRestart' as const }],
    ['pit', { onPitRoad: true }],
    ['replay', { replayState: 'replay' as const }],
    ['non-racing', { sessionState: 'warmup' as const }],
    ['not-on-track', { onTrack: false }]
  ])('suppresses tactical advice for %s', (reason, safety) => {
    for (const intent of ['overtake', 'pull-away'] as const) {
      const advice = safeAdvice(intent, {
        safety,
        findings: [finding('throttle-late', { corner: 7, phase: 'exit' })],
        currentGapAheadSec: 0.7,
        currentGapBehindSec: 0.7
      })

      expect(advice).toMatchObject({
        mode: 'suppressed',
        suppressedReason: reason,
        items: [],
        gapTrend: 'unknown'
      })
      expect(advice.text).not.toContain('Turn 7')
    }
  })

  it.each([
    'yellow',
    'blue',
    'red',
    'black',
    'meatball',
    'repair',
    'disqualify',
    'checkered'
  ] as const)('maps telemetry flag %s into suppression for both tactical intents', (flag) => {
    const flags: Flags = {
      green: false,
      yellow: false,
      blue: false,
      white: false,
      checkered: false,
      red: false,
      black: false,
      meatball: false,
      repair: false,
      disqualify: false,
      greenWhiteCheckered: false,
      [flag]: true
    }
    const safety = racecraftSafetyFromSnapshot({
      connected: true,
      flags
    } as TelemetrySnapshot)

    for (const intent of ['overtake', 'pull-away'] as const) {
      expect(
        safeAdvice(intent, {
          safety,
          findings: [finding('brake-late', { corner: 2 })],
          currentGapAheadSec: 0.8,
          currentGapBehindSec: 0.8
        })
      ).toMatchObject({ mode: 'suppressed', items: [] })
    }
  })

  it('ignores huge irrelevant gaps and requires confidence before calling a trend closing', () => {
    const huge = analyzeGapTrend(
      [
        { at: 1000, aheadSec: 20 },
        { at: 3000, aheadSec: 19.9 },
        { at: 5000, aheadSec: 19.8 }
      ],
      'ahead',
      19.8
    )
    const lowConfidence = analyzeGapTrend(
      [
        { at: 1000, aheadSec: 2.0 },
        { at: 4000, aheadSec: 1.7 }
      ],
      'ahead',
      1.7
    )
    const advice = safeAdvice('overtake', {
      findings: [finding('throttle-late', { corner: 7, phase: 'exit' })],
      gaps: [
        { at: 1000, aheadSec: 20 },
        { at: 3000, aheadSec: 19.9 },
        { at: 5000, aheadSec: 19.8 }
      ],
      currentGapAheadSec: 19.8
    })

    expect(huge).toMatchObject({ relevant: false, trend: 'unknown', confidence: 0 })
    expect(lowConfidence.trend).toBe('unknown')
    expect(advice.mode).toBe('lap-improvement')
    expect(advice.gapTrend).toBe('unknown')
  })

  it('lets current evidence win over contradictory history in the same normalized zone', () => {
    const historical = finding('brake-early', {
      corner: 2,
      sector: 1,
      zonePctStart: 0.205,
      zonePctEnd: 0.255,
      confidence: 0.95
    })
    const historyEvidence = buildRacecraftHistoryEvidence(DRY_IDENTITY, [
      historyLap('1', DRY_IDENTITY, [historical]),
      historyLap('2', DRY_IDENTITY, [historical]),
      historyLap('3', DRY_IDENTITY, [historical])
    ])
    const advice = safeAdvice('overtake', {
      condition: 'dry',
      historyEvidence,
      findings: [
        finding('brake-late', {
          corner: 2,
          sector: 1,
          zonePctStart: 0.21,
          zonePctEnd: 0.25,
          confidence: 0.8
        })
      ],
      currentGapAheadSec: 0.8
    })

    expect(advice.items).toHaveLength(1)
    expect(advice.items[0]).toMatchObject({ kind: 'brake-late', source: 'current-lap' })
    expect(advice.text).toContain('brake a touch earlier')
    expect(advice.text).not.toContain('brake later')
  })

  it('does not claim an identical reference value is an improvement target', () => {
    const advice = safeAdvice('overtake', {
      findings: [
        finding('brake-early', {
          corner: 2,
          phase: 'entry',
          metrics: { brakeStartPct: 0.42 }
        })
      ],
      cornerMetrics: [{ corner: 2, entrySpeedKmh: 180, minSpeedKmh: 90, brakeStartPct: 0.42 }],
      reference: {
        corners: [{ corner: 2, entrySpeedKmh: 180, minSpeedKmh: 90, brakeStartPct: 0.42 }]
      },
      currentGapAheadSec: 0.8
    })

    expect(advice.items[0].evidence.referenceBrakePointPct).toBeUndefined()
    expect(advice.items[0].evidence.referenceSource).toBeUndefined()
    expect(advice.items[0].text).not.toContain(' vs ')
    expect(advice.items[0].action).not.toContain('reference')
  })

  it('keeps deterministic advice and caveats localized and capped in every app language', () => {
    const copy: Record<CoachAdviceLanguage, { overtake: string; defend: string; caveat: string }> = {
      'en-US': { overtake: 'OVERTAKE', defend: 'DEFEND', caveat: 'opponent controls are unavailable' },
      'pt-BR': { overtake: 'ULTRAPASSAGEM', defend: 'DEFESA', caveat: 'controles do rival não estão disponíveis' },
      es: { overtake: 'ADELANTAMIENTO', defend: 'DEFENSA', caveat: 'controles del rival no están disponibles' },
      fr: { overtake: 'DÉPASSEMENT', defend: 'DÉFENSE', caveat: 'commandes du rival ne sont pas disponibles' },
      de: { overtake: 'ÜBERHOLEN', defend: 'VERTEIDIGEN', caveat: 'Eingaben des Gegners sind nicht verfügbar' },
      zh: { overtake: '超车', defend: '防守', caveat: '无法获取对手的刹车' },
      ja: { overtake: 'オーバーテイク', defend: 'ディフェンス', caveat: '相手のブレーキ' }
    }
    for (const language of Object.keys(copy) as CoachAdviceLanguage[]) {
      const advice = safeAdvice(
        'overtake',
        {
          currentGapAheadSec: 0.8,
          findings: [
            finding('brake-late', { corner: 1, zonePctStart: 0.1, zonePctEnd: 0.14 }),
            finding('throttle-late', { corner: 2, zonePctStart: 0.3, zonePctEnd: 0.34 }),
            finding('steering-late', { corner: 3, zonePctStart: 0.5, zonePctEnd: 0.54 }),
            finding('coast', { corner: 4, zonePctStart: 0.7, zonePctEnd: 0.74 })
          ]
        },
        { language }
      )
      const defend = safeAdvice(
        'pull-away',
        {
          currentGapBehindSec: 0.8,
          findings: [finding('throttle-late', { corner: 2, phase: 'exit' })]
        },
        { language }
      )
      expect(advice.text).toContain(copy[language].overtake)
      expect(defend.text).toContain(copy[language].defend)
      expect(advice.text).toContain(copy[language].caveat)
      expect(defend.text).toContain(copy[language].caveat)
      expect(advice.text.length).toBeLessThanOrEqual(MAX_RACECRAFT_ADVICE_LENGTH)
      expect(defend.text.length).toBeLessThanOrEqual(MAX_RACECRAFT_ADVICE_LENGTH)
      expect(advice.speechText.length).toBeLessThanOrEqual(MAX_RACECRAFT_SPEECH_LENGTH)
      expect(defend.speechText.length).toBeLessThanOrEqual(MAX_RACECRAFT_SPEECH_LENGTH)
      expect(advice.speechItemCount).toBeLessThanOrEqual(2)
      expect(defend.speechItemCount).toBeLessThanOrEqual(2)
      expect(advice.honestyNote.length).toBeGreaterThan(10)
      expect(advice.items.length).toBeGreaterThan(0)
    }
  })
})

describe('qualifying comparable history', () => {
  it('separates dry, wet, intermediate, and drying conditions deterministically', () => {
    expect(classifyCoachTrackCondition({})).toBe('unknown')
    expect(classifyCoachTrackCondition({ isRaining: false })).toBe('unknown')
    expect(
      classifyCoachTrackCondition({
        isRaining: false,
        previousTrackWetnessPct: 0.7
      })
    ).toBe('unknown')
    expect(
      classifyCoachTrackCondition({
        isRaining: false,
        weatherDeclaredWet: false
      })
    ).toBe('unknown')
    expect(classifyCoachTrackCondition({ trackWetnessPct: 0, isRaining: false })).toBe('dry')
    expect(classifyCoachTrackCondition({ trackWetnessPct: 0.2, isRaining: true })).toBe('intermediate')
    expect(classifyCoachTrackCondition({ trackWetnessPct: 0.75, isRaining: true })).toBe('wet')
    expect(
      classifyCoachTrackCondition({
        trackWetnessPct: 0.2,
        previousTrackWetnessPct: 0.35,
        isRaining: false
      })
    ).toBe('drying')
  })

  it('uses only valid laps in the same dry/wet condition', () => {
    const wet = { ...DRY_IDENTITY, condition: 'wet' as const }
    const laps = [
      historyLap('dry-valid', DRY_IDENTITY, [finding('brake-early')]),
      historyLap('dry-invalid', DRY_IDENTITY, [finding('brake-early')], { valid: false }),
      historyLap('wet-valid', wet, [finding('throttle-late')])
    ]

    expect(comparableCoachLaps(DRY_IDENTITY, laps).map((lap) => lap.id)).toEqual(['dry-valid'])
    expect(comparableCoachLaps(wet, laps).map((lap) => lap.id)).toEqual(['wet-valid'])
  })

  it('excludes drag and other non-race modes from coaching history', () => {
    expect(isCoachHistorySessionKind('practice')).toBe(true)
    expect(isCoachHistorySessionKind('qualify')).toBe(true)
    expect(isCoachHistorySessionKind('race')).toBe(true)
    for (const kind of ['hotlap', 'time-attack', 'drift', 'drag', 'other', 'warmup'] as const) {
      expect(isCoachHistorySessionKind(kind)).toBe(false)
    }
    const nonRaceLaps = (['hotlap', 'time-attack', 'drift', 'drag'] as const).map((kind, index) =>
      historyLap(`non-race-${index}`, DRY_IDENTITY, [finding('brake-early')], {
        sessionKind: kind
      })
    )
    expect(comparableCoachLaps(DRY_IDENTITY, nonRaceLaps)).toEqual([])
  })

  it('builds history evidence without leaking wet laps into a dry plan', () => {
    const wet = { ...DRY_IDENTITY, condition: 'wet' as const }
    const dryFinding = finding('brake-early', { corner: 2, phase: 'entry' })
    const wetFinding = finding('throttle-late', { corner: 9, phase: 'exit' })
    const evidence = buildRacecraftHistoryEvidence(DRY_IDENTITY, [
      historyLap('dry-1', DRY_IDENTITY, [dryFinding]),
      historyLap('dry-2', DRY_IDENTITY, [dryFinding]),
      historyLap('dry-3', DRY_IDENTITY, [dryFinding]),
      historyLap('wet-1', wet, [wetFinding]),
      historyLap('wet-2', wet, [wetFinding]),
      historyLap('wet-3', wet, [wetFinding])
    ])

    expect(evidence.comparableLapCount).toBe(3)
    expect(evidence.sufficientHistory).toBe(true)
    expect(evidence.patterns.map((pattern) => pattern.finding.corner)).toEqual([2])
  })

  it('does not promote a one-off historical mistake as a recurring racecraft pattern', () => {
    const evidence = buildRacecraftHistoryEvidence(DRY_IDENTITY, [
      historyLap('1', DRY_IDENTITY, [finding('brake-early', { corner: 2 })]),
      historyLap('2', DRY_IDENTITY, []),
      historyLap('3', DRY_IDENTITY, [])
    ])
    const advice = safeAdvice('overtake', {
      condition: 'dry',
      historyEvidence: evidence,
      currentGapAheadSec: 0.8
    })

    expect(evidence.comparableLapCount).toBe(3)
    expect(evidence.patterns).toEqual([])
    expect(advice.evidenceSource).toBe('none')
    expect(advice.text).toContain('No recurring high-confidence player loss')
  })

  it('allows providers without config while separating known layouts and identities', () => {
    const exact = historyLap('exact', DRY_IDENTITY, [])
    const accIdentity = {
      ...DRY_IDENTITY,
      trackId: 'monza',
      trackName: 'monza',
      trackConfigName: undefined
    }
    const changed = [
      historyLap('track', { ...DRY_IDENTITY, trackName: 'Spa' }, []),
      historyLap('sim', { ...DRY_IDENTITY, sim: 'acc' }, []),
      historyLap('config', { ...DRY_IDENTITY, trackConfigName: 'Moto' }, []),
      historyLap('config-missing', { ...DRY_IDENTITY, trackConfigName: undefined }, []),
      historyLap('car', { ...DRY_IDENTITY, carPath: 'gt4', carName: 'GT4', carClassId: 8 }, []),
      historyLap('ambient', { ...DRY_IDENTITY, airTempC: 35, trackTempC: 50 }, []),
      historyLap('ambient-missing', { ...DRY_IDENTITY, airTempC: undefined }, [])
    ]

    expect(areCoachLapsComparable(DRY_IDENTITY, exact.identity)).toBe(true)
    expect(comparableCoachLaps(DRY_IDENTITY, [exact, ...changed]).map((lap) => lap.id)).toEqual(['exact'])
    expect(areCoachLapsComparable(accIdentity, { ...accIdentity })).toBe(true)
    expect(
      areCoachLapsComparable(
        { ...accIdentity, trackName: 'Monza', trackId: 77 },
        { ...accIdentity, trackName: 'Autodromo Nazionale Monza', trackId: 77 }
      )
    ).toBe(true)
    expect(
      areCoachLapsComparable(
        { ...accIdentity, trackConfigName: 'Grand Prix' },
        { ...accIdentity, trackConfigName: 'Sprint' }
      )
    ).toBe(false)
    expect(
      areCoachLapsComparable(
        { ...accIdentity, trackConfigName: 'Grand Prix' },
        accIdentity
      )
    ).toBe(false)
  })

  it('summarizes recurring losses only when comparable history is sufficient', () => {
    const recurring = finding('throttle-late', {
      corner: 7,
      sector: 2,
      phase: 'exit',
      estTimeLossSec: 0.24
    })
    const history = [
      historyLap('1', DRY_IDENTITY, [recurring]),
      historyLap('2', DRY_IDENTITY, [recurring]),
      historyLap('3', DRY_IDENTITY, [recurring])
    ]
    const summary = buildQualiStartSummary({ current: DRY_IDENTITY, history })

    expect(summary.sufficientHistory).toBe(true)
    expect(summary.source).toBe('history')
    expect(summary.items[0]).toMatchObject({ corner: 7, lapsSeen: 3, lapsCompared: 3 })
    expect(summary.text).toContain('player dry history, 3 comparable completed laps')
    expect(summary.text).toContain('3/3 laps')
    expect(summary.text.length).toBeLessThanOrEqual(MAX_QUALI_BRIEFING_LENGTH)
  })

  it('plainly reports sparse history without promoting current-session evidence', () => {
    const summary = buildQualiStartSummary({
      current: DRY_IDENTITY,
      history: [historyLap('1', DRY_IDENTITY, [finding('brake-early')])],
      currentSession: [
        historyLap('current', DRY_IDENTITY, [
          finding('steering-late', { corner: 4, sector: 2, estTimeLossSec: 0.18 })
        ])
      ]
    })

    expect(summary.sufficientHistory).toBe(false)
    expect(summary.source).toBe('none')
    expect(summary.items).toEqual([])
    expect(summary.insufficientReason).toBe('laps')
    expect(summary.text).toContain('insufficient dry history (1/3 completed laps)')
    expect(summary.text).toContain('no personalized briefing')
  })

  it('does not classify unknown conditions or incomplete identity as personalized history', () => {
    const unknownCondition = buildQualiStartSummary({
      current: { ...DRY_IDENTITY, condition: 'unknown' },
      history: [
        historyLap('1', DRY_IDENTITY, [finding('brake-early', { corner: 2 })]),
        historyLap('2', DRY_IDENTITY, [finding('brake-early', { corner: 2 })]),
        historyLap('3', DRY_IDENTITY, [finding('brake-early', { corner: 2 })])
      ]
    })
    const unknownTrack = buildQualiStartSummary({
      current: { ...DRY_IDENTITY, trackName: undefined, trackId: undefined },
      history: []
    })

    expect(unknownCondition).toMatchObject({
      sufficientHistory: false,
      comparableLapCount: 0,
      source: 'none',
      items: []
    })
    expect(unknownCondition.text).toContain('track condition unknown')
    expect(unknownCondition.text).toContain('dry and wet history remain separate')
    expect(unknownCondition.text).not.toContain('Turn 2')
    expect(unknownTrack.text).toContain('track or car identity is unavailable')
  })

  it('rejects 1/1 and 2/120 as recurring history evidence', () => {
    const recurring = finding('brake-early', { corner: 2, confidence: 0.95 })
    const oneLap = buildRacecraftHistoryEvidence(DRY_IDENTITY, [
      historyLap('1', DRY_IDENTITY, [recurring])
    ])
    const sparseOccurrence = buildRacecraftHistoryEvidence(
      DRY_IDENTITY,
      Array.from({ length: 120 }, (_, index) =>
        historyLap(
          String(index + 1),
          DRY_IDENTITY,
          index < 2 ? [recurring] : []
        )
      )
    )

    expect(oneLap).toMatchObject({
      comparableLapCount: 1,
      sufficientHistory: false,
      patterns: []
    })
    expect(sparseOccurrence).toMatchObject({
      comparableLapCount: 120,
      sufficientHistory: true,
      patterns: []
    })
    const oneLapAdvice = safeAdvice('overtake', {
      condition: 'dry',
      historyEvidence: oneLap,
      currentGapAheadSec: 0.8
    })
    expect(oneLapAdvice.text).toContain('Insufficient evidence: 1/3 comparable completed laps')
    const summary = buildQualiStartSummary({
      current: DRY_IDENTITY,
      history: Array.from({ length: 120 }, (_, index) =>
        historyLap(String(index + 1), DRY_IDENTITY, index < 2 ? [recurring] : [])
      )
    })
    expect(summary.items).toEqual([])
    expect(summary.insufficientReason).toBe('confidence')
    expect(summary.text).toContain('No recurring high-confidence loss')
  })

  it('rejects frequent but low-confidence history patterns', () => {
    const lowConfidence = finding('throttle-late', {
      corner: 7,
      phase: 'exit',
      confidence: 0.4
    })
    const history = [
      historyLap('1', DRY_IDENTITY, [lowConfidence]),
      historyLap('2', DRY_IDENTITY, [lowConfidence]),
      historyLap('3', DRY_IDENTITY, [lowConfidence])
    ]

    expect(buildRacecraftHistoryEvidence(DRY_IDENTITY, history).patterns).toEqual([])
    const summary = buildQualiStartSummary({ current: DRY_IDENTITY, history })
    expect(summary.items).toEqual([])
    expect(summary.insufficientReason).toBe('confidence')
  })

  it('keeps missing-validity history explicitly unverified and out of clean benchmarks', () => {
    const recurring = finding('throttle-late', {
      corner: 7,
      phase: 'exit',
      confidence: 0.9
    })
    const history = [1, 2, 3].map((id) =>
      historyLap(String(id), DRY_IDENTITY, [recurring], {
        verification: 'unverified',
        lapTimeSec: 90 - id,
        cornerMetrics: [
          {
            corner: 7,
            entrySpeedKmh: 190,
            minSpeedKmh: 90,
            exitSpeedKmh: 140,
            throttleStartPct: 0.55
          }
        ]
      })
    )
    const evidence = buildRacecraftHistoryEvidence(DRY_IDENTITY, history)
    expect(evidence).toMatchObject({
      comparableLapCount: 3,
      verifiedLapCount: 0,
      unverifiedLapCount: 3,
      patterns: [],
      reference: undefined
    })
    const summary = buildQualiStartSummary({ current: DRY_IDENTITY, history })
    expect(summary.unverifiedLapCount).toBe(3)
    expect(summary.text).toContain('unverified')
  })

  it('stays neutral for tied opposite directional history regardless of insertion order', () => {
    const early = finding('brake-early', {
      corner: 2,
      zonePctStart: 0.2,
      zonePctEnd: 0.25,
      confidence: 0.9,
      estTimeLossSec: 0.2
    })
    const late = finding('brake-late', {
      corner: 2,
      zonePctStart: 0.2,
      zonePctEnd: 0.25,
      confidence: 0.9,
      estTimeLossSec: 0.2
    })
    const orders = [
      [early, early, late, late],
      [late, late, early, early]
    ]

    for (const order of orders) {
      const history = order.map((direction, index) =>
        historyLap(String(index + 1), DRY_IDENTITY, [direction])
      )
      expect(buildRacecraftHistoryEvidence(DRY_IDENTITY, history).patterns).toEqual([])
      const summary = buildQualiStartSummary({ current: DRY_IDENTITY, history })
      expect(summary.items).toEqual([])
      expect(summary.text).not.toMatch(/brake (?:earlier|later)/i)
    }
  })

  it('attributes history once, limits useful points, and caps qualifying speech', () => {
    const findings = [
      finding('brake-late', { corner: 1, zonePctStart: 0.1, zonePctEnd: 0.14 }),
      finding('throttle-late', { corner: 2, zonePctStart: 0.3, zonePctEnd: 0.34 }),
      finding('steering-late', { corner: 3, zonePctStart: 0.5, zonePctEnd: 0.54 })
    ]
    const summary = buildQualiStartSummary({
      current: DRY_IDENTITY,
      history: [
        historyLap('1', DRY_IDENTITY, findings),
        historyLap('2', DRY_IDENTITY, findings),
        historyLap('3', DRY_IDENTITY, findings)
      ]
    })

    expect(summary.items.length).toBeLessThanOrEqual(2)
    expect(summary.text.length).toBeLessThanOrEqual(MAX_QUALI_BRIEFING_LENGTH)
    expect(summary.text.match(/history/gi)).toHaveLength(1)
  })

  it('localizes sparse qualifying briefings in every app language', () => {
    const labels: Record<CoachAdviceLanguage, string> = {
      'en-US': 'QUALIFY',
      'pt-BR': 'QUALI',
      es: 'CLASIFICACIÓN',
      fr: 'QUALIFICATIONS',
      de: 'QUALIFYING',
      zh: '排位赛',
      ja: '予選'
    }
    for (const language of Object.keys(labels) as CoachAdviceLanguage[]) {
      const summary = buildQualiStartSummary({
        current: DRY_IDENTITY,
        history: [historyLap('1', DRY_IDENTITY, [finding('brake-early')])],
        language
      })
      expect(summary.text).toContain(labels[language])
      expect(summary.items).toEqual([])
      expect(summary.text.length).toBeLessThanOrEqual(MAX_QUALI_BRIEFING_LENGTH)
    }
  })
})
