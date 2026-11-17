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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GetPushInfo, GetStatus, PushToRemotes } from '@bindings/gitmorrow/app'
import { useGitStore } from '@/stores/gitStore'
import Toolbar from './Toolbar'
import i18n from '@/i18n'

function renderToolbar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(<QueryClientProvider client={client}><Toolbar /></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Push' }))
  return invalidate
}

const untracked = { repoPath: '/repo', branch: 'feature/new', upstream: '', remotes: ['origin'] }

async function pushDialog() {
  return screen.findByRole('dialog', { name: 'Push branch' })
}

describe('push dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(GetStatus).mockReset().mockResolvedValue({ branch: 'feature/new', ahead: 1, behind: 0, files: [], hasConflicts: false })
    vi.mocked(GetPushInfo).mockResolvedValue(untracked)
    vi.mocked(PushToRemotes).mockResolvedValue(undefined)
    useGitStore.setState({ activeRepo: '/repo', recentRepos: [], flash: null, loadingOperation: null })
  })
  afterEach(async () => {
    cleanup()
    await i18n.changeLanguage('en')
  })

  it('selects every remote and pushes tags by default', async () => {
    vi.mocked(GetPushInfo).mockResolvedValue({ ...untracked, upstream: 'origin/feature/new', remotes: ['origin', 'fork'] })
    const invalidate = renderToolbar()

    const dialog = await pushDialog()
    expect(within(dialog).getByRole('checkbox', { name: 'origin' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'fork' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Also push tags' })).toBeChecked()
    expect(PushToRemotes).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Push' }))

    await waitFor(() => expect(PushToRemotes).toHaveBeenCalledWith(['origin', 'fork'], true))
    await waitFor(() => expect(useGitStore.getState().flash?.message).toBe('Pushed successfully'))
    expect(invalidate).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('pushes only the selected remotes and without tags when the user opts out', async () => {
    vi.mocked(GetPushInfo).mockResolvedValue({ ...untracked, upstream: 'origin/feature/new', remotes: ['origin', 'fork'] })
    renderToolbar()

    const dialog = await pushDialog()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'fork' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Also push tags' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Push' }))

    await waitFor(() => expect(PushToRemotes).toHaveBeenCalledWith(['origin'], false))
  })

  it('refuses to push when no remote is selected', async () => {
    vi.mocked(GetPushInfo).mockResolvedValue({ ...untracked, remotes: ['origin', 'fork'] })
    renderToolbar()

    const dialog = await pushDialog()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'origin' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'fork' }))
    expect(within(dialog).getByRole('button', { name: 'Push' })).toBeDisabled()
  })

  it('explains which remote becomes the upstream for an untracked branch', async () => {
    vi.mocked(GetPushInfo).mockResolvedValue({ ...untracked, remotes: ['origin', 'fork'] })
    renderToolbar()

    const dialog = await pushDialog()
    expect(within(dialog).getByText('origin becomes the upstream for feature/new.')).toBeInTheDocument()

    // Dropping origin makes the next selected remote the upstream.
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'origin' }))
    expect(within(dialog).getByText('fork becomes the upstream for feature/new.')).toBeInTheDocument()
  })

  it('does not mention an upstream when the branch is already tracked', async () => {
    vi.mocked(GetPushInfo).mockResolvedValue({ ...untracked, upstream: 'origin/feature/new' })
    renderToolbar()

    const dialog = await pushDialog()
    expect(within(dialog).queryByText(/becomes the upstream/)).not.toBeInTheDocument()
  })

  it.each(['Cancel', 'Escape', 'outside'])('does not write on %s dismissal', async method => {
    renderToolbar()
    const dialog = await pushDialog()
    if (method === 'Cancel') fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    else if (method === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' })
    else {
      const outside = dialog.previousElementSibling!
      fireEvent.pointerDown(outside)
      fireEvent.pointerUp(outside)
      fireEvent.click(outside)
    }
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(PushToRemotes).not.toHaveBeenCalled()
  })

  it('explains missing remotes without allowing a push', async () => {
    vi.mocked(GetPushInfo).mockResolvedValue({ ...untracked, remotes: [] })
    renderToolbar()

    const dialog = await pushDialog()
    expect(dialog).toHaveTextContent('No remotes configured')
    expect(within(dialog).getByRole('button', { name: 'Push' })).toBeDisabled()
    expect(PushToRemotes).not.toHaveBeenCalled()
  })

  it('reports detached HEAD and other preflight failures without opening the dialog', async () => {
    vi.mocked(GetPushInfo).mockRejectedValueOnce(new Error('cannot push from detached HEAD'))
    renderToolbar()

    await waitFor(() => expect(useGitStore.getState().flash?.message).toContain('detached HEAD'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(PushToRemotes).not.toHaveBeenCalled()
  })

  it('preserves the git error and clears loading after a failed confirmed push', async () => {
    vi.mocked(PushToRemotes).mockRejectedValueOnce(new Error('push to origin failed: authentication failed'))
    renderToolbar()

    fireEvent.click(within(await pushDialog()).getByRole('button', { name: 'Push' }))

    await waitFor(() => expect(useGitStore.getState().flash?.message).toContain('authentication failed'))
    expect(useGitStore.getState().loadingOperation).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('dismisses the dialog when the active repository changes', async () => {
    renderToolbar()
    await pushDialog()
    act(() => useGitStore.setState({ activeRepo: '/other' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(PushToRemotes).not.toHaveBeenCalled()
  })

  it('discards a preflight result for a repository that is no longer active', async () => {
    let resolve!: (value: typeof untracked) => void
    vi.mocked(GetPushInfo).mockReturnValueOnce(new Promise(done => { resolve = done }))
    renderToolbar()
    act(() => useGitStore.setState({ activeRepo: '/other' }))
    await act(async () => { resolve(untracked) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(PushToRemotes).not.toHaveBeenCalled()
  })

  it('renders the dialog in German', async () => {
    await i18n.changeLanguage('de')
    vi.mocked(GetPushInfo).mockResolvedValue({ ...untracked, remotes: ['origin', 'fork'] })
    renderToolbar()

    const dialog = await screen.findByRole('dialog', { name: 'Branch pushen' })
    expect(dialog).toHaveTextContent('feature/new in die ausgewählten Remotes veröffentlichen.')
    expect(within(dialog).getByRole('checkbox', { name: 'Tags ebenfalls pushen' })).toBeChecked()
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pushen' }))
    await waitFor(() => expect(PushToRemotes).toHaveBeenCalledWith(['origin', 'fork'], true))
  })
})
