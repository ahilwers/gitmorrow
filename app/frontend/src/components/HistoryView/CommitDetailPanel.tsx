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

import { Button } from '../shared/Button'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { useGitStore } from '@/stores/gitStore'
import { useCommits } from '@/hooks/useCommits'
import { useCommitFiles } from '@/hooks/useCommitFiles'
import { useResizableWidth } from '@/hooks/useResizableWidth'
import { FileList } from './FileList'
import { DiffViewer } from './DiffViewer'
import { KeyHints } from '@/components/shared/KeyHints'
import { formatRelativeDate } from '@/lib/format'

/** Persisted width of the file list when it sits next to the diff. */
const FILE_LIST_WIDTH_KEY = 'history-filelist-width'
const MIN_FILE_LIST_WIDTH = 160
const MAX_FILE_LIST_WIDTH = 420
const DEFAULT_FILE_LIST_WIDTH = 240
/** Width step used when the splitter is operated with the keyboard. */
const KEYBOARD_RESIZE_STEP = 16
/** Thickness of the splitter between the file list and the diff. */
const SPLITTER_SIZE = 4
/**
 * Detail panel width from which the file list and the diff sit next to each
 * other. Narrower panels stack the two so the diff keeps a usable width.
 */
const SIDE_BY_SIDE_MIN_WIDTH = 620
/** Width the diff keeps at least while the panes sit next to each other. */
const MIN_DIFF_WIDTH = 360
/** Share of the panel height the file list gets at most when the panes are stacked. */
const STACKED_FILE_LIST_RATIO = 0.4
const STACKED_FILE_LIST_MIN_HEIGHT = 120
const STACKED_FILE_LIST_MAX_HEIGHT = 320
/** Height the diff keeps at least when the panes are stacked. */
const STACKED_DIFF_MIN_HEIGHT = 180
/** Row height and stats bar height of the file list, used to size the stacked layout. */
const FILE_ROW_HEIGHT = 30
const FILE_LIST_STATS_HEIGHT = 26

interface CommitDetailPanelProps {
  commitHash: string
}

