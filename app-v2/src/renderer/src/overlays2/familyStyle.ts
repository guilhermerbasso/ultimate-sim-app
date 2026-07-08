import { INSTRUMENT_COLORS, type InstrumentColors } from '../instruments/tokens'
import { OVERLAY_DESIGN_FAMILIES, type OverlayDesignFamily } from '../../../shared/overlays'

export interface Overlay2FamilyStyle {
  colors: Partial<InstrumentColors>
  gap: number
  radius: number
  padding: number
  fontFamily: string
  background: string
  border: string
  boxShadow: string
  widgetMinHeight: number
}

export const OVERLAY2_FAMILY_STYLES: Record<OverlayDesignFamily, Overlay2FamilyStyle> = {
  minimal: {
    colors: {
      ...INSTRUMENT_COLORS,
      accent: '#D78A2D',
      chrome: '#B8A17A',
      surface: '#08090A',
      recess: '#020303',
      stroke: '#2B2F34',
      strokeHot: '#A45A23',
      text: '#F5F1E8',
      textDim: '#A9A196',
      textMuted: '#625C54'
    },
    gap: 8,
    radius: 10,
    padding: 10,
    fontFamily: "'Rajdhani', 'Barlow Condensed', sans-serif",
    background: 'rgba(4, 5, 6, 0.88)',
    border: '1px solid rgba(184, 161, 122, 0.24)',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.42)',
    widgetMinHeight: 92
  },
  neon: {
    colors: {
      ...INSTRUMENT_COLORS,
      good: '#41F27A',
      warn: '#FFB02E',
      danger: '#FF3048',
      flash: '#FFFFFF',
      chrome: '#FF7A1A',
      accent: '#FF5A1F',
      surface: '#05030B',
      recess: '#010105',
      stroke: '#3B244E',
      strokeHot: '#FF7A1A',
      text: '#FFF7EC',
      textDim: '#D79A72',
      textMuted: '#7C4D48'
    },
    gap: 10,
    radius: 16,
    padding: 12,
    fontFamily: "'Michroma', 'Rajdhani', sans-serif",
    background: 'linear-gradient(135deg, rgba(9, 4, 24, 0.94), rgba(18, 5, 13, 0.9))',
    border: '1px solid rgba(255, 122, 26, 0.42)',
    boxShadow: '0 0 26px rgba(255, 90, 31, 0.24)',
    widgetMinHeight: 98
  },
  glass: {
    colors: {
      ...INSTRUMENT_COLORS,
      good: '#55D778',
      warn: '#E9A43A',
      danger: '#EF3F48',
      chrome: '#D7C4A7',
      accent: '#C9813A',
      surface: '#12171C',
      recess: '#06090C',
      stroke: '#46515C',
      strokeHot: '#D9B071',
      text: '#F7FAFC',
      textDim: '#B8C0C8',
      textMuted: '#7D8790'
    },
    gap: 12,
    radius: 18,
    padding: 14,
    fontFamily: "'Chakra Petch', 'Rajdhani', sans-serif",
    background: 'rgba(18, 23, 28, 0.66)',
    border: '1px solid rgba(215, 196, 167, 0.32)',
    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 18px 42px rgba(0, 0, 0, 0.38)',
    widgetMinHeight: 104
  },
  broadcast: {
    colors: {
      ...INSTRUMENT_COLORS,
      good: '#2FC36B',
      warn: '#F2A900',
      danger: '#D71920',
      chrome: '#C9A45D',
      accent: '#E06C22',
      surface: '#101010',
      recess: '#050505',
      stroke: '#3A3024',
      strokeHot: '#F2A900',
      text: '#FFFFFF',
      textDim: '#D6D6D6',
      textMuted: '#8A8A8A'
    },
    gap: 6,
    radius: 6,
    padding: 8,
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    background: 'linear-gradient(180deg, rgba(22, 22, 22, 0.96), rgba(5, 5, 5, 0.96))',
    border: '2px solid rgba(201, 164, 93, 0.38)',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
    widgetMinHeight: 86
  },
  terminal: {
    colors: {
      ...INSTRUMENT_COLORS,
      good: '#34D866',
      warn: '#DFA128',
      danger: '#D84A3A',
      chrome: '#A36B31',
      accent: '#C2762B',
      surface: '#030604',
      recess: '#000000',
      stroke: '#174425',
      strokeHot: '#DFA128',
      text: '#B9FFC9',
      textDim: '#6EC982',
      textMuted: '#3C7F4D'
    },
    gap: 5,
    radius: 4,
    padding: 8,
    fontFamily: "'Cascadia Code', 'DSEG14Classic-Regular', monospace",
    background: 'rgba(0, 8, 3, 0.94)',
    border: '1px solid rgba(52, 216, 102, 0.32)',
    boxShadow: 'inset 0 0 24px rgba(52, 216, 102, 0.08)',
    widgetMinHeight: 82
  },
  bauhaus: {
    colors: {
      ...INSTRUMENT_COLORS,
      good: '#22B65F',
      warn: '#E1A11A',
      danger: '#C93024',
      chrome: '#CF8F35',
      accent: '#D95F19',
      surface: '#F1E7D2',
      recess: '#201915',
      stroke: '#1B1B1B',
      strokeHot: '#D95F19',
      text: '#151515',
      textDim: '#4F463D',
      textMuted: '#837262'
    },
    gap: 11,
    radius: 2,
    padding: 12,
    fontFamily: "'Michroma', 'Chakra Petch', sans-serif",
    background: 'linear-gradient(135deg, rgba(241, 231, 210, 0.96), rgba(229, 207, 171, 0.95))',
    border: '3px solid rgba(27, 27, 27, 0.9)',
    boxShadow: '8px 8px 0 rgba(217, 95, 25, 0.35)',
    widgetMinHeight: 96
  },
  analog: {
    colors: {
      ...INSTRUMENT_COLORS,
      good: '#56C46E',
      warn: '#C88A2A',
      danger: '#B92A25',
      chrome: '#A68A63',
      accent: '#B36B2D',
      surface: '#0B0907',
      recess: '#020201',
      stroke: '#4A3B2B',
      strokeHot: '#D6B37A',
      bezel: '#4C443A',
      bezelHi: '#8E806B',
      bezelLo: '#15120F',
      text: '#F0E1C5',
      textDim: '#B8A583',
      textMuted: '#6E604D'
    },
    gap: 14,
    radius: 22,
    padding: 14,
    fontFamily: "'Rajdhani', Georgia, serif",
    background: 'radial-gradient(circle at 50% 10%, rgba(48, 39, 28, 0.94), rgba(8, 7, 6, 0.96))',
    border: '1px solid rgba(166, 138, 99, 0.52)',
    boxShadow: 'inset 0 0 26px rgba(214, 179, 122, 0.08), 0 16px 34px rgba(0, 0, 0, 0.5)',
    widgetMinHeight: 112
  },
  heatmap: {
    colors: {
      ...INSTRUMENT_COLORS,
      good: '#19B95C',
      warn: '#FFB21A',
      danger: '#E7352D',
      flash: '#FFF8E8',
      chrome: '#E46D1C',
      accent: '#F28A24',
      surface: '#160805',
      recess: '#060201',
      stroke: '#5C2116',
      strokeHot: '#FFB21A',
      text: '#FFF1DD',
      textDim: '#E0A26F',
      textMuted: '#8F563E'
    },
    gap: 7,
    radius: 12,
    padding: 10,
    fontFamily: "'Chakra Petch', 'Cascadia Code', monospace",
    background: 'linear-gradient(90deg, rgba(22, 8, 5, 0.96), rgba(50, 13, 5, 0.9))',
    border: '1px solid rgba(242, 138, 36, 0.46)',
    boxShadow: '0 0 22px rgba(231, 53, 45, 0.14)',
    widgetMinHeight: 88
  }
}

export const OVERLAY2_FAMILIES: OverlayDesignFamily[] = [...OVERLAY_DESIGN_FAMILIES]

export function overlay2FamilyStyle(family: OverlayDesignFamily): Overlay2FamilyStyle {
  return OVERLAY2_FAMILY_STYLES[family]
}
