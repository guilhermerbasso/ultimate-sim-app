import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { OBS_LOCAL_REQUIRED_REQUESTS } from './contracts'
import { ObsLocalController } from './controller'
import { createObsAuthentication, ObsWebSocketV5Adapter } from './ws-adapter'

interface ObsServerFixture {
  endpoint: string
  port: number
  identifyMessages: Array<Record<string, unknown>>
  close(): Promise<void>
}

async function closeHttpServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose())
  })
}

async function createObsServer(options: {
  authentication: boolean
  password?: string
}): Promise<ObsServerFixture> {
  const httpServer = createServer()
  const webSocketServer = new WebSocketServer({ server: httpServer })
  const identifyMessages: Array<Record<string, unknown>> = []
  const salt = 'fixture-salt'
  const challenge = 'fixture-challenge'

  webSocketServer.on('connection', (socket) => {
    socket.send(JSON.stringify({
      op: 0,
      d: {
        obsWebSocketVersion: '5.6.0-fixture',
        rpcVersion: 1,
        ...(options.authentication ? { authentication: { salt, challenge } } : {})
      }
    }))
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as { op: number; d?: Record<string, unknown> }
      const data = message.d ?? {}
      if (message.op === 1) {
        identifyMessages.push(data)
        const expectedAuthentication = createObsAuthentication(options.password ?? '', salt, challenge)
        if (options.authentication && data.authentication !== expectedAuthentication) {
          socket.close(4009, 'Authentication Failed')
          return
        }
        socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }))
        return
      }
      if (message.op !== 6 || typeof data.requestId !== 'string' || typeof data.requestType !== 'string') return
      const responseData = data.requestType === 'GetVersion'
        ? {
            obsVersion: '31.0.0-fixture',
            obsWebSocketVersion: '5.6.0-fixture',
            availableRequests: [...OBS_LOCAL_REQUIRED_REQUESTS]
          }
        : data.requestType === 'GetCurrentProgramScene'
          ? { currentProgramSceneName: 'Race' }
          : {}
      socket.send(JSON.stringify({
        op: 7,
        d: {
          requestType: data.requestType,
          requestId: data.requestId,
          requestStatus: { result: true, code: 100 },
          responseData
        }
      }))
    })
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once('error', rejectListen)
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', rejectListen)
      resolveListen()
    })
  })
  const port = (httpServer.address() as AddressInfo).port
  return {
    endpoint: `ws://127.0.0.1:${port}`,
    port,
    identifyMessages,
    async close(): Promise<void> {
      for (const client of webSocketServer.clients) client.terminate()
      await new Promise<void>((resolveClose) => webSocketServer.close(() => resolveClose()))
      await closeHttpServer(httpServer)
    }
  }
}

describe('ObsWebSocketV5Adapter authentication', () => {
  it('fails closed when the OBS server omits its password authentication challenge', async () => {
    const fixture = await createObsServer({ authentication: false })
    const controller = new ObsLocalController({
      adapterFactory: () => new ObsWebSocketV5Adapter(),
      getTelemetry: () => null,
      autoHealth: false
    })
    try {
      const status = await controller.connect({
        host: '127.0.0.1',
        port: fixture.port,
        password: 'obs-secret',
        scenes: [{ sceneName: 'Race', sourceNames: ['Overlay'] }]
      })

      expect(status).toEqual(expect.objectContaining({
        state: 'error',
        health: 'offline',
        handshake: null,
        lastError: expect.stringMatching(/password authentication challenge required/i)
      }))
      expect(status.metrics.connectSuccesses).toBe(0)
      expect(fixture.identifyMessages).toEqual([])
    } finally {
      await controller.shutdown()
      await fixture.close()
    }
  })

  it('completes a normal password challenge with the derived authentication response', async () => {
    const fixture = await createObsServer({ authentication: true, password: 'obs-secret' })
    const adapter = new ObsWebSocketV5Adapter()
    try {
      const handshake = await adapter.connect({
        endpoint: fixture.endpoint,
        password: 'obs-secret',
        timeoutMs: 1_000
      })

      expect(handshake).toEqual(expect.objectContaining({
        rpcVersion: 1,
        obsVersion: '31.0.0-fixture',
        obsWebSocketVersion: '5.6.0-fixture'
      }))
      expect(handshake.availableRequests).toEqual(expect.arrayContaining([...OBS_LOCAL_REQUIRED_REQUESTS]))
      expect(fixture.identifyMessages).toEqual([
        expect.objectContaining({
          authentication: createObsAuthentication('obs-secret', 'fixture-salt', 'fixture-challenge')
        })
      ])
      expect(adapter.isConnected()).toBe(true)
    } finally {
      await adapter.disconnect()
      await fixture.close()
    }
  })

  it('rejects a normal password challenge when OBS closes the connection for bad credentials', async () => {
    const fixture = await createObsServer({ authentication: true, password: 'correct-secret' })
    const adapter = new ObsWebSocketV5Adapter()
    try {
      await expect(adapter.connect({
        endpoint: fixture.endpoint,
        password: 'wrong-secret',
        timeoutMs: 1_000
      })).rejects.toThrow(/closed|disconnect|authentication/i)
      expect(fixture.identifyMessages).toEqual([
        expect.objectContaining({
          authentication: createObsAuthentication('wrong-secret', 'fixture-salt', 'fixture-challenge')
        })
      ])
      expect(adapter.isConnected()).toBe(false)
    } finally {
      await adapter.disconnect()
      await fixture.close()
    }
  })
})
