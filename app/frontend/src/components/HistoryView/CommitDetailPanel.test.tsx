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
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import type { CommitNode, DiffFile } from '@/lib/types'
import { CommitDetailPanel } from './CommitDetailPanel'

const commit: CommitNode = {
  hash: 'a'.repeat(40),
  shortHash: 'aaaaaaa',
  message: 'Fix the thing',
  fullMessage: 'Fix the thing',
  author: 'Ada',
  email: 'ada@example.com',
  date: '2026-01-01T10:00:00Z',
  parents: ['b'.repeat(40)],
  refs: [],
  column: 0,
  color: 0,
  lines: [],
}

const files: DiffFile[] = [
  { path: 'src/first.ts', oldPath: '', status: 'M', hunks: [] },
  { path: 'src/second.ts', oldPath: '', status: 'A', hunks: [] },
]

/** Files the mocked commit reports as changed. */
let changedFiles: DiffFile[] = files

vi.mock('@/hooks/useCommits', () => ({
  useCommits: () => ({ data: [commit], isLoading: false }),
}))

vi.mock('@/hooks/useCommitFiles', () => ({
  useCommitFiles: () => ({ data: changedFiles, isLoading: false }),
}))

// The Monaco editor needs a real browser; the panel only needs to know which
// file it hands to the diff.
vi.mock('./DiffViewer', () => ({
  DiffViewer: ({ filePath }: { filePath: string }) => <div data-testid="diff">{filePath}</div>,
}))

/** Sizes the panel body, which jsdom reports as 0 x 0. */
type Size = { width: number; height: number }
let bodySize: Size = { width: 900, height: 600 }
let observers: MockResizeObserver[] = []

class MockResizeObserver {
  private target: Element | null = null
  constructor(private readonly callback: () => void) { observers.push(this) }
  observe(target: Element) {
    this.target = target
    this.notify()
  }
  notify() {
    if (!this.target) return
    Object.defineProperty(this.target, 'clientWidth', { configurable: true, value: bodySize.width })
    Object.defineProperty(this.target, 'clientHeight', { configurable: true, value: bodySize.height })
    this.callback()
  }
  unobserve() {}
  disconnect() { observers = observers.filter(observer => observer !== this) }
}

/** Simulates the panel being resized by its splitter. */
function resizeTo(size: Size) {
  bodySize = size
  for (const observer of observers) observer.notify()
}

