import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { it } from 'vitest'
import { baseSnapshot } from '../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { DduCluster } from './DduCluster'
import { EnduranceCluster } from './EnduranceCluster'
import { EngineerDash } from './EngineerDash'

function page(svg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@600;700&family=Michroma&family=Rajdhani:wght@600;700&display=swap');
    html,body{margin:0;background:#000}#stage{width:1024px;height:600px}svg{display:block;width:1024px;height:600px}
  </style></head><body><div id="stage">${svg}</div></body></html>`
}

it('writes hi-fi QA previews', () => {
  const outDir = resolve(process.cwd(), 'visual-audit/hifi')
  mkdirSync(outDir, { recursive: true })
  const base = baseSnapshot()
  const history: TelemetrySnapshot[] = Array.from({ length: 120 }, (_, i) => ({
    ...base,
    speedKmh: 120 + 90 * Math.abs(Math.sin(i / 12)),
    throttle: Math.max(0, Math.sin(i / 9)),
    brake: Math.max(0, -Math.sin(i / 9)),
    gear: 2 + (i % 5)
  }))
  writeFileSync(resolve(outDir, 'ddu.html'), page(renderToStaticMarkup(createElement(DduCluster, { snapshot: base }))))
  writeFileSync(resolve(outDir, 'endurance.html'), page(renderToStaticMarkup(createElement(EnduranceCluster, { snapshot: base }))))
  writeFileSync(resolve(outDir, 'engineer.html'), page(renderToStaticMarkup(createElement(EngineerDash, { snapshot: base, history }))))
})
