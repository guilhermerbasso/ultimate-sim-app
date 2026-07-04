// Ponte IPC genérica e tipada exposta como window.ipc. Permite que módulos novos
// registrem/consumam canais (com prefixo próprio) sem editar o preload.
export interface IpcBridge {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
  subscribe<T = unknown>(channel: string, callback: (payload: T) => void): () => void
}
