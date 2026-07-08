export interface CarFamily {
  id: 'woking' | 'maranello' | 'gaydon' | 'stuttgart' | 'bowtie' | 'affalterbach' | 'ingolstadt' | 'prototype'
  codename: string
  displayName: string
  palette: {
    bg: string
    accent: string
    warn: string
    danger: string
    good: string
    text: string
  }
  brandStyle: 'generic' | 'stuttgart' | 'bavaria' | 'maranello'
  class: 'gt3' | 'prototype'
}

export const CAR_FAMILIES: CarFamily[] = [
  {
    id: 'woking',
    codename: 'woking',
    displayName: 'Woking GT3',
    palette: { bg: '#050607', accent: '#E87818', warn: '#FFB23F', danger: '#E43D2E', good: '#25D66D', text: '#F2F5F7' },
    brandStyle: 'generic',
    class: 'gt3'
  },
  {
    id: 'maranello',
    codename: 'maranello',
    displayName: 'Maranello GT3',
    palette: { bg: '#090505', accent: '#C84224', warn: '#F2A03A', danger: '#FF2F2F', good: '#24D36A', text: '#F8F1EC' },
    brandStyle: 'maranello',
    class: 'gt3'
  },
  {
    id: 'gaydon',
    codename: 'gaydon',
    displayName: 'Gaydon GT3',
    palette: { bg: '#050908', accent: '#B8733A', warn: '#E5A84A', danger: '#D43A30', good: '#2FD07A', text: '#EEF6F2' },
    brandStyle: 'generic',
    class: 'gt3'
  },
  {
    id: 'stuttgart',
    codename: 'stuttgart',
    displayName: 'Stuttgart GT3',
    palette: { bg: '#070707', accent: '#D0A43A', warn: '#F2B84B', danger: '#E04431', good: '#26CF72', text: '#F5F2EA' },
    brandStyle: 'stuttgart',
    class: 'gt3'
  },
  {
    id: 'bowtie',
    codename: 'bowtie',
    displayName: 'Bowtie GT3',
    palette: { bg: '#060709', accent: '#D89024', warn: '#FFC65A', danger: '#D83A2C', good: '#24D169', text: '#F4F6F8' },
    brandStyle: 'generic',
    class: 'gt3'
  },
  {
    id: 'affalterbach',
    codename: 'affalterbach',
    displayName: 'Affalterbach GT3',
    palette: { bg: '#060606', accent: '#CFC6B5', warn: '#D9A547', danger: '#DD3A32', good: '#2CD170', text: '#F3F1EC' },
    brandStyle: 'generic',
    class: 'gt3'
  },
  {
    id: 'ingolstadt',
    codename: 'ingolstadt',
    displayName: 'Ingolstadt GT3',
    palette: { bg: '#05070A', accent: '#D8583B', warn: '#F0AA42', danger: '#E2382E', good: '#20D477', text: '#EDF4F8' },
    brandStyle: 'generic',
    class: 'gt3'
  },
  {
    id: 'prototype',
    codename: 'prototype',
    displayName: 'Prototype Endurance',
    palette: { bg: '#03070B', accent: '#D49A2C', warn: '#F2B84B', danger: '#E03C31', good: '#20D67A', text: '#EEF7FF' },
    brandStyle: 'generic',
    class: 'prototype'
  }
]
