/** Horizontal containment required by ChatView in narrow flex hosts. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const chatCss = readFileSync(fileURLToPath(new URL('../src/client/chat/ChatView.module.css', import.meta.url)), 'utf8')
const sideCss = readFileSync(fileURLToPath(new URL('../src/client/skeleton/SideChatPanel.module.css', import.meta.url)), 'utf8')

/**
 * Return normalized declarations for one exact selector.
 * @param source - Stylesheet source.
 * @param selector - Exact selector text.
 * @returns Declarations keyed by property.
 */
function declarations(source: string, selector: string): Map<string, string> {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  throw new Error(`stylesheet has no \`${selector}\` rule`)
}

describe('narrow chat horizontal containment', () => {
  it('allows every ChatView flex layer to shrink without horizontal overflow', () => {
    expect(declarations(chatCss, '.root').get('min-width')).toBe('0')
    expect(declarations(chatCss, '.root').get('width')).toBe('100%')
    expect(declarations(chatCss, '.scroll').get('min-width')).toBe('0')
    expect(declarations(chatCss, '.scroll').get('overflow-x')).toBe('hidden')
    expect(declarations(chatCss, '.column').get('min-width')).toBe('0')
  })

  it('allows the side-panel flex host to shrink with its transcript', () => {
    expect(declarations(sideCss, '.body').get('min-width')).toBe('0')
    expect(declarations(sideCss, '.composerWrap').get('min-width')).toBe('0')
  })
})
