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

package git_test

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"gitmorrow/git"
)

func pushGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func remoteRefs(t *testing.T, dir string) string {
	t.Helper()
	return pushGit(t, dir, "for-each-ref", "--format=%(refname)")
}

func TestPushToRemotesPublishesOnlySelectedRemotes(t *testing.T) {
	dir := initRepo(t)
	remote := t.TempDir()
	other := t.TempDir()
	pushGit(t, remote, "init", "--bare")
	pushGit(t, other, "init", "--bare")
	pushGit(t, dir, "checkout", "-b", "feature/publish")
	pushGit(t, dir, "remote", "add", "origin", other)
	pushGit(t, dir, "remote", "add", "selected", remote)
	// Neither auto-setup nor custom push refspecs may change what the confirmed
	// operation publishes.
	pushGit(t, dir, "config", "push.autoSetupRemote", "true")
	pushGit(t, dir, "config", "remote.selected.push", "refs/heads/feature/publish:refs/heads/wrong")
	pushGit(t, dir, "tag", "v1.0")
	repo, err := git.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	info, err := repo.GetPushInfo()
	if err != nil {
		t.Fatal(err)
	}
	if info.Upstream != "" || info.Branch != "feature/publish" || strings.Join(info.Remotes, ",") != "origin,selected" {
		t.Fatalf("unexpected preflight: %+v", info)
	}
	if got := remoteRefs(t, remote); got != "" {
		t.Fatalf("preflight wrote remote: %s", got)
	}
	if err := repo.PushToRemotes([]string{"selected"}, false); err != nil {
		t.Fatal(err)
	}
	if got := pushGit(t, dir, "rev-parse", "--abbrev-ref", "@{upstream}"); got != "selected/feature/publish" {
		t.Fatalf("upstream = %s", got)
	}
	if got := remoteRefs(t, remote); got != "refs/heads/feature/publish" {
		t.Fatalf("remote refs = %s", got)
	}
	if got := remoteRefs(t, other); got != "" {
		t.Fatalf("pushed unselected remote: %s", got)
	}
}

func TestPushToRemotesPushesEverySelectedRemote(t *testing.T) {
	dir := initRepo(t)
	first := t.TempDir()
	second := t.TempDir()
	pushGit(t, first, "init", "--bare")
	pushGit(t, second, "init", "--bare")
	pushGit(t, dir, "checkout", "-b", "feature/fanout")
	pushGit(t, dir, "remote", "add", "first", first)
	pushGit(t, dir, "remote", "add", "second", second)
	repo, err := git.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.PushToRemotes([]string{"first", "second"}, false); err != nil {
		t.Fatal(err)
	}
	want := pushGit(t, dir, "rev-parse", "HEAD")
	for _, remote := range []string{first, second} {
		if got := pushGit(t, remote, "rev-parse", "refs/heads/feature/fanout"); got != want {
			t.Fatalf("remote %s branch = %s, want %s", remote, got, want)
		}
	}
	// Only the first selected remote becomes the upstream.
	if got := pushGit(t, dir, "rev-parse", "--abbrev-ref", "@{upstream}"); got != "first/feature/fanout" {
		t.Fatalf("upstream = %s", got)
	}
}

func TestPushToRemotesSendsTagsOnlyWhenRequested(t *testing.T) {
	dir := initRepo(t)
	remote := t.TempDir()
	pushGit(t, remote, "init", "--bare")
	pushGit(t, dir, "remote", "add", "origin", remote)
	// Both a lightweight tag and an annotated tag must be handled the same way.
	pushGit(t, dir, "tag", "v1.0")
	pushGit(t, dir, "tag", "-a", "v1.1", "-m", "release")
	repo, err := git.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	info, err := repo.GetPushInfo()
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.PushToRemotes([]string{"origin"}, false); err != nil {
		t.Fatal(err)
	}
	refs := remoteRefs(t, remote)
	if !strings.Contains(refs, "refs/heads/"+info.Branch) {
		t.Fatalf("branch missing on remote: %q", refs)
	}
	if strings.Contains(refs, "refs/tags/") {
		t.Fatalf("tags published without consent: %q", refs)
	}
	if err := repo.PushToRemotes([]string{"origin"}, true); err != nil {
		t.Fatal(err)
	}
	refs = remoteRefs(t, remote)
	if !strings.Contains(refs, "refs/tags/v1.0") || !strings.Contains(refs, "refs/tags/v1.1") {
		t.Fatalf("remote refs missing tags: %q", refs)
	}
}

