import type { ReactElement } from 'react'
import type { AppViewProps } from '../App'
import ObsLocalPanel from '../components/ObsLocalPanel'
import StreamingPanel from '../components/StreamingPanel'

export default function StreamingView({ language }: AppViewProps): ReactElement {
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1120 }}>
      <StreamingPanel language={language} />
      <ObsLocalPanel language={language} />
    </div>
  )
}
