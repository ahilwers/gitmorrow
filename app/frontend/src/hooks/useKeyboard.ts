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

import { useEffect } from 'react'
import { useGitStore } from '@/stores/gitStore'

// Monaco owns ⌘F (find) and similar chords inside the diff editor; leaving them
// alone keeps the editor's own key handling intact.
function insideMonaco(e: KeyboardEvent) {
  return (e.target as HTMLElement | null)?.closest?.('.monaco-editor') != null
}

export function useKeyboard() {
  const setActiveView = useGitStore((s) => s.setActiveView)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey

      // ⌘K — open command palette
      if (mod && e.key === 'k') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('palette:open'))
      }
      // ⌘1 — History view
      if (mod && e.key === '1') {
        e.preventDefault()
        setActiveView('history')
      }
      // ⌘2 — Changes view
      if (mod && e.key === '2') {
        e.preventDefault()
        setActiveView('changes')
      }
      if (!mod || insideMonaco(e)) return
      // Remote operations are handled by the toolbar, which owns their state.
      if (e.key === 'f') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('git:fetch'))
      }
      if (e.key === 'l') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('git:pull'))
      }
      if (e.key === 'p') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('git:push'))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setActiveView])
}
