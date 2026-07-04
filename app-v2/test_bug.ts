import { variantRequiredField, variantSupportedSims } from './src/renderer/src/views/dashboard/widget-catalog-data'

const variant = { binding: 'ir:EngineWarnings' }
console.log('required field:', variantRequiredField(variant as any))
console.log('supported sims:', variantSupportedSims(variant as any))
