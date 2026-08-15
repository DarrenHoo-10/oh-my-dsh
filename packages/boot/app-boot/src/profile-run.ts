/**
 * Reusable profile host runtime for GUI, CLI, and automation application bins.
 * The application owns launch-specific services such as command-line parsing;
 * this module owns profile composition, Loader boot, patch watching, and
 * bounded process lifetime.
 * @module @deepseek-ai/dsh-app-boot/profile-run
 */

import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  installFailLoud,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  watchUserPatches,
  type Profile,
} from './index.ts'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'

/** Empty profile root config that every composed application mounts over. */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/** Root config filename inside a profile directory. */
export const PROFILE_ROOT_FILENAME = 'cordis.yml'

/** The session-telemetry row id targeted by the privacy switch. */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/**
 * Resolve the Harness-home user patch layer for one application surface.
 * @returns the absolute patch-file path.
 */
export function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
}

/**
 * Resolve the telemetry opt-out switch into its boot patch.
 * @param disabledEnv - raw `DSH_TELEMETRY_DISABLED` value.
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no patch is needed.
 */
export function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/**
 * Load a profile and rewrite its empty root config. The root file exists only
 * to anchor Loader resolution at the profile directory; the effective tree is
 * always the patch composition passed to {@link runProfile}.
 * @param binName - diagnostic prefix used by profile helpers.
 * @param name - profile name.
 * @param installAnchor - application package.json used for installation resolution.
 * @param userLayer - whether to parse the profile's own patch layer.
 * @param healModuleFallback - whether to maintain profile-level links for installation-owned modules.
 * @returns the loaded profile.
 */
export function prepareProfile(
  binName: string,
  name: string,
  installAnchor: string,
  userLayer = true,
  healModuleFallback = true,
): Profile {
  if (healModuleFallback) healProfilesModuleFallback(installAnchor)
  const profile = loadProfile(binName, name, installAnchor, undefined, { userLayer })
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}

/** One profile's patch layers and the composed row index. */
interface ComposedProfile {
  profile: Profile
  bundlePatches: PatchOptions[]
  homePatches: PatchOptions[]
  overlays: PatchOptions[]
  rows: ReadonlyMap<string, EntryOptions>
}

/** Return the complete patch stack in application order. */
function allPatches(composed: ComposedProfile): PatchOptions[] {
  return [
    ...composed.bundlePatches,
    ...composed.profile.patches,
    ...composed.homePatches,
    ...composed.overlays,
  ]
}

/** Compose one profile's bundles, user layers, overlays, and launcher patches. */
function composeProfile(
  options: ProfileRunOptions,
): ComposedProfile {
  const profile = prepareProfile(
    options.binName,
    options.profile,
    options.installAnchor,
    true,
    options.bareModuleBaseUrl === undefined,
  )
  const homePatches = loadOptionalPatches(options.binName, homePatchPath()) ?? []
  const overlays = options.patchFiles.flatMap(file => loadOverlayPatches(options.binName, resolve(file)))
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  const rows = new Map<string, EntryOptions>()
  for (const row of composeEntries([bundlePatches, profile.patches, homePatches, overlays])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const composedOverlays = [...overlays]
  if (rows.has('agent-presets')
    && (options.shippedPresetRoot !== undefined || options.bareModuleBaseUrl !== undefined)) {
    composedOverlays.push({
      id: 'agent-presets',
      config: {
        ...(rows.get('agent-presets')?.config ?? {}) as Record<string, unknown>,
        ...(options.shippedPresetRoot === undefined
          ? {} : { roots: [{ path: options.shippedPresetRoot, trust: 'system' }] }),
        ...(options.bareModuleBaseUrl === undefined
          ? {} : { moduleBaseUrl: options.bareModuleBaseUrl }),
      },
    })
  }
  const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) composedOverlays.push(telemetryPatch)
  return { profile, bundlePatches, homePatches, overlays: composedOverlays, rows }
}

/** Options passed by an application surface to the reusable profile host. */
export interface ProfileRunOptions {
  /** Diagnostic name used in errors and profile manifests. */
  binName: string
  /** Absolute path of the application package.json. */
  installAnchor: string
  /** Read-only shipped agent-preset root for this application package. */
  shippedPresetRoot?: string
  /** Frozen environment snapshot supplied before entry activation. */
  environment: LaunchEnvironmentSnapshot
  /** Profile name to boot. */
  profile: string
  /** `--patch` overlay paths, in argv order. */
  patchFiles: readonly string[]
  /** Invocation arguments handed to the application-owned command-line service. */
  args: readonly string[]
  /** Whether to install Cordis HMR and watch the profile and home patch layers. */
  watchPatches?: boolean
  /** Installed application URL used before the profile for bare plugin resolution. */
  bareModuleBaseUrl?: string
  /**
   * Provide launch-specific services after the root context exists and before
   * any profile entry is mounted.
   * @param ctx - root context being booted.
   * @param shutdown - process shutdown controller owned by this run.
   */
  provideLaunchServices?: (ctx: Context, shutdown: ProcessShutdown) => void
}

/** Suppress watcher setup failure only when the application is already exiting. */
function suppressShutdownError(ctx: Context, signal: AbortSignal, error: unknown): void {
  if (signal.aborted) return
  if (ctx.fiber.state !== FiberState.ACTIVE || ctx.get('loader') === undefined) return
  throw error
}

/**
 * Boot one profile invocation and return its live root plus bounded shutdown.
 * @param options - application identity, profile, overlays, environment, and launch-service hook.
 * @returns the settled root context and shutdown controller.
 */
export async function runProfile(options: ProfileRunOptions): Promise<{ ctx: Context; shutdown: ProcessShutdown }> {
  const composed = composeProfile(options)
  const app: { current?: Context } = {}
  const shutdown = createProcessShutdown(async () => { await app.current?.fiber.dispose() })
  const signalShutdown = new AbortController()
  const interrupt = (code: number): void => {
    signalShutdown.abort()
    shutdown.interrupt(code)
  }
  process.on('SIGTERM', () => { interrupt(0) })
  process.on('SIGINT', () => { interrupt(130) })
  installFailLoud(options.binName, process, async () => {
    await app.current?.fiber.dispose()
  })

  const rootConfig = join(composed.profile.dir, PROFILE_ROOT_FILENAME)
  const composeLive = (): PatchOptions[] => structuredClone([
    ...composed.bundlePatches,
    ...loadOptionalPatches(options.binName, composed.profile.patchPath) ?? [],
    ...loadOptionalPatches(options.binName, homePatchPath()) ?? [],
    ...composed.overlays,
  ])
  const ctx = await boot(options.binName, rootConfig, structuredClone(allPatches(composed)), (hostCtx) => {
    app.current = hostCtx
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
    options.provideLaunchServices?.(hostCtx, shutdown)
  }, options.bareModuleBaseUrl)
  app.current = ctx

  if (options.watchPatches !== false
    && !signalShutdown.signal.aborted
    && ctx.fiber.state === FiberState.ACTIVE
    && ctx.get('loader') !== undefined) {
    try {
      if (ctx.get('hmr') === undefined) {
        if (ctx.get('timer') === undefined) {
          await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' })
        }
        await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } })
      }
      await watchUserPatches(ctx, {
        binName: options.binName,
        filename: composed.profile.patchPath,
        compose: composeLive,
      })
      await watchUserPatches(ctx, {
        binName: options.binName,
        filename: homePatchPath(),
        compose: composeLive,
      })
    } catch (error) {
      suppressShutdownError(ctx, signalShutdown.signal, error)
    }
  }
  return { ctx, shutdown }
}
