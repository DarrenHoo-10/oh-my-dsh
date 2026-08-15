/**
 * Per-session chat store shared by conversation and details registrations.
 * The plugin creates its handle at apply time so identity follows the fiber.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { CallId, ChatStoreState, SelectionTarget } from './contract/views.ts'

/** Declared action shape used to give the exported factory a stable return type. */
type ChatActions = {
  select: (draft: ChatStoreState, target: SelectionTarget | null) => void
  setDraft: (draft: ChatStoreState, text: string) => void
  setView: (draft: ChatStoreState, view: string) => void
  setInspect: (draft: ChatStoreState, target: { callId: CallId } | null) => void
  startSideChat: (draft: ChatStoreState, sessionId: SessionId) => void
  openSideChat: (draft: ChatStoreState, sessionId: SessionId) => void
  activateSideChat: (draft: ChatStoreState, id: string) => void
  closeSideChatTab: (draft: ChatStoreState, id: string) => void
}

/**
 * Declares the per-session chat state and write surface.
 * @returns the store handle.
 */
export function createChatStore(): EngineStoreHandle<ChatStoreState, ChatActions> {
  return defineStore({
    // Anchored to the contract shape: consumers read the store through
    // PropsStore<ChatStore>'s SnapshotSelectorHook<ChatStoreState>, so init
    // and the contract cannot drift.
    init: (): ChatStoreState => ({
      selection: null, draft: '', view: null, inspect: null,
      sideChatSessionId: null, sideChatTabs: [], activeSideChatTabId: null,
    }),
    persist: {
      name: 'dsh.conversation.chat',
      project: (state): ChatStoreState => ({
        ...state,
        sideChatSessionId: null,
        sideChatTabs: [],
        activeSideChatTabId: null,
      }),
    },
    actions: {
      select: (d, target: SelectionTarget | null) => { d.selection = target },
      setDraft: (d, text: string) => { d.draft = text },
      setView: (d, view: string) => { d.view = view },
      setInspect: (d, target: { callId: CallId } | null) => { d.inspect = target },
      startSideChat: (d, sessionId: SessionId) => {
        const tab = { id: String(sessionId), sessionId }
        d.sideChatSessionId = sessionId
        d.sideChatTabs = [tab]
        d.activeSideChatTabId = tab.id
      },
      openSideChat: (d, sessionId: SessionId) => {
        d.sideChatSessionId = sessionId
        const tab = { id: String(sessionId), sessionId }
        d.sideChatTabs = [...d.sideChatTabs.filter(item => item.id !== tab.id), tab]
        d.activeSideChatTabId = tab.id
      },
      activateSideChat: (d, id: string) => {
        const tab = d.sideChatTabs.find(item => item.id === id)
        if (tab === undefined) return
        d.activeSideChatTabId = id
        d.sideChatSessionId = tab.sessionId
      },
      closeSideChatTab: (d, id: string) => {
        const tabs = d.sideChatTabs.filter(item => item.id !== id)
        d.sideChatTabs = tabs
        if (d.activeSideChatTabId !== id) return
        const next = tabs.at(-1)
        d.activeSideChatTabId = next?.id ?? null
        d.sideChatSessionId = next?.sessionId ?? null
      },
    },
  })
}
