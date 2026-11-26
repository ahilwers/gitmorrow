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

/** Repository and worktree that were open when the app was last used. */
export interface LastSession {
  repo: string
  /** Selected linked worktree, or null for the repository's main worktree. */
  worktree: string | null
}

const STORAGE_KEY = 'last-session'

/**
 * Reads the remembered session.
 *
 * Returns null when nothing was stored or the stored value is unusable, so a
 * corrupted entry never selects a half-remembered repository.
 */
export function loadLastSession(): LastSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LastSession> | null
    if (!parsed || typeof parsed.repo !== 'string' || parsed.repo === '') return null
    const worktree = typeof parsed.worktree === 'string' && parsed.worktree !== '' ? parsed.worktree : null
    return { repo: parsed.repo, worktree }
  } catch {
    return null
  }
}

/** Remembers the session for the next start. */
export function saveLastSession(session: LastSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // A storage failure only costs the restore on the next start.
  }
}

/** Forgets the remembered session, e.g. after its repository disappeared. */
export function clearLastSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // nothing to forget when storage is unavailable
  }
}
