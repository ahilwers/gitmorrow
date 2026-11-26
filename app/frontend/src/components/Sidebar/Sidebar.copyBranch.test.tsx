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
import { useGitStore } from '@/stores/gitStore'
import Sidebar from './Sidebar'

vi.mock('@/hooks/useBranches', () => ({ useBranches: () => ({ data: {
  local: [{ name: 'main', remote: '', isHead: true }, { name: 'topic', remote: '', isHead: false }],
  remotes: [{ name: 'upstream/team/topic', remote: 'upstream', isHead: false }],
} }) }))
vi.mock('@/hooks/useWorktrees', () => ({ useWorktrees: () => ({ data: [] }) }))
vi.mock('@/hooks/useTags', () => ({ useTags: () => ({ data: [] }) }))
vi.mock('@/hooks/useStashes', () => ({ useStashes: () => ({ data: [] }) }))
vi.mock('@/hooks/useStatus', () => ({ useStatus: () => ({}) }))
vi.mock('@/hooks/useCherryPick', () => ({ useCherryPick: () => ({}) }))
// Render menu items directly; Radix pointer-event plumbing is not available in jsdom.
vi.mock('@/components/shared/ContextMenu', async () => {
  const { Button } = await import('@/components/shared/Button')
  return {
    ContextMenu: ({ items, children }: { items: { label?: string; onClick?: () => void }[]; children: React.ReactNode }) => (
      <div>{children}{items.filter(item => item.label).map(item => <Button key={item.label} onClick={item.onClick}>{item.label}</Button>)}</div>
    ),
  }
})

const writeText = vi.fn()
const copyItems = () => screen.getAllByRole('button', { name: 'Copy branch name' })

beforeEach(() => {
  useGitStore.setState({ activeRepo: '/repo', activeWorktree: '/wt', flash: null })
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})
afterEach(cleanup)

describe('branch context menu copy', () => {
  it('offers the entry for every listed branch, including the current one', () => {
    render(<Sidebar />)
    expect(copyItems()).toHaveLength(3)
  })

  it('copies the current branch name', async () => {
    render(<Sidebar />)
    fireEvent.click(copyItems()[0])
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('main'))
  })

  it('copies a local branch name', async () => {
    render(<Sidebar />)
    fireEvent.click(copyItems()[1])
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('topic'))
  })

  it('copies the remote branch name unmodified', async () => {
    render(<Sidebar />)
    fireEvent.click(copyItems()[2])
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('upstream/team/topic'))
  })

  it('reports a failed copy instead of claiming success', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    render(<Sidebar />)
    fireEvent.click(copyItems()[0])
    await waitFor(() => expect(useGitStore.getState().flash?.type).toBe('danger'))
  })
})
