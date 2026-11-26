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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GetStatus } from '@bindings/gitmorrow/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useGitStore } from '@/stores/gitStore'
import i18n from '@/i18n'
import Toolbar from './Toolbar'

// Render menu items directly; Radix pointer-event plumbing is not available in jsdom.
vi.mock('@/components/shared/ContextMenu', async () => {
  const { Button } = await import('@/components/shared/Button')
  return {
    ContextMenu: ({ items, children }: { items: { label?: string; onClick?: () => void }[]; children: React.ReactNode }) => (
      <div>{children}{items.filter(item => item.label).map(item => <Button key={item.label} onClick={item.onClick}>{item.label}</Button>)}</div>
    ),
  }
})

const status = { branch: 'main', ahead: 0, behind: 0, files: [], hasConflicts: false }
const writeText = vi.fn()

function renderToolbar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={client}><Toolbar /></QueryClientProvider>)
}

const copyItem = () => screen.queryByRole('button', { name: 'Copy branch name' })

beforeEach(() => {
  vi.mocked(GetStatus).mockReset().mockResolvedValue(status)
  useGitStore.setState({ activeRepo: '/repo', activeWorktree: null, recentRepos: [], loadingOperation: null, flash: null })
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})
afterEach(async () => { cleanup(); await i18n.changeLanguage('en') })

describe('current branch context menu', () => {
  it('copies the current branch name and confirms it', async () => {
    renderToolbar()
    const item = await waitFor(() => {
      const found = copyItem()
      expect(found).not.toBeNull()
      return found!
    })
    fireEvent.click(item)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('main'))
    await waitFor(() => expect(useGitStore.getState().flash).toEqual({ message: 'Branch name copied', type: 'success' }))
  })

  it('reports a failed copy instead of claiming success', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    renderToolbar()
    fireEvent.click(await screen.findByRole('button', { name: 'Copy branch name' }))
    await waitFor(() => expect(useGitStore.getState().flash).toEqual({ message: 'Could not copy the branch name', type: 'danger' }))
  })

  it('offers no copy entry on a detached HEAD', async () => {
    vi.mocked(GetStatus).mockResolvedValue({ ...status, branch: 'HEAD' })
    renderToolbar()
    await screen.findByText('Detached HEAD')
    expect(copyItem()).toBeNull()
  })

  it('translates the menu entry', async () => {
    await i18n.changeLanguage('de')
    renderToolbar()
    expect(await screen.findByRole('button', { name: 'Branchname kopieren' })).toBeInTheDocument()
  })
})
