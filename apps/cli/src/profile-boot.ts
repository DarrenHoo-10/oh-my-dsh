/** CLI adapter over the reusable application profile host. */

import { fileURLToPath } from 'node:url'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import {
  homePatchPath as resolveHomePatchPath,
  prepareProfile as prepareAppProfile,
  PROFILE_ROOT_FILENAME,
  resolveTelemetryPatch,
  runProfile as runAppProfile,
  type ProfileRunOptions,
} from '@deepseek-ai/dsh-app-boot'
import type { Context } from '@deepseek-ai/cordis'
import type { ProcessShutdown, Profile } from '@deepseek-ai/dsh-app-boot'

const NAME = 'dsh'

/** Shipped agent-preset root beside the CLI's own config directory. */
const SHIPPED_PRESET_ROOT = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

/** Absolute path of this dsh installation's package.json. */
export const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/** The home-level user patch layer for the CLI. */
export function homePatchPath(): string {
  return resolveHomePatchPath()
}

/** Load and initialize one CLI profile. */
export function prepareProfile(name: string, userLayer = true): Profile {
  return prepareAppProfile(NAME, name, INSTALL_ANCHOR, userLayer)
}

/** Re-export the shared root filename for config-dump and plugin commands. */
export { PROFILE_ROOT_FILENAME, resolveTelemetryPatch }

/** CLI invocation options, kept source-compatible with the former adapter. */
export interface RunProfileOptions extends Omit<ProfileRunOptions, 'binName' | 'installAnchor' | 'shippedPresetRoot' | 'provideLaunchServices'> {}

/** Boot a CLI profile with the CLI-owned immutable command-line service. */
export async function runProfile(options: RunProfileOptions): Promise<{ ctx: Context; shutdown: ProcessShutdown }> {
  return runAppProfile({
    ...options,
    binName: NAME,
    installAnchor: INSTALL_ANCHOR,
    shippedPresetRoot: SHIPPED_PRESET_ROOT,
    provideLaunchServices: (ctx, shutdown) => {
      provideCmdline(ctx, {
        args: options.args,
        exit: code => void shutdown.shutdown(code),
      })
    },
  })
}
