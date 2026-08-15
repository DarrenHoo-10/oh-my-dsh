/** Renderer-side Electron bridge contract. This file has no Electron import. */

import type {
  DesktopFetchRequest, DesktopFetchResponse, DesktopRendererBridge,
} from '../desktop-protocol.ts'
import { randomUuid } from './random-uuid.ts'

export type { DesktopRendererBridge } from '../desktop-protocol.ts'

/** Global name owned by the trusted desktop preload. */
export interface DesktopGlobal {
  __DSH_DESKTOP__?: DesktopRendererBridge
}

/**
 * Read the bridge published by the trusted preload, if this page is not the desktop renderer.
 * @returns the desktop bridge, or `undefined` for browser and fixture pages.
 */
export function getDesktopBridge(): DesktopRendererBridge | undefined {
  return (globalThis as DesktopGlobal).__DSH_DESKTOP__
}

/**
 * Read the desktop bridge and fail when the desktop-only carrier is unavailable.
 * @returns the trusted desktop bridge.
 */
export function requireDesktopBridge(): DesktopRendererBridge {
  const bridge = getDesktopBridge()
  if (bridge === undefined) throw new Error('client-connection: desktop IPC bridge is unavailable')
  return bridge
}

/**
 * Reconstruct a Fetch response from the validated IPC response.
 * @param value - serialized response returned by the Host.
 * @returns a browser-compatible response.
 */
export function toDesktopResponse(value: DesktopFetchResponse): Response {
  const body = value.body === undefined
    ? undefined
    : value.bodyEncoding === 'base64'
      ? Uint8Array.from(atob(value.body), character => character.charCodeAt(0))
      : value.body
  return new Response(body, { status: value.status, headers: value.headers })
}

/**
 * Convert a request body to the text representation accepted by the desktop protocol.
 * @param body - Fetch request body supplied by the API client.
 * @returns the text body, or `undefined` for an empty body.
 */
export function desktopBodyOf(body: BodyInit | null | undefined): string | undefined {
  if (body === null || body === undefined) return undefined
  if (typeof body === 'string') return body
  throw new Error('client-connection: desktop IPC only accepts text request bodies')
}

/**
 * Execute a cancellable desktop fetch without sending an `AbortSignal` through
 * Electron context isolation, which only carries plain serializable values.
 * @param request - fetch-shaped request for the Host.
 * @param signal - renderer-local cancellation signal.
 * @returns the serialized Host response.
 */
export async function desktopFetch(
  request: DesktopFetchRequest,
  signal?: AbortSignal,
): Promise<DesktopFetchResponse> {
  if (signal?.aborted === true) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  const bridge = requireDesktopBridge()
  const requestId = randomUuid()
  const cancel = (): void => { bridge.cancelRequest(requestId) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    return await bridge.fetch(requestId, request)
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}
