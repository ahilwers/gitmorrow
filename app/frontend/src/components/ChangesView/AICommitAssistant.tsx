// Copyright (C) 2026 Achim Hilwers
//
// This file is part of GitMorrow.
//
// GitMorrow is free software: you can redistribute it and/or modify it under the
// terms of the GNU General Public License as published by the Free Software
// Foundation, either version 3 of the License, or (at your option) any later
// version. See the LICENSE file in the repository root for details.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import { Button } from '../shared/Button'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GenerateCommitMessage, GetAISettings, SaveAISettings } from '@bindings/gitmorrow/app'
import type { AISettings } from '@bindings/gitmorrow/models'

// Must match maxAIDiffKiB in app/ai.go.
const MAX_DIFF_KIB = 512
const CLI_PRESETS = ['claude', 'codex', 'copilot', 'custom'] as const

// No credentials are kept in localStorage or returned by the Go settings API.
export function AICommitAssistant({ hasStaged, onApply }: { hasStaged: boolean; onApply: (message: string) => void }) {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [removeKey, setRemoveKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => { GetAISettings().then(setSettings).catch(() => setError(t('aiCommit.errorLoad'))) }, [t])
  const inputStyle = { background: 'var(--bg-input)', color: 'var(--text-pri)', border: '1px solid var(--border)', borderRadius: 4, padding: 5, width: '100%' }
  const useCLI = settings?.authMode === 'cli'
  // A CLI authenticates itself, so a stored key is not needed in that mode.
  const canGenerate = Boolean(hasStaged && settings && (useCLI || settings.hasAPIKey))
  async function save() {
    if (!settings) return
    setBusy(true); setError(''); setSaved(false)
    try {
      await SaveAISettings(settings, key, removeKey)
      setKey(''); setRemoveKey(false); setSettings(await GetAISettings()); setSaved(true)
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  async function generate() {
    setBusy(true); setError(''); setPreview('')
    try { setPreview(await GenerateCommitMessage()) } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <section aria-label={t('aiCommit.section')} style={{ fontSize: 11, color: 'var(--text-sec)' }}>
    <div style={{ display: 'flex', gap: 8 }}>
      <Button variant="secondary" type="button" disabled={busy || !canGenerate} onClick={generate}>{busy ? t('aiCommit.working') : t('aiCommit.generate')}</Button>
      <Button variant="secondary" type="button" disabled={busy} onClick={() => { setOpen(!open); setKey(''); setSaved(false) }}>{t('aiCommit.settings')}</Button>
    </div>
    <p style={{ margin: '5px 0' }}>{useCLI ? t('aiCommit.privacyCli', { size: MAX_DIFF_KIB }) : t('aiCommit.privacyApiKey', { size: MAX_DIFF_KIB })}</p>
    {open && settings && <fieldset disabled={busy} style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-panel2)', padding: '10px 12px 12px', display: 'grid', gap: 10, margin: '10px 0', minWidth: 0 }}>
      <legend>{t('aiCommit.legend')}</legend>
      <label>{t('aiCommit.authMode')}<select aria-label={t('aiCommit.authMode')} style={inputStyle} value={settings.authMode} onChange={e => setSettings({ ...settings, authMode: e.target.value })}>
        <option value="apiKey">{t('aiCommit.modeApiKey')}</option><option value="cli">{t('aiCommit.modeCli')}</option>
      </select></label>
      {useCLI ? <>
        <label>{t('aiCommit.cli')}<select aria-label={t('aiCommit.cli')} style={inputStyle} value={settings.cli} onChange={e => setSettings({ ...settings, cli: e.target.value })}>
          {CLI_PRESETS.map(preset => <option key={preset} value={preset}>{t(`aiCommit.cliPreset.${preset}`)}</option>)}
        </select></label>
        <label>{t('aiCommit.cliPath')}<input style={inputStyle} placeholder={settings.cli === 'custom' ? t('aiCommit.cliPathRequired') : t('aiCommit.cliPathPlaceholder')} value={settings.cliPath} onChange={e => setSettings({ ...settings, cliPath: e.target.value })} /></label>
        <span>{t('aiCommit.cliHint')}</span>
      </> : <>
        <label>{t('aiCommit.provider')}<select aria-label={t('aiCommit.provider')} style={inputStyle} value={settings.provider} onChange={e => {
          const provider = e.target.value
          setSettings({ ...settings, provider, baseURL: provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1', model: provider === 'openrouter' ? 'openai/gpt-4o-mini' : 'gpt-4o-mini', hasAPIKey: false })
        }}><option value="openrouter">OpenRouter</option><option value="openai-compatible">OpenAI compatible</option></select></label>
        <label>{t('aiCommit.baseURL')}<input style={inputStyle} value={settings.baseURL} onChange={e => setSettings({ ...settings, baseURL: e.target.value, hasAPIKey: false })} /></label>
        <label>{t('aiCommit.model')}<input style={inputStyle} value={settings.model} onChange={e => setSettings({ ...settings, model: e.target.value })} /></label>
        <label>{t('aiCommit.apiKey')} {settings.hasAPIKey ? t('aiCommit.apiKeyStored') : t('aiCommit.apiKeyRequired')}<input type="password" autoComplete="off" style={inputStyle} value={key} onChange={e => setKey(e.target.value)} /></label>
        <label><input type="checkbox" checked={removeKey} onChange={e => setRemoveKey(e.target.checked)} />{t('aiCommit.removeKey')}</label>
        <span>{t('aiCommit.keysHint')}</span>
      </>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
        {saved && <span role="status">{t('aiCommit.saved')}</span>}
        <Button variant="primary" type="button" onClick={save}>{t('aiCommit.save')}</Button>
      </div>
    </fieldset>}
    {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    {preview && <div style={{ border: '1px solid var(--border)', padding: 8 }}>
      <strong>{t('aiCommit.suggestion')}</strong>
      <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto', userSelect: 'text' }}>{preview}</pre>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <Button variant="primary" type="button" onClick={() => { onApply(preview); setPreview('') }}>{t('aiCommit.apply')}</Button>
        <Button variant="secondary" type="button" onClick={() => setPreview('')}>{t('aiCommit.dismiss')}</Button>
      </div>
    </div>}
  </section>
}
