import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { configureDesktopChromiumStorage, desktopChromiumStoragePaths } from '../src/chromium-storage.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
})

describe('desktop Chromium storage', () => {
  it('isolates installed and development cache directories', () => {
    expect(desktopChromiumStoragePaths('C:\\cache', true)).toEqual({
      sessionData: join('C:\\cache', 'DeepSeek Harness', 'Chromium'),
      diskCache: join('C:\\cache', 'DeepSeek Harness', 'Chromium', 'Cache'),
    })
    expect(desktopChromiumStoragePaths('C:\\cache', false)).toEqual({
      sessionData: join('C:\\cache', 'DeepSeek Harness', 'Chromium Development'),
      diskCache: join('C:\\cache', 'DeepSeek Harness', 'Chromium Development', 'Cache'),
    })
  })

  it('rejects an empty cache root', () => {
    expect(() => desktopChromiumStoragePaths('  ', true)).toThrow('desktop Chromium cache root is empty')
  })

  it('creates the cache and assigns both Electron paths', async () => {
    const cacheRoot = await mkdtemp(join(tmpdir(), 'dsh-desktop-cache-'))
    temporaryDirectories.push(cacheRoot)
    const assigned: string[] = []
    const paths = configureDesktopChromiumStorage(cacheRoot, true, {
      setSessionDataPath: (path) => { assigned.push(`session:${path}`) },
      setDiskCachePath: (path) => { assigned.push(`cache:${path}`) },
    })
    expect(assigned).toEqual([`session:${paths.sessionData}`, `cache:${paths.diskCache}`])
    expect((await stat(paths.diskCache)).isDirectory()).toBe(true)
  })
})