func TestPushToRemotesRejectsInvalidSelection(t *testing.T) {
	scenarios := map[string]func(t *testing.T, dir string, remote string) []string{
		"empty": func(t *testing.T, dir string, remote string) []string {
			return nil
		},
		"unknown remote": func(t *testing.T, dir string, remote string) []string {
			// URLs and paths cannot bypass remote-name validation.
			return []string{remote}
		},
		"duplicate": func(t *testing.T, dir string, remote string) []string {
			return []string{"publish", "publish"}
		},
		"blank name": func(t *testing.T, dir string, remote string) []string {
			return []string{""}
		},
	}
	for name, selectRemotes := range scenarios {
		t.Run(name, func(t *testing.T) {
			dir := initRepo(t)
			remote := t.TempDir()
			pushGit(t, remote, "init", "--bare")
			pushGit(t, dir, "remote", "add", "publish", remote)
			repo, err := git.Open(dir)
			if err != nil {
				t.Fatal(err)
			}
			if err := repo.PushToRemotes(selectRemotes(t, dir, remote), true); err == nil {
				t.Fatal("expected selection validation failure")
			}
			if got := remoteRefs(t, remote); got != "" {
				t.Fatalf("unexpected write: %s", got)
			}
		})
	}

	t.Run("detached", func(t *testing.T) {
		dir := initRepo(t)
		remote := t.TempDir()
		pushGit(t, remote, "init", "--bare")
		pushGit(t, dir, "remote", "add", "publish", remote)
		pushGit(t, dir, "checkout", "--detach")
		repo, err := git.Open(dir)
		if err != nil {
			t.Fatal(err)
		}
		err = repo.PushToRemotes([]string{"publish"}, false)
		if err == nil || !strings.Contains(err.Error(), "detached HEAD") {
			t.Fatalf("detached error = %v", err)
		}
		if got := remoteRefs(t, remote); got != "" {
			t.Fatalf("unexpected write: %s", got)
		}
	})
}

func TestPushInfoNoRemotesDetachedAndLinkedWorktree(t *testing.T) {
	dir := initRepo(t)
	repo, err := git.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	info, err := repo.GetPushInfo()
	if err != nil || len(info.Remotes) != 0 {
		t.Fatalf("no remotes: %+v, %v", info, err)
	}
	linked := filepath.Join(t.TempDir(), "linked")
	pushGit(t, dir, "worktree", "add", "-b", "linked", linked)
	linkedRepo, err := git.Open(linked)
	if err != nil {
		t.Fatal(err)
	}
	info, err = linkedRepo.GetPushInfo()
	if err != nil || info.Branch != "linked" {
		t.Fatalf("linked: %+v, %v", info, err)
	}
	pushGit(t, linked, "checkout", "--detach")
	if _, err := linkedRepo.GetPushInfo(); err == nil || !strings.Contains(err.Error(), "detached HEAD") {
		t.Fatalf("detached error = %v", err)
	}
}

func TestPushToRemotesFailedPushDoesNotSetTracking(t *testing.T) {
	dir := initRepo(t)
	remote := t.TempDir()
	pushGit(t, remote, "init", "--bare")
	pushGit(t, dir, "remote", "add", "publish", remote)
	if err := os.WriteFile(filepath.Join(remote, "hooks", "pre-receive"), []byte("#!/bin/sh\nexit 1\n"), 0755); err != nil {
		t.Fatal(err)
	}
	repo, err := git.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.PushToRemotes([]string{"publish"}, false); err == nil {
		t.Fatal("expected rejected push")
	}
	info, err := repo.GetPushInfo()
	if err != nil || info.Upstream != "" {
		t.Fatalf("failed push configured upstream: %+v, %v", info, err)
	}
	// The CLI auth diagnostic must keep surfacing as the sentinel the frontend
	// recognizes, including the remote it came from.
	if err := os.WriteFile(filepath.Join(remote, "hooks", "pre-receive"), []byte("#!/bin/sh\necho 'authentication failed' >&2\nexit 1\n"), 0755); err != nil {
		t.Fatal(err)
	}
	err = repo.PushToRemotes([]string{"publish"}, false)
	if !errors.Is(err, git.ErrAuthFailed) {
		t.Fatalf("auth error = %v, want ErrAuthFailed", err)
	}
	if err != nil && !strings.Contains(err.Error(), "publish") {
		t.Fatalf("auth error lost the remote name: %v", err)
	}
}
