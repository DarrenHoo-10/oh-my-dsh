/**
 * Default image-understanding model selector.
 *
 * The host image relay asks the selected model to describe images when the
 * routed conversation model cannot take them. The selection lives in the
 * `agent-vision-model` settings namespace; the provider/model choices come
 * from the session-independent catalog, restricted to models that declare
 * image input (or whose modalities are unknown — the relay validates
 * capability at use and refuses loudly when the choice cannot serve).
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** The policy fields this selector preserves across a selection change. */
type VisionPolicy = { maxOutputTokens?: number; timeoutMs?: number }

/** Read the stored policy fields that this selector does not edit. */
function policyOf(value: unknown): VisionPolicy {
  if (typeof value !== 'object' || value === null) return {}
  const row = value as { maxOutputTokens?: unknown; timeoutMs?: unknown }
  return {
    ...typeof row.maxOutputTokens === 'number' ? { maxOutputTokens: row.maxOutputTokens } : {},
    ...typeof row.timeoutMs === 'number' ? { timeoutMs: row.timeoutMs } : {},
  }
}

/** Whether the catalog declares the model capable of image input. */
function imageCapable(inputModalities: readonly string[] | undefined): boolean {
  return inputModalities === undefined || inputModalities.includes('image')
}

/** Props of {@link VisionModelSelector}. */
export interface VisionModelSelectorProps {
  /** Wire face for the catalog and settings writes. */
  api: Pick<IApiClient, 'llm' | 'settings'>
  /** The `agent-vision-model` namespace view from the page snapshot. */
  namespace: SettingsNamespaceView | undefined
  /** Whether the settings provider accepts writes. */
  writable: boolean
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Render the default image-understanding model selector.
 * @param props - wire face, namespace view, and copy.
 * @returns the selector, or null while the page snapshot is still loading.
 */
export function VisionModelSelector(props: VisionModelSelectorProps): ReactNode {
  const { api, namespace, writable, t } = props
  const [catalog, setCatalog] = useState<{ provider: string; model: string }[] | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const value = namespace?.value
  const storedProvider = typeof value === 'object' && value !== null
    ? (value as { provider?: unknown }).provider
    : undefined
  const storedModel = typeof value === 'object' && value !== null
    ? (value as { model?: unknown }).model
    : undefined
  const configured = typeof storedProvider === 'string' && typeof storedModel === 'string'

  // The catalog is a host fact; one fetch per mount (the page re-mounts on
  // navigation, and adapter registrations invalidate the whole section).
  useEffect(() => {
    let alive = true
    void api.llm.models({}).then((response) => {
      if (!alive) return
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      const rows: { provider: string; model: string }[] = []
      for (const group of response.result.value.groups) {
        for (const model of group.models) {
          if (!imageCapable(model.inputModalities)) continue
          rows.push({ provider: group.id, model: model.id })
        }
      }
      setCatalog(rows)
    }).catch((error: unknown) => {
      if (alive) setFailure(error instanceof Error ? error.message : String(error))
    })
    return () => { alive = false }
  }, [api])

  const providers = [...new Set((catalog ?? []).map(row => row.provider))]
  const provider = configured ? storedProvider : providers[0]
  const models = provider === undefined ? [] : (catalog ?? []).filter(row => row.provider === provider).map(row => row.model)

  const save = async (nextProvider: string, nextModel: string | undefined): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await api.settings.replace({
        ns: 'agent-vision-model',
        section: nextModel === undefined
          ? {}
          : {
            provider: nextProvider,
            model: nextModel,
            ...policyOf(value),
          },
      })
      if (!response.result.ok) setFailure(response.result.error.message)
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles['visionSelector']} aria-label={t('visionTitle')}>
      <span className={styles['modelFieldLabel']}>{t('visionTitle')}</span>
      {!configured
        ? <p className={styles['notice']}>{t('visionUnset')}</p>
        : null}
      <div className={styles['modelField']}>
        <label className={styles['modelFieldLabel']} htmlFor="vision-provider">{t('visionProvider')}</label>
        <select
          id="vision-provider"
          className={`${styles['input']} ${styles['selectInput']}`}
          disabled={disabled(busy, writable, providers.length === 0)}
          value={provider ?? ''}
          onChange={(event) => {
            const nextProvider = event.target.value
            const nextModel = (catalog ?? []).find(row => row.provider === nextProvider)?.model
            void save(nextProvider, nextModel)
          }}
        >
          {providers.map(candidate => <option key={candidate} value={candidate}>{candidate}</option>)}
        </select>
      </div>
      <div className={styles['modelField']}>
        <label className={styles['modelFieldLabel']} htmlFor="vision-model">{t('visionModel')}</label>
        <select
          id="vision-model"
          className={`${styles['input']} ${styles['selectInput']}`}
          disabled={disabled(busy, writable, models.length === 0)}
          value={configured ? storedModel : undefined}
          onChange={(event) => {
            if (provider !== undefined) void save(provider, event.target.value)
          }}
        >
          {models.map(model => <option key={model} value={model}>{model}</option>)}
        </select>
      </div>
      {configured
        ? (
          <button
            type="button"
            className={styles['linkButton']}
            disabled={disabled(busy, writable, false)}
            onClick={() => { if (provider !== undefined) void save(provider, undefined) }}
          >
            {t('visionClear')}
          </button>
        )
        : null}
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
    </section>
  )
}

/** One disabled predicate: busy or read-only or nothing to choose from. */
function disabled(busy: boolean, writable: boolean, empty: boolean): boolean {
  return busy || !writable || empty
}
