// Re-export from the shared module so main process code can import from here
// while the renderer imports from '../../shared/simhub'.
export { SIMHUB_CHANNELS } from '../../shared/simhub'
export type { SimHubChannel } from '../../shared/simhub'