export function CommitDetailPanel({ commitHash }: CommitDetailPanelProps) {
  const { setSelectedCommit } = useGitStore()
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [focused, setFocused] = useState(false)
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const fileListRef = useRef<HTMLDivElement>(null)
  const diffRef = useRef<HTMLDivElement>(null)

  // Find commit metadata from already-loaded list (no extra network call)
  const { data: commits = [], isLoading: commitsLoading } = useCommits()
  const commit = commits.find(c => c.hash === commitHash) ?? null

  // Only query the commit's files once its metadata is actually available;
  // calling GetCommitDiff on a hash that is not part of the loaded history
  // (e.g. a stale selection from a previous repository) would fail noisily.
  const { data: files = [], isLoading: filesLoading } = useCommitFiles(commit ? commitHash : null)

  // Keep a file selected at all times so the diff pane is never empty while the
  // commit has changed files: an explicit selection sticks for as long as its
  // file belongs to the commit, everything else falls back to the first file.
  // Derived instead of stored, so switching commits never flashes an empty diff.
  const activeFile = files.some(f => f.path === selectedFile) ? selectedFile : (files[0]?.path ?? null)
  // Keyboard navigation starts at the file whose diff is currently shown.
  const activeIndex = files.findIndex(f => f.path === activeFile)

  /** Selects a file for the diff and keeps its row inside the visible list area. */
  const selectFile = useCallback((path: string) => {
    setSelectedFile(path)
    const list = fileListRef.current
    const row = list
      ? Array.from(list.querySelectorAll<HTMLElement>('[data-file-path]'))
        .find(el => el.dataset.filePath === path)
      : undefined
    if (!list || !row) return

    const bounds = row.getBoundingClientRect()
    const top = list.getBoundingClientRect().top + list.clientTop
    const bottom = top + list.clientHeight
    if (bounds.top < top) {
      list.scrollTop += bounds.top - top
    } else if (bounds.bottom > bottom) {
      list.scrollTop += Math.min(bounds.bottom - bottom, bounds.top - top)
    }
  }, [])

  // The file list must leave enough room for the diff. Until the panel has been
  // measured the persisted width is used as-is, so a stored value survives mount.
  const maxFileListWidth = bodySize.width > 0
    ? Math.max(MIN_FILE_LIST_WIDTH, Math.min(MAX_FILE_LIST_WIDTH, bodySize.width - MIN_DIFF_WIDTH - SPLITTER_SIZE))
    : MAX_FILE_LIST_WIDTH

  const {
    width: storedFileListWidth,
    startResize: startFileListResize,
    nudge: nudgeFileListWidth,
    reset: resetFileListWidth,
  } = useResizableWidth({
    storageKey: FILE_LIST_WIDTH_KEY,
    min: MIN_FILE_LIST_WIDTH,
    max: maxFileListWidth,
    initial: DEFAULT_FILE_LIST_WIDTH,
  })
  const fileListWidth = Math.min(storedFileListWidth, maxFileListWidth)
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false)

  // The panel switches between side-by-side and stacked layout depending on how
  // much room its surroundings leave for it. Re-measured whenever the panel body
  // mounts, which only happens once a commit is selected.
  const hasCommit = !!commit
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const measure = () => {
      const next = { width: el.clientWidth, height: el.clientHeight }
      setBodySize(prev => prev.width === next.width && prev.height === next.height ? prev : next)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasCommit])

  const diffWidth = bodySize.width - fileListWidth - SPLITTER_SIZE
  const sideBySide = bodySize.width >= SIDE_BY_SIDE_MIN_WIDTH && diffWidth >= MIN_DIFF_WIDTH
  // Stacked, the file list is only as tall as its rows need — but never taller
  // than a bounded share of the panel, so the diff keeps most of the height.
  const fileListContentHeight = files.length * FILE_ROW_HEIGHT + FILE_LIST_STATS_HEIGHT
  const stackedFileListHeight = Math.max(
    STACKED_FILE_LIST_MIN_HEIGHT,
    Math.min(
      fileListContentHeight,
      STACKED_FILE_LIST_MAX_HEIGHT,
      Math.round(bodySize.height * STACKED_FILE_LIST_RATIO),
      bodySize.height - STACKED_DIFF_MIN_HEIGHT,
    ),
  )

  const onSplitterMouseDown = useCallback((event: React.MouseEvent) => {
    setIsDraggingSplitter(true)
    startFileListResize(event)
    const onUp = () => {
      setIsDraggingSplitter(false)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mouseup', onUp)
  }, [startFileListResize])

  const onSplitterKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      event.stopPropagation()
      nudgeFileListWidth(-KEYBOARD_RESIZE_STEP)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      event.stopPropagation()
      nudgeFileListWidth(KEYBOARD_RESIZE_STEP)
    } else if (event.key === 'Home') {
      event.preventDefault()
      event.stopPropagation()
      resetFileListWidth()
    }
  }, [nudgeFileListWidth, resetFileListWidth])

  const focusCommitList = useCallback(() => {
    document.querySelector<HTMLElement>('[data-panel="history-commits"]')?.focus()
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement
    // Buttons and form controls own their keys, and the diff editor owns
    // everything typed inside it (arrow keys, Esc and Tab included).
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
    if (diffRef.current?.contains(target)) return

    const scroll = fileListRef.current
    const half = scroll ? scroll.clientHeight * 0.5 : 0
    switch (e.key) {
      case 'ArrowDown':
      case 'j': {
        if (e.ctrlKey) break
        e.preventDefault()
        const next = files[Math.min(activeIndex + 1, files.length - 1)]
        if (next) selectFile(next.path)
        break
      }
      case 'ArrowUp':
      case 'k': {
        if (e.ctrlKey) break
        e.preventDefault()
        const prev = files[Math.max(activeIndex - 1, 0)]
        if (prev) selectFile(prev.path)
        break
      }
      case 'Home': {
        e.preventDefault()
        const first = files[0]
        if (first) selectFile(first.path)
        break
      }
      case 'End': {
        e.preventDefault()
        const last = files[files.length - 1]
        if (last) selectFile(last.path)
        break
      }
      case 'd':
        if (!e.ctrlKey) break
        e.preventDefault()
        scroll?.scrollBy({ top: half })
        break
      case 'u':
        if (!e.ctrlKey) break
        e.preventDefault()
        scroll?.scrollBy({ top: -half })
        break
      case 'PageDown':
        e.preventDefault()
        scroll?.scrollBy({ top: (scroll?.clientHeight ?? 0) * 0.85 })
        break
      case 'PageUp':
        e.preventDefault()
        scroll?.scrollBy({ top: -(scroll?.clientHeight ?? 0) * 0.85 })
        break
      case 'h':
        if (!e.ctrlKey) break
        e.preventDefault()
        focusCommitList()
        break
      case 'Tab':
      case 'Escape':
        e.preventDefault()
        focusCommitList()
        break
    }
  }, [activeIndex, files, focusCommitList, selectFile])

  function copyHash() {
    if (!commit) return
    navigator.clipboard.writeText(commit.hash).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!commit) {
    return (
      <div style={{ flex: 1, borderLeft: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-panel)', color: 'var(--text-ter)', fontSize: 12 }}>
        {commitsLoading ? 'Loading…' : 'Select a commit to view details'}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      data-panel="history-detail"
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={e => { if (!containerRef.current?.contains(e.relatedTarget as Node)) setFocused(false) }}
      onKeyDown={handleKeyDown}
      style={{
        flex: 1,
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        outline: 'none',
        boxShadow: focused ? 'inset 2px 0 0 var(--acc)' : 'none',
      }}
    >
      {/* Header */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border-sub)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Hash + copy */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <code style={{
            flex: 1, padding: '4px 8px', background: 'var(--bg-content)',
            borderRadius: 4, fontSize: 11, fontFamily: 'monospace',
            color: 'var(--text-sec)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {commit.hash}
          </code>
          <Button variant="ghost"
            onClick={copyHash}
            title="Copy full hash"
            aria-label="Copy full hash"
            style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer', color: copied ? 'var(--success)' : 'var(--text-ter)', borderRadius: 4 }}
          >
            <Copy size={13} />
          </Button>
        </div>

        {/* Full message — capped so a long message cannot crowd out the panes */}
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-pri)', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 96, overflowY: 'auto' }}>
          {commit.fullMessage || commit.message}
        </p>

        {/* Metadata grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: 11 }}>
          <div>
            <div style={{ color: 'var(--text-ter)', marginBottom: 2 }}>Author</div>
            <div style={{ color: 'var(--text-pri)', fontWeight: 500 }}>{commit.author}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-ter)', marginBottom: 2 }}>Date</div>
            <div style={{ color: 'var(--text-pri)' }}>{formatRelativeDate(commit.date)}</div>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ color: 'var(--text-ter)', marginBottom: 2 }}>Email</div>
            <div style={{ color: 'var(--text-sec)', fontFamily: 'monospace', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{commit.email}</div>
          </div>
        </div>

        {/* Parent links */}
        {commit.parents.length > 0 && (
          <div>
            <div style={{ color: 'var(--text-ter)', fontSize: 11, marginBottom: 4 }}>
              {commit.parents.length === 1 ? 'Parent' : 'Parents'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {commit.parents.map((p, i) => (
                <code
                  key={i}
                  onClick={() => setSelectedCommit(p)}
                  style={{
                    padding: '2px 6px', background: 'var(--bg-content)',
                    borderRadius: 4, fontSize: 11, fontFamily: 'monospace',
                    color: 'var(--acc)', cursor: 'pointer',
                  }}
                  title={p}
                >
                  {p.slice(0, 7)}
                </code>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* File list + diff: side by side when wide enough, stacked otherwise */}
      <div
        ref={bodyRef}
        data-layout={sideBySide ? 'side-by-side' : 'stacked'}
        style={{
          flex: 1, minHeight: 0, minWidth: 0,
          display: 'flex',
          flexDirection: sideBySide ? 'row' : 'column',
          overflow: 'hidden',
        }}
      >
        <div
          data-panel="history-files"
          // Clicking a row moves the focus here, so the arrow keys navigate the
          // list right after picking a file with the mouse.
          onMouseDown={() => containerRef.current?.focus()}
          style={{
            flexShrink: 0,
            width: sideBySide ? fileListWidth : undefined,
            height: sideBySide ? undefined : stackedFileListHeight,
            minHeight: 0, minWidth: 0,
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
            borderRight: sideBySide ? '1px solid var(--border-sub)' : undefined,
            borderBottom: sideBySide ? undefined : '1px solid var(--border-sub)',
          }}
        >
          {filesLoading
            ? <Loading />
            : <FileList files={files} selectedFile={activeFile} onSelect={selectFile} scrollRef={fileListRef} />
          }
        </div>

        {sideBySide && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize file list"
            aria-valuenow={fileListWidth}
            aria-valuemin={MIN_FILE_LIST_WIDTH}
            aria-valuemax={maxFileListWidth}
            tabIndex={0}
            onMouseDown={onSplitterMouseDown}
            onKeyDown={onSplitterKeyDown}
            onDoubleClick={resetFileListWidth}
            style={{
              width: SPLITTER_SIZE, flexShrink: 0, cursor: 'col-resize',
              background: isDraggingSplitter ? 'var(--acc)' : 'var(--border-sub)',
              transition: isDraggingSplitter ? 'none' : 'background 0.15s',
              outline: 'none',
            }}
            onMouseEnter={e => { if (!isDraggingSplitter) e.currentTarget.style.background = 'var(--acc)' }}
            onMouseLeave={e => { if (!isDraggingSplitter) e.currentTarget.style.background = 'var(--border-sub)' }}
          />
        )}

        <div
          ref={diffRef}
          style={{
            flex: 1, minWidth: 0, minHeight: 0,
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {activeFile
            ? (
              <>
                {/* Which file the diff below belongs to */}
                <div
                  title={activeFile}
                  style={{
                    flexShrink: 0, height: 26, display: 'flex', alignItems: 'center',
                    padding: '0 12px', borderBottom: '1px solid var(--border-sub)',
                    fontSize: 11, fontFamily: 'monospace', color: 'var(--text-sec)',
                    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  }}
                >
                  {activeFile}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                  <DiffViewer commitHash={commit.hash} filePath={activeFile} />
                </div>
              </>
            )
            : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 16, textAlign: 'center', color: 'var(--text-ter)', fontSize: 12 }}>
                {filesLoading
                  ? 'Loading…'
                  : files.length === 0 ? 'This commit does not change any files' : 'Select a file to view its diff'}
              </div>
            )
          }
        </div>
      </div>

      {focused && (
        <KeyHints hints={[
          { keys: ['↑', '↓'], label: 'Navigate' },
          { keys: ['Tab', 'Esc'], label: 'Commits' },
        ]} />
      )}
    </div>
  )
}

function Loading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 12, color: 'var(--text-ter)' }}>
      Loading…
    </div>
  )
}
