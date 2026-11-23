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

import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { FileStatus, RepoStatus } from '@/lib/types'
import { StageFile, UnstageFile } from '@bindings/gitmorrow/app'
import { FileStatusList } from './FileStatusList'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const files: FileStatus[] = [
  { path: 'a.txt', oldPath: '', staged: '', unstaged: 'M', added: 1, deleted: 0 },
  { path: 'b.txt', oldPath: '', staged: 'M', unstaged: '', added: 1, deleted: 0 },
]

/**
 * Renders the file list next to a stand-in for the diff panel. The real panel
 * prevents the default action of the keys it handles (Ctrl+D scrolls), which is
 * what the guard in the file list reacts to.
 */
function setup(selectedPath: string, selectedStaged: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const status: RepoStatus = { branch: 'main', ahead: 0, behind: 0, files, hasConflicts: false }
  queryClient.setQueryData(['status'], status)

  function Harness() {
    const [selected, setSelected] = useState({ path: selectedPath, staged: selectedStaged })
    return (
      <>
        <FileStatusList
          selectedFile={selected.path}
          selectedStaged={selected.staged}
          onSelectFile={(file, staged) => setSelected({ path: file.path, staged })}
        />
        <div
          // Mirrors ChunkDiffPanel: Ctrl+D/Ctrl+U scroll and consume the event.
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && ['d', 'u'].includes(e.key.toLowerCase())) e.preventDefault() }}
          data-panel="changes-diff"
          tabIndex={0}
        >
          <button type="button">Stage hunk</button>
        </div>
      </>
    )
  }

  const { container } = render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>)
  const diffPanel = container.querySelector<HTMLElement>('[data-panel="changes-diff"]')!
  act(() => diffPanel.focus())
  return { diffPanel, container }
}

describe('stage, unstage and discard shortcuts in the diff panel', () => {
  it('stages the shown unstaged file with S', async () => {
    const { diffPanel } = setup('a.txt', false)

    act(() => { fireEvent.keyDown(diffPanel, { key: 's' }) })

    await waitFor(() => expect(StageFile).toHaveBeenCalledWith('a.txt'))
  })

  it('accepts the shifted variant of the key as well', async () => {
    const { diffPanel } = setup('a.txt', false)

    act(() => { fireEvent.keyDown(diffPanel, { key: 'S', shiftKey: true }) })

    await waitFor(() => expect(StageFile).toHaveBeenCalledWith('a.txt'))
  })

  it('unstages the shown staged file with U', async () => {
    const { diffPanel } = setup('b.txt', true)

    act(() => { fireEvent.keyDown(diffPanel, { key: 'u' }) })

    await waitFor(() => expect(UnstageFile).toHaveBeenCalledWith('b.txt'))
  })

  it('opens the discard confirmation for the shown file with D', async () => {
    const { diffPanel } = setup('a.txt', false)

    act(() => { fireEvent.keyDown(diffPanel, { key: 'd' }) })

    const dialog = await screen.findByRole('dialog', { name: 'Discard changes' })
    expect(dialog).toHaveTextContent('a.txt')
  })

  it('leaves the keys alone while a button inside the panel has the focus', async () => {
    const { container } = setup('a.txt', false)
    const button = container.querySelector('[data-panel="changes-diff"] button') as HTMLButtonElement

    act(() => { button.focus() })
    // Let the mutation queue drain so a wrong dispatch would be visible here.
    await act(async () => { fireEvent.keyDown(button, { key: 's' }) })

    expect(StageFile).not.toHaveBeenCalled()
  })

  it('ignores a key the panel already handled, like its Ctrl+D page scroll', async () => {
    const { diffPanel } = setup('a.txt', false)

    act(() => { fireEvent.keyDown(diffPanel, { key: 'd', ctrlKey: true }) })

    expect(screen.queryByRole('dialog', { name: 'Discard changes' })).not.toBeInTheDocument()
  })
})
