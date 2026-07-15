import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { STREAMING_EXPRESSION_EXCLUSION_MESSAGE } from '../../../shared/streaming'
import { StreamExpressionNotice } from './StreamOverlayRoot'

describe('stream dashboard expression handling', () => {
  it('visibly marks expression placements and values as excluded', () => {
    const html = renderToStaticMarkup(createElement(StreamExpressionNotice))

    expect(html).toContain('role="status"')
    expect(html).toContain('data-stream-expression-content="excluded"')
    expect(html).toContain(STREAMING_EXPRESSION_EXCLUSION_MESSAGE)
  })
})
