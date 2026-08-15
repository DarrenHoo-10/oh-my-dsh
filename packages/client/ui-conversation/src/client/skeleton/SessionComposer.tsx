import { useCallback, useRef } from 'react'
import type { InputZone, SessionComposerProps } from '../contract/slots.ts'
import css from './ConversationRoot.module.css'

/** Complete active-session composer mounted in either conversation column. */
export function SessionComposer({
  useSession, useInput, useComposerBlock, renderSlot, renderSlotChain, accessory,
}: SessionComposerProps) {
  const session = useSession(s => s)
  const input = useInput(s => s)
  const pending = useSession(s => s.pending)
  const composerBlock = useComposerBlock(block => block)
  const zone: InputZone = { session, input }
  const seatObserver = useRef<ResizeObserver | null>(null)
  const seatResizeRef = useCallback((seat: HTMLDivElement | null): void => {
    seatObserver.current?.disconnect()
    seatObserver.current = null
    const scroller = seat?.parentElement ?? null
    if (seat === null || scroller === null || typeof ResizeObserver === 'undefined') return
    seatObserver.current = new ResizeObserver(() => {
      scroller.style.setProperty('--dsh-composer-height', `${seat.offsetHeight}px`)
    })
    seatObserver.current.observe(seat)
  }, [])
  const bar = (
    <div className={css.composerStack}>
      {accessory}
      {renderSlot('conversation.input.dock', zone)}
      {renderSlot('conversation.composer.bar', {
        variant: 'composer',
        ...(composerBlock === undefined
          ? {}
          : { blocked: composerBlock, placeholder: composerBlock.reason }),
        overlay: renderSlot('conversation.input.overlay', {}),
        leftItems: renderSlot('conversation.input.left', zone),
        rightItems: renderSlot('conversation.input.right', zone),
        footer: renderSlot('conversation.composer.dock', zone),
      })}
    </div>
  )
  const composer = renderSlotChain(
    'conversation.composer',
    { interactions: pending, session },
    { fallback: bar, overlay: true },
  )
  return <div ref={seatResizeRef} className={css.composerSeat} data-composer-seat="">{composer}</div>
}
