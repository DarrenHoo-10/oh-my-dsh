/** Desktop API carrier: the same API protocol over the preload IPC bridge. */

import type { ApiProxy, HostFrame, MuxFrame, RpcRequest } from './api.ts'
import { AbstractApiClient } from './api.ts'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { HOST_EVENTS_PATH, MUX_EVENTS_PATH } from '../api-path.ts'
import {
  desktopBodyOf, desktopFetch, requireDesktopBridge, toDesktopResponse,
} from './desktop-bridge.ts'
import { randomUuid } from './random-uuid.ts'
import { isDesktopHostMessage, type DesktopHostMessage } from '../desktop-protocol.ts'

type Parser<F> = { parse(value: unknown): F }

/** Fetch carrier used by the Electron renderer. */
export class DesktopApiClient extends AbstractApiClient {
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    const body = desktopBodyOf(init?.body)
    const signal = init?.signal ?? undefined
    return desktopFetch({
      path: `${input.pathname}${input.search}`,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(body === undefined ? {} : { body }),
    }, signal).then(toDesktopResponse)
  }

  protected override openMux(
    _payload: Parameters<ApiProxy['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readStream('mux', signal, muxFrameSchema, onOpen)
  }

  protected override openHost(
    _payload: Parameters<ApiProxy['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readStream('host', signal, hostFrameSchema, onOpen)
  }

  private async *readStream<F extends MuxFrame | HostFrame>(
    channel: 'mux' | 'host',
    signal: AbortSignal,
    frameSchema: Parser<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    if (signal.aborted) return
    const bridge = requireDesktopBridge()
    const streamId = randomUuid()
    const queue: DesktopHostMessage[] = []
    let wake: (() => void) | undefined
    let ended = false
    let opened = false
    const onMessage = (value: DesktopHostMessage): void => {
      if (!isDesktopHostMessage(value)) {
        console.error(`[client-connection] dropping malformed desktop message on ${channel}`)
        return
      }
      queue.push(value)
      wake?.()
      wake = undefined
    }
    const cancel = (): void => {
      ended = true
      bridge.closeStream(streamId)
      wake?.()
      wake = undefined
    }
    signal.addEventListener('abort', cancel, { once: true })
    bridge.openStream(streamId, channel, onMessage)
    try {
      while (!ended) {
        while (queue.length > 0) {
          const value = queue.shift() as DesktopHostMessage
          if (value.type === 'host-reply') {
            if (!value.ok) throw new Error(value.message)
            if (!opened) {
              opened = true
              onOpen?.()
            }
            continue
          }
          if (value.type === 'host-stream-end') {
            if (value.message !== undefined) throw new Error(value.message)
            ended = true
            break
          }
          try {
            const full = serverRequestSchema.parse(value.frame)
            const frame = frameSchema.parse(full.payload)
            this.onEnvelope(full)
            yield { rpcId: full.rpcId, payload: frame }
          } catch (error) {
            console.error(`[client-connection] dropping malformed desktop frame on ${channel}:`, error)
          }
        }
        if (ended) break
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', cancel)
      bridge.closeStream(streamId)
    }
  }

  /** Keep endpoint names discoverable beside the carrier implementation. */
  static readonly streamPaths = { mux: MUX_EVENTS_PATH, host: HOST_EVENTS_PATH }
}
