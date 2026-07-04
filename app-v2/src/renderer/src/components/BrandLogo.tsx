import type { ReactElement } from 'react'

interface BrandLogoProps {
  size?: number
  title?: string
}

// Original abstract "speed apex" mark for Ultimate Sim App.
// A bold forward apex chevron with two trailing slipstream lines — reads as
// velocity/motion without copying any real motorsport brand. Strokes use
// `currentColor`, so the logo inherits whatever accent the active theme sets on
// `.brand-mark` (it re-colours automatically across every app theme).
export function BrandLogo({ size = 24, title = 'Ultimate Sim App' }: BrandLogoProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      {/* slipstream / speed lines */}
      <path d="M6 14.5H17.5" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" opacity={0.5} />
      <path d="M6 25.5H14.5" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" opacity={0.32} />
      {/* main forward apex chevron */}
      <path
        d="M15 7.5L30.5 20L15 32.5"
        stroke="currentColor"
        strokeWidth={4.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default BrandLogo
