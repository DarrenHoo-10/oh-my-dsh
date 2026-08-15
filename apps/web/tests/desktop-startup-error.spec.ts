// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { renderDesktopStartupError } from '../src/desktop-startup-error.ts'

describe('desktop startup failure report', () => {
  it('replaces a blank mount point with the Host failure', () => {
    const root = document.createElement('div')
    root.append(document.createElement('span'))

    renderDesktopStartupError(root, new Error('plugin tree failed to load'))

    expect(root.querySelector('main')?.className).toBe('dsh-desktop-startup-error')
    expect(root.textContent).toContain('Failed to load plugins')
    expect(root.textContent).toContain('plugin tree failed to load')
    expect(root.querySelectorAll('span')).toHaveLength(0)
  })

  it('reports non-Error startup rejections', () => {
    const root = document.createElement('div')

    renderDesktopStartupError(root, 'Host channel closed')

    expect(root.textContent).toContain('Host channel closed')
  })
})
