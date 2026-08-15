/** Writable Chromium storage selection for the Electron desktop carrier. */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface DesktopChromiumStoragePaths {
  readonly sessionData: string
  readonly diskCache: string
}

export interface DesktopChromiumStorageTarget {
  /** Assigns Electron's Chromium session-data directory before app readiness. */
  readonly setSessionDataPath: (path: string) => void
  /** Assigns Chromium's disk-cache directory before app readiness. */
  readonly setDiskCachePath: (path: string) => void
}

/**
 * Resolves stable but isolated Chromium paths for installed and development runs.
 *
 * @param cacheRoot Operating-system local cache root.
 * @param packaged Whether the current Electron application is packaged.
 * @returns Session-data and disk-cache paths for the current launch channel.
 */
export function desktopChromiumStoragePaths(cacheRoot: string, packaged: boolean): DesktopChromiumStoragePaths {
  if (cacheRoot.trim() === '') throw new Error('desktop Chromium cache root is empty')
  const sessionData = join(cacheRoot, 'DeepSeek Harness', packaged ? 'Chromium' : 'Chromium Development')
  return { sessionData, diskCache: join(sessionData, 'Cache') }
}

/**
 * Creates and assigns writable Chromium storage before Electron becomes ready.
 *
 * @param cacheRoot Operating-system local cache root.
 * @param packaged Whether the current Electron application is packaged.
 * @param target Electron path and command-line setters.
 * @returns The assigned paths.
 */
export function configureDesktopChromiumStorage(
  cacheRoot: string,
  packaged: boolean,
  target: DesktopChromiumStorageTarget,
): DesktopChromiumStoragePaths {
  const paths = desktopChromiumStoragePaths(cacheRoot, packaged)
  mkdirSync(paths.diskCache, { recursive: true })
  target.setSessionDataPath(paths.sessionData)
  target.setDiskCachePath(paths.diskCache)
  return paths
}
