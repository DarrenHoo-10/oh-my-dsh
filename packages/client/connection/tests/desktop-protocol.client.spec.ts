import { describe, expect, it } from 'vitest'
import {
  DESKTOP_PROTOCOL_VERSION,
  isDesktopHostMessage,
  isDesktopHostRequest,
} from '../src/desktop-protocol.ts'

const version = DESKTOP_PROTOCOL_VERSION

describe('desktop Host protocol', () => {
  it('accepts versioned requests and rejects stale or malformed IPC values', () => {
    expect(isDesktopHostRequest({ version, type: 'host-request', requestId: 'boot-1', operation: 'boot' })).toBe(true)
    expect(isDesktopHostRequest({
      version,
      type: 'host-request',
      requestId: 'fetch-1',
      operation: 'fetch',
      request: { path: '/api/goals/create', method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    })).toBe(true)
    expect(isDesktopHostRequest({ version: version - 1, type: 'host-request', requestId: 'stale', operation: 'boot' })).toBe(false)
    expect(isDesktopHostRequest({ version, type: 'host-request', requestId: 'bad', operation: 'fetch', request: { path: '/api', method: 'POST', headers: { broken: 1 } } })).toBe(false)
    expect(isDesktopHostRequest({ version, type: 'host-request', requestId: 'bad', operation: 'stream', channel: 'other' })).toBe(false)
  })

  it('accepts typed replies while leaving frame schema validation to the client carrier', () => {
    expect(isDesktopHostMessage({
      version, type: 'host-reply', requestId: 'boot-1', ok: true, operation: 'boot', value: { rev: 'r1', entries: [] },
    })).toBe(true)
    expect(isDesktopHostMessage({
      version, type: 'host-stream-frame', requestId: 'stream-1', frame: { type: 'server-request' },
    })).toBe(true)
    expect(isDesktopHostMessage({ version, type: 'host-stream-end', requestId: 'stream-1' })).toBe(true)
    expect(isDesktopHostMessage({ version, type: 'host-reply', requestId: 'bad', ok: true, operation: 'fetch', value: { status: 200, headers: {}, body: 'x', bodyEncoding: 'base64' } })).toBe(true)
    expect(isDesktopHostMessage({ version, type: 'host-reply', requestId: 'bad', ok: false, message: 42 })).toBe(false)
  })
})
