/** Verifies that the dialog child runs as Node even when the host executable is Electron. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawn = vi.fn((_command: string, _args: readonly string[], _options: object) => ({ marker: 'worker' }))

vi.mock('node:child_process', () => ({ spawn }))

describe('spawnDialogWorker', () => {
  beforeEach(() => {
    spawn.mockClear()
  })

  it('forces Electron executables into Node mode for the dialog worker', async () => {
    const { spawnDialogWorker } = await import('../src/win32-dialog-host.ts')
    spawnDialogWorker({ title: 'Pick a workspace' })

    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn.mock.calls[0]?.[2]).toMatchObject({
      env: {
        DSH_DIALOG_TITLE: 'Pick a workspace',
        ELECTRON_RUN_AS_NODE: '1',
      },
      windowsHide: true,
    })
  })
})
