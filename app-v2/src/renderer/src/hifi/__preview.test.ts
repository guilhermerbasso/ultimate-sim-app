import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { it } from 'vitest'
import { baseSnapshot } from '../../../shared/telemetry-scenarios'
import { DduCluster } from './DduCluster'

// Temporary preview generator (not a real assertion): writes a standalone HTML with
// the DduCluster SVG at 1024x600 so a Playwright shot can be compared to the gpt-image
// reference during the image->build->QA loop.
it('writes a DDU cluster preview html', () => {
  const svg = renderToStaticMarkup(createElement(DduCluster, { snapshot: baseSnapshot() }))
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@600;700&family=Michroma&family=Rajdhani:wght@600;700&display=swap');
    html,body{margin:0;background:#000}
    #stage{width:1024px;height:600px}
    svg{display:block;width:1024px;height:600px}
  </style></head><body><div id="stage">${svg}</div></body></html>`
  const outDir = resolve(process.cwd(), 'visual-audit/hifi')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'ddu.html'), html)
})
