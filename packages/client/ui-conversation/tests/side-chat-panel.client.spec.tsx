// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { createChatStore } from '../src/client/stores.ts'
import type { SideChatSlotProps } from '../src/client/contract/slots.ts'
import { SideChatPanel } from '../src/client/skeleton/SideChatPanel.tsx'
import { zh } from '../src/client/locales.ts'

const SID = 'side-chat-session' as SessionId

afterEach(cleanup)

describe('SideChatPanel', () => {
  it('waits for the fork window before binding the complete composer', async () => {
    const chat = createChatStore().create()
    chat.actions.openSideChat(SID)
    const snapshot = {
      running: false,
      nodes: [{
        kind: 'assistant', seq: 3, time: 1, turn: 1, step: 1,
        blocks: [{ kind: 'text', text: 'latest answer' }],
      }],
    } as unknown as ConversationSnapshot
    const renderSlot = vi.fn((name: string, _owner?: unknown, _options?: unknown) => {
      if (name === 'conversation.view') return <div data-chat-anchor-key="answer">latest answer</div>
      if (name === 'conversation.session.composer') return <button type="button">child composer</button>
      return null
    })
    const providedSessions: SessionId[] = []
    let finishOpen!: () => void
    const openConversationWindow = vi.fn(() => new Promise<void>((resolve) => { finishOpen = resolve }))
    const discardSideChat = vi.fn(() => Promise.resolve())
    const view = render(
      <SideChatPanel
        sessionId={SID}
        useSession={((selector: (value: ConversationSnapshot) => unknown) => selector(snapshot)) as never}
        useSessions={((selector: (value: unknown) => unknown) => selector({ byId: { [SID]: { cwd: 'D:/work', seedLength: 3 } } })) as never}
        useWorkspaces={vi.fn() as never}
        useProjection={vi.fn() as never}
        useInput={vi.fn() as never}
        inputActions={{ setDraft: vi.fn(), addImages: vi.fn(() => true), removeImage: vi.fn(), pruneImages: vi.fn(), submit: vi.fn() }}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        closeSideChat={vi.fn()}
        openConversationWindow={openConversationWindow}
        discardSideChat={discardSideChat}
        openLocation={vi.fn()}
        createSideChat={vi.fn()}
        renderSlot={renderSlot as never}
        SessionProvider={({ sessionId, children }) => {
          if (sessionId !== undefined) providedSessions.push(sessionId)
          return children(sessionId ?? SID)
        }}
        t={makeTranslate(zh, commonZh)}
      />,
    )

    expect(view.getByText(zh['sideChat.loading'])).toBeTruthy()
    expect(view.queryByRole('button', { name: 'child composer' })).toBeNull()
    finishOpen()
    expect(await view.findByText('latest answer')).toBeTruthy()
    expect(await view.findByRole('button', { name: 'child composer' })).toBeTruthy()
    expect(providedSessions).toContain(SID)
    expect(openConversationWindow).toHaveBeenCalledWith(SID)
    const viewCall = renderSlot.mock.calls.find(call => call[0] === 'conversation.view')
    const viewOwner = viewCall?.[1] as { inspect?: unknown; onInspectDone?: unknown; visibleFromSeq?: number } | undefined
    expect(viewOwner?.inspect).toBeNull()
    expect(viewOwner?.visibleFromSeq).toBe(3)
    expect(typeof viewOwner?.onInspectDone).toBe('function')
    expect(viewCall?.[2]).toEqual({ only: 'chat' })
    const composerCall = renderSlot.mock.calls.find(call => call[0] === 'conversation.session.composer')
    expect(composerCall?.[1]).toEqual({})
    expect(view.queryByText('继承主对话模型')).toBeNull()
  })

  it('discards every temporary fork before the panel closes', async () => {
    const chat = createChatStore().create()
    const other = 'side-chat-other' as SessionId
    chat.actions.openSideChat(SID)
    chat.actions.openSideChat(other)
    const discardSideChat = vi.fn(() => Promise.resolve())
    const closeSideChat = vi.fn()
    const view = render(
      <SideChatPanel {...({
        sessionId: SID,
        useSessions: (selector: (value: unknown) => unknown) => selector({
          byId: { [SID]: {}, [other]: {} },
        }),
        useStore: bindSnapshotSelector(chat), actions: chat.actions,
        closeSideChat, openConversationWindow: vi.fn(() => Promise.resolve()), discardSideChat,
        openLocation: vi.fn(), createSideChat: vi.fn(), renderSlot: vi.fn(),
        SessionProvider: ({ children }: { children: (id: SessionId) => unknown }) => children(SID),
        t: makeTranslate(zh, commonZh),
      } as unknown as SideChatSlotProps)} />,
    )
    fireEvent.click(view.getAllByRole('button', { name: zh['sideChat.close'] }).at(-1)!)
    await waitFor(() => { expect(discardSideChat).toHaveBeenCalledTimes(2) })
    expect(discardSideChat).toHaveBeenCalledWith(SID)
    expect(discardSideChat).toHaveBeenCalledWith(other)
    await waitFor(() => { expect(closeSideChat).toHaveBeenCalledOnce() })
  })

  it('keeps the panel open when temporary fork destruction fails', async () => {
    const chat = createChatStore().create()
    chat.actions.openSideChat(SID)
    const closeSideChat = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = render(
      <SideChatPanel {...({
        sessionId: SID,
        useSessions: (selector: (value: unknown) => unknown) => selector({ byId: { [SID]: {} } }),
        useStore: bindSnapshotSelector(chat), actions: chat.actions,
        closeSideChat, openConversationWindow: vi.fn(() => Promise.resolve()),
        discardSideChat: vi.fn(() => Promise.reject(new Error('dispose failed'))),
        openLocation: vi.fn(), createSideChat: vi.fn(), renderSlot: vi.fn(),
        SessionProvider: ({ children }: { children: (id: SessionId) => unknown }) => children(SID),
        t: makeTranslate(zh, commonZh),
      } as unknown as SideChatSlotProps)} />,
    )
    fireEvent.click(view.getAllByRole('button', { name: zh['sideChat.close'] }).at(-1)!)
    await waitFor(() => { expect(warn).toHaveBeenCalled() })
    expect(closeSideChat).not.toHaveBeenCalled()
    expect(chat.store.getSnapshot().sideChatTabs).toHaveLength(1)
    warn.mockRestore()
  })

  it('removes a persisted tab whose temporary fork no longer exists', async () => {
    const chat = createChatStore().create()
    chat.actions.openSideChat(SID)
    const closeSideChat = vi.fn()
    const openConversationWindow = vi.fn(() => Promise.resolve())
    render(
      <SideChatPanel {...({
        sessionId: SID,
        useSessions: (selector: (value: unknown) => unknown) => selector({ byId: {} }),
        useStore: bindSnapshotSelector(chat), actions: chat.actions,
        closeSideChat, openConversationWindow, discardSideChat: vi.fn(() => Promise.resolve()),
        openLocation: vi.fn(), createSideChat: vi.fn(), renderSlot: vi.fn(),
        SessionProvider: ({ children }: { children: (id: SessionId) => unknown }) => children(SID),
        t: makeTranslate(zh, commonZh),
      } as unknown as SideChatSlotProps)} />,
    )
    await waitFor(() => { expect(chat.store.getSnapshot().sideChatTabs).toEqual([]) })
    expect(closeSideChat).toHaveBeenCalledOnce()
    expect(openConversationWindow).not.toHaveBeenCalled()
  })

  it('shows a load failure without exposing a composer that cannot render its messages', async () => {
    const chat = createChatStore().create()
    chat.actions.openSideChat(SID)
    const renderSlot = vi.fn((name: string) => name === 'conversation.session.composer'
      ? <button type="button">child composer</button>
      : null)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = render(
      <SideChatPanel {...({
        sessionId: SID,
        useSessions: (selector: (value: unknown) => unknown) => selector({ byId: { [SID]: {} } }),
        useStore: bindSnapshotSelector(chat), actions: chat.actions,
        closeSideChat: vi.fn(),
        openConversationWindow: vi.fn(() => Promise.reject(new Error('history unavailable'))),
        discardSideChat: vi.fn(() => Promise.resolve()), openLocation: vi.fn(),
        createSideChat: vi.fn(), renderSlot,
        SessionProvider: ({ children }: { children: (id: SessionId) => unknown }) => children(SID),
        t: makeTranslate(zh, commonZh),
      } as unknown as SideChatSlotProps)} />,
    )
    expect(await view.findByText(zh['sideChat.loadError'])).toBeTruthy()
    await waitFor(() => {
      expect(view.queryByRole('button', { name: 'child composer' })).toBeNull()
    })
    warn.mockRestore()
  })
})
