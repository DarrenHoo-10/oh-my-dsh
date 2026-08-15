import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopRendererBridge } from '../src/client/desktop-bridge.ts'
import { DesktopApiClient } from '../src/client/desktop-api-client.ts'
import { createDesktopConnectionRpc } from '../src/client/rpc.ts'
import { DESKTOP_PROTOCOL_VERSION, type DesktopHostMessage } from '../src/desktop-protocol.ts'

type DesktopWindow = { __DSH_DESKTOP__?: DesktopRendererBridge }
const desktopWindow = globalThis as DesktopWindow
const previousBridge = desktopWindow.__DSH_DESKTOP__

afterEach(() => {
  if (previousBridge === undefined) delete desktopWindow.__DSH_DESKTOP__
  else desktopWindow.__DSH_DESKTOP__ = previousBridge
})

describe('desktop renderer transport', () => {
  it('carries generic RPC calls through the preload fetch bridge', async () => {
    const fetch = vi.fn(async (_requestId: string, request: Parameters<DesktopRendererBridge['fetch']>[1]) => {
      const sent = JSON.parse(request.body ?? '{}') as { rpcId: string }
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'server-response', rpcId: sent.rpcId, result: { ok: true, value: { ready: true } } }),
        bodyEncoding: 'utf8' as const,
      }
    })
    desktopWindow.__DSH_DESKTOP__ = {
      getBootManifest: async () => ({ rev: 'test', entries: [] }),
      loadBundle: async () => '',
      fetch,
      pickDirectory: async () => null,
      cancelRequest: () => undefined,
      openStream: () => undefined,
      closeStream: () => undefined,
      showShellMenu: () => undefined,
    }

    await expect(createDesktopConnectionRpc().call('/api', 'health/read', { ping: true })).resolves.toEqual({ ok: true, value: { ready: true } })
    expect(fetch).toHaveBeenCalledTimes(1)
    const request = fetch.mock.calls[0]?.[1]
    expect(request?.path).toBe('/api/health/read')
    expect(request?.method).toBe('POST')
    expect(request?.body).toContain('client-request')
  })

  it('validates desktop stream envelopes and drops malformed frames', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    desktopWindow.__DSH_DESKTOP__ = {
      getBootManifest: async () => ({ rev: 'test', entries: [] }),
      loadBundle: async () => '',
      fetch: async () => ({ status: 200, headers: {}, body: '{}', bodyEncoding: 'utf8' }),
      pickDirectory: async () => null,
      cancelRequest: () => undefined,
      openStream(streamId, _channel, listener) {
        listener({
          version: DESKTOP_PROTOCOL_VERSION,
          type: 'host-reply',
          requestId: streamId,
          ok: true,
          operation: 'stream',
        })
        listener({ type: 'not-a-host-message' } as unknown as DesktopHostMessage)
        listener({
          version: DESKTOP_PROTOCOL_VERSION,
          type: 'host-stream-frame',
          requestId: streamId,
          frame: {
            type: 'server-request',
            rpcId: 'frame-1',
            method: 'events.mux',
            payload: { type: 'session/subscribed', sessionId: 'session-1', lastSeq: 0 },
          },
        })
        listener({ version: DESKTOP_PROTOCOL_VERSION, type: 'host-stream-end', requestId: streamId })
      },
      closeStream: () => undefined,
      showShellMenu: () => undefined,
    }
    const client = new DesktopApiClient()
    const abort = new AbortController()
    const iterator = client.events.mux({}, abort.signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { rpcId: 'frame-1', payload: { type: 'session/subscribed', sessionId: 'session-1', lastSeq: 0 } },
    })
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
    expect(errors).toHaveBeenCalledTimes(1)
    errors.mockRestore()
  })
})
