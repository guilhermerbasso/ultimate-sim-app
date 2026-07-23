import { EventEmitter } from 'node:events'

class StreamSourceRegistryEvents extends EventEmitter {
  emitChanged(): void {
    this.emit('changed')
  }

  onChanged(listener: () => void): () => void {
    this.on('changed', listener)
    return () => this.off('changed', listener)
  }
}

export const streamSourceRegistryEvents = new StreamSourceRegistryEvents()
