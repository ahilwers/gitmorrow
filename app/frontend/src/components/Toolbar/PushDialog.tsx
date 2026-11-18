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
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as Dialog from '@radix-ui/react-dialog'
import type { PushInfo } from '@bindings/gitmorrow/git'
import type { PushPreferences } from '@bindings/gitmorrow/models'

interface Props {
  info: PushInfo
  preferences?: PushPreferences
  onConfirm: (remotes: string[], pushTags: boolean) => void
  onClose: () => void
}

// Initial remote selection: the choice the user confirmed last time for this
// repository, limited to remotes that still exist. Without a remembered choice
// — or when every remembered remote has been renamed or removed — all
// configured remotes are selected, because pushing usually means publishing
// everywhere the user mirrors this repository.
function initialRemotes(remotes: string[], preferences?: PushPreferences): string[] {
  const remembered = preferences?.saved ? (preferences.remotes ?? []).filter(remote => remotes.includes(remote)) : []
  return remembered.length > 0 ? remembered : remotes
}

export function PushDialog({ info, preferences, onConfirm, onClose }: Props) {
  const { t } = useTranslation()
  const remotes = useMemo(() => info.remotes ?? [], [info.remotes])
  const [selected, setSelected] = useState<string[]>(() => initialRemotes(remotes, preferences))
  // Tags stay on unless the user turned them off for this repository last time:
  // the remote may reject tag creation, and the answer must survive the dialog.
  const [pushTags, setPushTags] = useState(() => (preferences?.saved ? preferences.pushTags : true))
  const cancelRef = useRef<HTMLButtonElement>(null)

  const toggleRemote = (remote: string) => {
    setSelected(current => current.includes(remote)
      ? current.filter(name => name !== remote)
      : [...current, remote])
  }

  // Keep the confirmation preview aligned with the selection order the backend
  // uses: the first selected remote in configuration order becomes the upstream.
  const confirmRemotes = remotes.filter(remote => selected.includes(remote))
  const upstreamRemote = confirmRemotes[0] ?? ''

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 40 }} />
        <Dialog.Content
          onOpenAutoFocus={event => {
            event.preventDefault()
            cancelRef.current?.focus()
          }}
          style={{
            position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
            width: 460, background: 'var(--bg-panel)', borderRadius: 10,
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)', zIndex: 50, padding: 24,
          }}
        >
          <Dialog.Title style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-pri)', marginBottom: 8 }}>
            {t('push.dialog.title')}
          </Dialog.Title>
          <Dialog.Description style={{ fontSize: 12, color: 'var(--text-sec)', marginBottom: 20 }}>
            {t('push.dialog.description', { branch: info.branch })}
          </Dialog.Description>
          {remotes.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-sec)' }}>{t('push.dialog.noRemotes')}</p>
          ) : (
            <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              <legend style={{ fontSize: 12, color: 'var(--text-pri)', marginBottom: 6, padding: 0 }}>
                {t('push.dialog.remotes')}
              </legend>
              {remotes.map(remote => (
                <label key={remote} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 12, color: 'var(--text-pri)', cursor: 'pointer', userSelect: 'none',
                }}>
                  <input
                    type="checkbox"
                    checked={selected.includes(remote)}
                    onChange={() => toggleRemote(remote)}
                    style={{ cursor: 'pointer' }}
                  />
                  {remote}
                </label>
              ))}
            </fieldset>
          )}
          {upstreamRemote && !info.upstream && (
            <p style={{ fontSize: 12, color: 'var(--text-sec)', marginTop: 12 }}>
              {t('push.dialog.createUpstream', { remote: upstreamRemote, branch: info.branch })}
            </p>
          )}
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 16,
            fontSize: 12, color: 'var(--text-pri)', cursor: 'pointer', userSelect: 'none',
          }}>
            <input
              type="checkbox"
              checked={pushTags}
              onChange={event => setPushTags(event.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            {t('push.dialog.pushTags')}
          </label>
          <p style={{ fontSize: 11, color: 'var(--text-ter)', marginTop: 4 }}>
            {t('push.dialog.pushTagsHint')}
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 24 }}>
            <Dialog.Close asChild>
              <Button ref={cancelRef} variant="secondary">{t('push.dialog.cancel')}</Button>
            </Dialog.Close>
            <Button disabled={confirmRemotes.length === 0} onClick={() => onConfirm(confirmRemotes, pushTags)}
              variant="primary">
              {t('push.dialog.confirm')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
