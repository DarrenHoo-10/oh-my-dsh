/**
 * Package-owned invariant companion for the image-generation tool.
 *
 * The tool owns no independent event relationship: every observable outcome is
 * a tool call/result pair recorded by the tools registry, and the generation
 * route itself is validated at execution time.
 * The empty installer keeps that absence explicit in composed invariant sets.
 *
 * @module @deepseek-ai/dsh-tool-image-generation/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-image-generation'

/** Cordis companion plugin name. */
export const name = 'tool-image-generation-invariant'
/** Services required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: the tools registry owns the tool's observable lifecycle. */
const install: InvariantInstaller = () => {}

/**
 * Register the intentionally empty invariant contribution.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
