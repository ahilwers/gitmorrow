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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Fetch, GetPushInfo, GetPushPreferences, GetStatus, PullForUI, PushToRemotes, SavePushPreferences,
} from '@bindings/gitmorrow/app'
import { useGitStore } from '@/stores/gitStore'
import { useKeyboard } from '@/hooks/useKeyboard'
import Toolbar from './Toolbar'
import CommandPalette from '@/components/shared/CommandPalette'

const status = { branch: 'main', ahead: 1, behind: 0, files: [], hasConflicts: false }

// The shortcuts live in a global hook mounted by App; the toolbar subscribes to
// the events they dispatch.
function Harness() {
  useKeyboard()
  return <><Toolbar /><CommandPalette /></>
}

function renderHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>)
  return client
}

function pressShortcut(key: string, target: Element | Window = window) {
  fireEvent.keyDown(target, { key, metaKey: true })
}

// The palette renders a text button per command; the toolbar's icon-only
// buttons carry the same accessible name, so match on the printed shortcut.
function paletteCommand(shortcut: string) {
  const kbd = screen.getAllByText(shortcut).map(el => el.closest('button')).find(Boolean)
  if (!kbd) throw new Error(`command palette entry ${shortcut} not found`)
  return kbd as HTMLButtonElement
}

// Pushing always opens the remote/tag dialog first; confirming it is the step
// the shortcut and palette commands have to reach.
async function confirmPushDialog() {
  const dialog = await screen.findByRole('dialog', { name: 'Push branch' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Push' }))
}

beforeEach(() => {
  vi.mocked(GetStatus).mockReset().mockResolvedValue(status)
  vi.mocked(GetPushInfo).mockReset().mockResolvedValue({ repoPath: '/repo', branch: 'main', upstream: 'origin/main', remotes: ['origin'] })
  vi.mocked(GetPushPreferences).mockReset().mockResolvedValue({ remotes: [], pushTags: true, saved: false })
  vi.mocked(SavePushPreferences).mockReset().mockResolvedValue(undefined)
  vi.mocked(PushToRemotes).mockReset().mockResolvedValue(undefined)
  vi.mocked(Fetch).mockReset().mockResolvedValue(undefined)
  vi.mocked(PullForUI).mockReset().mockResolvedValue({ outcome: 'success' })
  useGitStore.setState({
    activeRepo: '/repo', activeWorktree: null, activeView: 'history',
    recentRepos: [], helpDialogOpen: false, commitFocusRequest: 0,
  })
})

afterEach(() => cleanup())

describe('repository keyboard shortcuts', () => {
  it('pushes the tracked branch on ⌘P', async () => {
    renderHarness()
    pressShortcut('p')

    await waitFor(() => expect(GetPushInfo).toHaveBeenCalled())
    await confirmPushDialog()
    await waitFor(() => expect(PushToRemotes).toHaveBeenCalledWith(['origin'], true))
  })

  it('fetches on ⌘F', async () => {
    renderHarness()
    pressShortcut('f')
    await waitFor(() => expect(Fetch).toHaveBeenCalledWith(''))
  })

  it('pulls on ⌘L', async () => {
    renderHarness()
    await screen.findByRole('status', { name: 'Current branch: main' })
    pressShortcut('l')
    await waitFor(() => expect(PullForUI).toHaveBeenCalledWith('/repo', 'main'))
  })

  it('leaves modified keys inside the diff editor to Monaco', async () => {
    renderHarness()
    const editor = document.createElement('div')
    editor.className = 'monaco-editor'
    document.body.appendChild(editor)

    pressShortcut('p', editor)

    await Promise.resolve()
    expect(GetPushInfo).not.toHaveBeenCalled()
    expect(PushToRemotes).not.toHaveBeenCalled()
    editor.remove()
  })

  it('ignores shortcuts without a repository', async () => {
    useGitStore.setState({ activeRepo: null })
    renderHarness()
    pressShortcut('p')

    await Promise.resolve()
    expect(GetPushInfo).not.toHaveBeenCalled()
  })
})

describe('command palette remote commands', () => {
  it('pushes from the command palette', async () => {
    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Command Palette (⌘K)' }))
    fireEvent.click(await waitFor(() => paletteCommand('⌘P')))

    await confirmPushDialog()
    await waitFor(() => expect(PushToRemotes).toHaveBeenCalledWith(['origin'], true))
  })

  it('fetches from the command palette', async () => {
    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Command Palette (⌘K)' }))
    fireEvent.click(await waitFor(() => paletteCommand('⌘F')))

    await waitFor(() => expect(Fetch).toHaveBeenCalledWith(''))
  })

  it('opens the commit box from the command palette', async () => {
    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Command Palette (⌘K)' }))
    fireEvent.click(await waitFor(() => paletteCommand('⌘↵')))

    expect(useGitStore.getState().activeView).toBe('changes')
    expect(useGitStore.getState().commitFocusRequest).toBe(1)
  })
})
