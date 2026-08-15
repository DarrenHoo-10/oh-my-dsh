/**
 * @deepseek-ai/dsh-desktop-app — runtime marker for the Electron profile
 * overlay. The application Host owns the IPC process loop; this package owns
 * only the profile patch layer that selects the desktop composition.
 * @module @deepseek-ai/dsh-desktop-app
 */

/** Stable Cordis plugin name. */
export const name = 'desktop-app'

/** No Host service is needed; the executable owns the desktop IPC carrier. */
export const inject: string[] = []

/** The profile overlay has no direct runtime work. */
export function apply(): void {}
