import { type ReactElement } from 'react'
import packageJson from '../../../../package.json'

type CreditItem = {
  name: string
  license: string
  note: string
}

const LIBRARIES: CreditItem[] = [
  { name: 'bonjour-service', license: 'MIT', note: 'Descoberta de serviços na rede local.' },
  { name: 'koffi', license: 'MIT', note: 'FFI para integrações nativas.' },
  { name: 'React', license: 'MIT', note: 'UI renderer.' },
  { name: 'React DOM', license: 'MIT', note: 'Renderização DOM.' },
  { name: 'serialport', license: 'MIT', note: 'Comunicação serial com hardware.' },
  { name: 'unzipper', license: 'MIT', note: 'Leitura de pacotes ZIP.' },
  { name: 'yaml', license: 'ISC', note: 'Parsing e escrita YAML.' },
  { name: 'ws', license: 'MIT', note: 'WebSocket client/server.' }
]

const FONTS: CreditItem[] = [
  { name: 'Rajdhani', license: 'SIL OFL 1.1', note: 'Tipografia de interface e títulos.' },
  { name: 'Instrument Sans', license: 'SIL OFL 1.1', note: 'Texto de interface.' },
  { name: 'Barlow Condensed', license: 'SIL OFL 1.1', note: 'Headlines compactas.' },
  { name: 'IBM Plex Mono', license: 'SIL OFL 1.1', note: 'Dados técnicos e código.' },
  { name: 'Michroma', license: 'SIL OFL 1.1', note: 'Display futurista.' },
  { name: 'Chakra Petch', license: 'SIL OFL 1.1', note: 'Labels racing.' },
  { name: 'DSEG', license: 'SIL OFL 1.1', note: 'Displays digitais DSEG7 e DSEG14.' }
]

const TOOLS: CreditItem[] = [
  { name: 'avrdude', license: 'GNU GPL v2', note: 'Upload de firmware para placas AVR.' }
]

function CreditSection({ items, title }: { items: CreditItem[]; title: string }): ReactElement {
  return (
    <section className="panel-card" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {title}
        </h2>
        <span className="field-label" style={{ margin: 0 }}>{items.length} itens</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {items.map((item) => (
          <article
            key={item.name}
            className="mode-card"
            style={{
              display: 'grid',
              gap: 8,
              alignContent: 'start',
              minHeight: 126,
              borderColor: 'var(--border-default)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'start' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{item.name}</strong>
              <span
                style={{
                  padding: '3px 7px',
                  borderRadius: '999px',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--accent-primary)',
                  background: 'var(--accent-primary-dim)',
                  fontSize: 11,
                  whiteSpace: 'nowrap'
                }}
              >
                {item.license}
              </span>
            </div>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.45 }}>{item.note}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

export default function AboutView(): ReactElement {
  const appName = packageJson.name
  const appVersion = packageJson.version

  return (
    <div style={{ display: 'grid', gap: 16, minHeight: 0 }}>
      <section
        className="panel-card"
        style={{
          position: 'relative',
          overflow: 'hidden',
          display: 'grid',
          gap: 16,
          padding: 24,
          borderColor: 'var(--border-strong)',
          background:
            'linear-gradient(135deg, var(--surface-raised), color-mix(in srgb, var(--accent-primary) 12%, var(--surface-base)))'
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 'auto -60px -100px auto',
            width: 220,
            height: 220,
            borderRadius: '999px',
            background: 'radial-gradient(circle, var(--accent-primary) 0%, transparent 62%)',
            opacity: 0.18
          }}
        />
        <div style={{ position: 'relative', display: 'grid', gap: 8 }}>
          <span className="field-label" style={{ margin: 0 }}>Sobre / Créditos</span>
          <h1 style={{ margin: 0, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 42, letterSpacing: '0.04em' }}>
            {appName}
          </h1>
          <p style={{ margin: 0, color: 'var(--text-secondary)', maxWidth: 760, lineHeight: 1.6 }}>
            Versão {appVersion}. Este app usa componentes open-source, fontes redistribuíveis e ferramentas de firmware.
            Os textos completos ficam em <code>THIRD-PARTY-LICENSES.md</code> e em <code>src/renderer/src/assets/fonts/LICENSES/</code>.
          </p>
        </div>
      </section>

      <CreditSection title="Bibliotecas de produção" items={LIBRARIES} />
      <CreditSection title="Fontes bundled" items={FONTS} />
      <CreditSection title="Ferramentas bundled" items={TOOLS} />

      <section className="panel-card" style={{ display: 'grid', gap: 8 }}>
        <span className="field-label" style={{ margin: 0 }}>Compliance</span>
        <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          DSEG7Classic-Regular.ttf e DSEG14Classic-Regular.ttf foram obtidas do release oficial keshikan/DSEG
          e distribuídas sob SIL OFL 1.1. avrdude é redistribuído sob GPL v2 com link/oferta de código-fonte
          documentados no arquivo de licenças de terceiros.
        </p>
      </section>
    </div>
  )
}