beforeEach(() => {
  localStorage.clear()
  changedFiles = files
  bodySize = { width: 900, height: 600 }
  observers = []
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderPanel() {
  render(<CommitDetailPanel commitHash={commit.hash} />)
  return {
    layout: () => document.querySelector<HTMLElement>('[data-layout]')!,
    filePane: () => document.querySelector<HTMLElement>('[data-panel="history-files"]')!,
    fileRows: () => Array.from(document.querySelectorAll<HTMLElement>('[data-file-path]')),
  }
}

describe('commit detail panel layout', () => {
  it('shows the file list and the diff side by side when the panel is wide enough', () => {
    bodySize = { width: 900, height: 600 }
    const { layout, filePane, fileRows } = renderPanel()

    expect(layout().dataset.layout).toBe('side-by-side')
    expect(filePane().style.width).toBe('240px')
    expect(filePane().style.height).toBe('')

    // Neither pane is hidden behind a tab: both are on screen at the same time.
    expect(fileRows().map(row => row.dataset.filePath)).toEqual(files.map(f => f.path))
    expect(screen.getByTestId('diff')).toHaveTextContent('src/first.ts')

    const splitter = screen.getByRole('separator', { name: 'Resize file list' })
    expect(splitter).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('stacks the file list above the diff when the panel is narrow', () => {
    bodySize = { width: 520, height: 600 }
    const { layout, filePane, fileRows } = renderPanel()

    expect(layout().dataset.layout).toBe('stacked')
    // Two files do not need much room, so the diff keeps most of the height.
    expect(filePane().style.width).toBe('')
    expect(filePane().style.height).toBe('120px')
    expect(screen.queryByRole('separator', { name: 'Resize file list' })).toBeNull()

    expect(fileRows()).toHaveLength(files.length)
    expect(screen.getByTestId('diff')).toHaveTextContent('src/first.ts')
  })

  it('gives the stacked file list more height for many files, but caps it', () => {
    changedFiles = Array.from({ length: 40 }, (_, i) => ({
      path: `src/file-${i}.ts`, oldPath: '', status: 'M', hunks: [],
    }))
    bodySize = { width: 520, height: 900 }
    const { filePane } = renderPanel()

    // 40% of 900 pushes above the cap, so the list stops at its maximum.
    expect(filePane().style.height).toBe('320px')
  })

  it('keeps the file list at its minimum height in a very short panel', () => {
    bodySize = { width: 520, height: 280 }
    const { filePane, layout } = renderPanel()
    expect(layout().dataset.layout).toBe('stacked')
    // The diff's preferred minimum height yields to the file list minimum.
    expect(filePane().style.height).toBe('120px')
  })

  it('switches to the side-by-side layout once the panel grows', () => {
    bodySize = { width: 520, height: 600 }
    const { layout } = renderPanel()
    expect(layout().dataset.layout).toBe('stacked')

    act(() => resizeTo({ width: 820, height: 600 }))
    expect(layout().dataset.layout).toBe('side-by-side')
  })

  it('shows the diff of the clicked file while the file list stays visible', () => {
    bodySize = { width: 900, height: 600 }
    const { fileRows } = renderPanel()
    expect(screen.getByTestId('diff')).toHaveTextContent('src/first.ts')

    fireEvent.click(fileRows()[1])

    expect(screen.getByTestId('diff')).toHaveTextContent('src/second.ts')
    expect(fileRows()).toHaveLength(files.length)
  })

  it('resizes the file list with the splitter and persists the width', () => {
    bodySize = { width: 900, height: 600 }
    const { filePane } = renderPanel()
    const splitter = screen.getByRole('separator', { name: 'Resize file list' })

    fireEvent.keyDown(splitter, { key: 'ArrowRight' })
    expect(filePane().style.width).toBe('256px')
    expect(localStorage.getItem('history-filelist-width')).toBe('256')

    fireEvent.keyDown(splitter, { key: 'Home' })
    expect(filePane().style.width).toBe('240px')
  })

  it('caps the file list so the diff keeps its minimum width', () => {
    bodySize = { width: 640, height: 600 }
    const { filePane } = renderPanel()
    const splitter = screen.getByRole('separator', { name: 'Resize file list' })

    for (let i = 0; i < 20; i++) fireEvent.keyDown(splitter, { key: 'ArrowRight' })

    // 640 - 360 (minimum diff) - 4 (splitter) is the widest useful file list.
    expect(filePane().style.width).toBe('276px')
  })

  it('navigates the file list with the arrow keys', () => {
    bodySize = { width: 900, height: 600 }
    const { fileRows } = renderPanel()
    const panel = document.querySelector<HTMLElement>('[data-panel="history-detail"]')!

    fireEvent.keyDown(panel, { key: 'ArrowDown' })
    expect(screen.getByTestId('diff')).toHaveTextContent('src/second.ts')
    expect(fileRows()).toHaveLength(files.length)

    // The last row is a hard stop, the diff does not go blank.
    fireEvent.keyDown(panel, { key: 'ArrowDown' })
    expect(screen.getByTestId('diff')).toHaveTextContent('src/second.ts')

    fireEvent.keyDown(panel, { key: 'ArrowUp' })
    expect(screen.getByTestId('diff')).toHaveTextContent('src/first.ts')

    // …and so is the first row.
    fireEvent.keyDown(panel, { key: 'ArrowUp' })
    expect(screen.getByTestId('diff')).toHaveTextContent('src/first.ts')
  })

  it('navigates with j and k as well', () => {
    bodySize = { width: 900, height: 600 }
    renderPanel()
    const panel = document.querySelector<HTMLElement>('[data-panel="history-detail"]')!

    fireEvent.keyDown(panel, { key: 'j' })
    expect(screen.getByTestId('diff')).toHaveTextContent('src/second.ts')
    fireEvent.keyDown(panel, { key: 'k' })
    expect(screen.getByTestId('diff')).toHaveTextContent('src/first.ts')
  })

  it('jumps to the first and last file with Home and End', () => {
    bodySize = { width: 900, height: 600 }
    renderPanel()
    const panel = document.querySelector<HTMLElement>('[data-panel="history-detail"]')!

    fireEvent.keyDown(panel, { key: 'End' })
    expect(screen.getByTestId('diff')).toHaveTextContent('src/second.ts')
    fireEvent.keyDown(panel, { key: 'Home' })
    expect(screen.getByTestId('diff')).toHaveTextContent('src/first.ts')
  })

  it('scrolls the newly selected row into view', () => {
    bodySize = { width: 900, height: 600 }
    const { filePane } = renderPanel()
    const list = Array.from(filePane().querySelectorAll<HTMLElement>('div'))
      .find(el => el.style.overflowY === 'auto')!
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-file-path]'))

    // jsdom has no layout: model a list viewport of one 40px row starting at y=100.
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 40 })
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 140 } as DOMRect)
    rows.forEach((row, index) => {
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
        top: 100 + index * 30,
        bottom: 130 + index * 30,
      } as DOMRect)
    })
    list.scrollTop = 0

    fireEvent.keyDown(document.querySelector<HTMLElement>('[data-panel="history-detail"]')!, { key: 'ArrowDown' })

    // The second row ends 20px below the viewport, so the list follows by 20px.
    expect(list.scrollTop).toBe(20)
  })

  it('scrolls the file list with PageDown and Ctrl+d', () => {
    bodySize = { width: 900, height: 600 }
    const { filePane } = renderPanel()
    const scrollArea = Array.from(filePane().querySelectorAll<HTMLElement>('div'))
      .find(el => el.style.overflowY === 'auto')!
    Object.defineProperty(scrollArea, 'clientHeight', { configurable: true, value: 100 })
    const scrollBy = vi.fn()
    scrollArea.scrollBy = scrollBy
    const panel = document.querySelector<HTMLElement>('[data-panel="history-detail"]')!

    fireEvent.keyDown(panel, { key: 'PageDown' })
    expect(scrollBy).toHaveBeenCalledWith({ top: 85 })

    scrollBy.mockClear()
    fireEvent.keyDown(panel, { key: 'd', ctrlKey: true })
    expect(scrollBy).toHaveBeenCalledWith({ top: 50 })
  })

  it('leaves keys pressed inside the diff editor to the editor', () => {
    bodySize = { width: 900, height: 600 }
    renderPanel()
    const panel = document.querySelector<HTMLElement>('[data-panel="history-detail"]')!

    fireEvent.keyDown(screen.getByTestId('diff').parentElement!, { key: 'ArrowDown' })

    expect(panel).not.toBeNull()
    expect(screen.getByTestId('diff')).toHaveTextContent('src/first.ts')
  })
})
