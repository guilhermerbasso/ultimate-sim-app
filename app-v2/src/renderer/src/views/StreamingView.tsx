import type { ReactElement } from 'react'
import type { AppViewProps } from '../App'
import StreamingPanel from '../components/StreamingPanel'

export default function StreamingView({ language }: AppViewProps): ReactElement {
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1120 }}>
      <StreamingPanel language={language} />
    </div>
  )
}
