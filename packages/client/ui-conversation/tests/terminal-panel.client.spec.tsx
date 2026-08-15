// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { DetailsSlotProps } from '../src/client/contract/slots.ts'
import { zh } from '../src/client/locales.ts'
import { TerminalPanel } from '../src/client/skeleton/TerminalPanel.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TerminalPanel', () => {
  it('opens a persistent desktop shell in the current Session directory', async () => {
    const sessionId = 'terminal-session' as SessionId
    const sessions = createSnapshotStore<SessionListState>({
      ids: [sessionId],
      byId: { [sessionId]: { id: sessionId, displayTitle: 'Terminal', cwd: 'D:\\work', running: false, blank: false, updatedAt: 1 } },
      current: sessionId, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    })
    const writeTerminal = vi.fn()
    const closeTerminal = vi.fn()
    let terminalListener: ((message: { type: string; cwd?: string; data?: string }) => void) | undefined
    const openTerminal = vi.fn(async (_id: string, _cwd: string, listener: (message: object) => void) => {
      terminalListener = listener
      listener({ type: 'cwd', cwd: 'D:\\work' })
      listener({ type: 'output', data: 'ready\r\n' })
    })
    vi.stubGlobal('__DSH_DESKTOP__', { openTerminal, writeTerminal, closeTerminal })
    const openLocation = vi.fn()
    const view = render(<TerminalPanel {...({
      sessionId,
      useSessions: bindSnapshotSelector(sessions),
      closeDetails: vi.fn(),
      openLocation,
      t: makeTranslate(zh, commonZh),
    } as DetailsSlotProps)} />)

    expect(screen.queryByText(/终端工作目录/)).toBeNull()
    expect(screen.getByText('PS D:\\work>')).toBeTruthy()
    await screen.findByText(/ready/)
    expect(view.container.textContent?.match(/PS D:\\work>/g)).toHaveLength(1)
    expect(openTerminal).toHaveBeenCalledWith(expect.any(String), 'D:\\work', expect.any(Function))
    const input = screen.getByPlaceholderText(zh['terminal.placeholder'])
    fireEvent.change(input, { target: { value: 'cd ..' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(writeTerminal).toHaveBeenCalledWith(expect.any(String), 'cd ..\r\n')
    act(() => { terminalListener?.({ type: 'cwd', cwd: 'D:\\' }) })
    expect(view.container.querySelector('[data-terminal-prompt]')?.textContent).toBe('PS D:\\>')
    expect(view.container.querySelector('header')?.textContent).toContain('D:\\')
    fireEvent.change(input, { target: { value: 'clear' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByText(/ready/)).toBeNull()
    expect(writeTerminal).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: zh['details.openLocation'] }))
    expect(openLocation).toHaveBeenCalledOnce()

    view.unmount()
    await waitFor(() => { expect(closeTerminal).toHaveBeenCalledOnce() })
  })
})
