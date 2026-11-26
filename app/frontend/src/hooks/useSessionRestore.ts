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
import { useQueryClient } from '@tanstack/react-query'
import { ListWorktrees, OpenRepository, SwitchWorktree } from '@bindings/gitmorrow/app'
import { useGitStore } from '@/stores/gitStore'
import type { WorktreeInfo } from '@/lib/types'
import { clearLastSession, loadLastSession, saveLastSession } from '@/lib/lastSession'

/**
 * Reopens the repository and worktree of the previous session on startup and
 * remembers the current selection for the next one.
 *
 * A repository that no longer opens is forgotten and nothing is selected. A
 * worktree that disappeared falls back to the repository's main worktree, so a
 * stale path never reaches the Git backend.
 */
export function useSessionRestore() {
  const queryClient = useQueryClient()
  const activeRepo = useGitStore(s => s.activeRepo)
  const activeWorktree = useGitStore(s => s.activeWorktree)

  useEffect(() => {
    const session = loadLastSession()
    if (!session) return
    let cancelled = false

    void (async () => {
      let repoPath: string
      try {
        repoPath = await OpenRepository(session.repo)
      } catch {
        // The repository is gone: nothing should be selected.
        clearLastSession()
        return
      }
      if (cancelled) return
      useGitStore.getState().setActiveRepo(repoPath)
      queryClient.invalidateQueries()

      // No stored linked worktree, or the repository is the main worktree.
      if (!session.worktree || session.worktree === repoPath) return

      try {
        const worktrees = await ListWorktrees() as WorktreeInfo[]
        if (!worktrees.some(wt => wt.path === session.worktree)) return
        await SwitchWorktree(session.worktree)
        if (cancelled) return
        useGitStore.getState().setActiveWorktree(session.worktree)
        queryClient.invalidateQueries()
      } catch {
        // The stored worktree is unusable; the main worktree stays selected.
      }
    })()

    return () => { cancelled = true }
  }, [queryClient])

  useEffect(() => {
    if (!activeRepo) return
    saveLastSession({ repo: activeRepo, worktree: activeWorktree })
  }, [activeRepo, activeWorktree])
}
