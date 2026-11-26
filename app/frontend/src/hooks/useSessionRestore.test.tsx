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
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ListWorktrees, OpenRepository, SwitchWorktree } from '@bindings/gitmorrow/app'
import { useGitStore } from '@/stores/gitStore'
import type { WorktreeInfo } from '@/lib/types'
import { useSessionRestore } from './useSessionRestore'

function Harness() {
  useSessionRestore()
  return null
}

function renderHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>)
}

const mainWorktree: WorktreeInfo = { path: '/repo', branch: 'main', head: 'abc1234', isMain: true, isDirty: false }
const linkedWorktree: WorktreeInfo = { path: '/repo-feature', branch: 'feature', head: 'def5678', isMain: false, isDirty: false }

const storeSession = (repo: string, worktree: string | null) =>
  localStorage.setItem('last-session', JSON.stringify({ repo, worktree }))

beforeEach(() => {
  localStorage.clear()
  vi.mocked(OpenRepository).mockReset().mockResolvedValue('/repo')
  vi.mocked(ListWorktrees).mockReset().mockResolvedValue([mainWorktree, linkedWorktree])
  vi.mocked(SwitchWorktree).mockReset().mockResolvedValue(undefined)
  useGitStore.setState({ activeRepo: null, activeWorktree: null, recentRepos: [] })
})
afterEach(cleanup)

describe('session restore', () => {
  it('reopens the repository and worktree of the last session', async () => {
    storeSession('/repo', '/repo-feature')
    renderHarness()

    await waitFor(() => expect(useGitStore.getState().activeRepo).toBe('/repo'))
    expect(OpenRepository).toHaveBeenCalledWith('/repo')
    await waitFor(() => expect(useGitStore.getState().activeWorktree).toBe('/repo-feature'))
    expect(SwitchWorktree).toHaveBeenCalledWith('/repo-feature')
  })

  it('selects nothing and forgets the session when the repository no longer opens', async () => {
    storeSession('/gone', '/repo-feature')
    vi.mocked(OpenRepository).mockRejectedValue(new Error('fatal: not a git repository'))
    renderHarness()

    await waitFor(() => expect(localStorage.getItem('last-session')).toBeNull())
    expect(useGitStore.getState().activeRepo).toBeNull()
    expect(useGitStore.getState().activeWorktree).toBeNull()
    expect(SwitchWorktree).not.toHaveBeenCalled()
  })

  it('falls back to the main worktree when the stored one is no longer listed', async () => {
    storeSession('/repo', '/repo-feature')
    vi.mocked(ListWorktrees).mockResolvedValue([mainWorktree])
    renderHarness()

    await waitFor(() => expect(useGitStore.getState().activeRepo).toBe('/repo'))
    await act(async () => { await Promise.resolve() })
    expect(SwitchWorktree).not.toHaveBeenCalled()
    expect(useGitStore.getState().activeWorktree).toBeNull()
  })

  it('falls back to the main worktree when switching is rejected', async () => {
    storeSession('/repo', '/repo-feature')
    vi.mocked(SwitchWorktree).mockRejectedValue(new Error('worktree /repo-feature: no such file or directory'))
    renderHarness()

    await waitFor(() => expect(SwitchWorktree).toHaveBeenCalledWith('/repo-feature'))
    await act(async () => { await Promise.resolve() })
    expect(useGitStore.getState().activeRepo).toBe('/repo')
    expect(useGitStore.getState().activeWorktree).toBeNull()
  })

  it('keeps the main worktree when the session stored none', async () => {
    storeSession('/repo', null)
    renderHarness()

    await waitFor(() => expect(useGitStore.getState().activeRepo).toBe('/repo'))
    expect(SwitchWorktree).not.toHaveBeenCalled()
    expect(useGitStore.getState().activeWorktree).toBeNull()
  })

  it('ignores an unusable stored entry', async () => {
    localStorage.setItem('last-session', '{not json')
    renderHarness()

    await act(async () => { await Promise.resolve() })
    expect(OpenRepository).not.toHaveBeenCalled()
    expect(useGitStore.getState().activeRepo).toBeNull()
  })

  it('remembers the repository and worktree that are open', async () => {
    renderHarness()
    act(() => { useGitStore.getState().setActiveRepo('/repo') })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('last-session')!)).toEqual({ repo: '/repo', worktree: null }))

    act(() => { useGitStore.getState().setActiveWorktree('/repo-feature') })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('last-session')!)).toEqual({ repo: '/repo', worktree: '/repo-feature' }))
  })
})
