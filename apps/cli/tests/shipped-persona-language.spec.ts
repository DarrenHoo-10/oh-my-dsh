/** Shipped deployment and agent-preset personas share one response-language rule. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const LANGUAGE_RULE = "Use the language of the user's latest message for all natural-language output"

const SHIPPED_PERSONAS = [
  'packages/bundle/web-app/cordis.patch.yml',
  'packages/bundle/headless/cordis.patch.yml',
  'apps/cli/config/agent-presets/standard/agent.cordis.yml',
  'apps/cli/config/agent-presets/code/agent.cordis.yml',
  'apps/cli/config/agent-presets/cordis/agent.cordis.yml',
  'apps/cli/config/agent-presets/minimal/agent.cordis.yml',
] as const

describe('shipped persona response language', () => {
  it.each(SHIPPED_PERSONAS)('%s follows the latest user message', async (path) => {
    expect(await readFile(resolve(path), 'utf8')).toContain(LANGUAGE_RULE)
  })
})
