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

package git

import (
	"fmt"
	"sort"

	"github.com/go-git/go-git/v5/plumbing"
)

// PushInfo is a read-only snapshot used before asking to publish a branch.
// An upstream is configured even if its remote-tracking ref is not present yet.
type PushInfo struct {
	RepoPath string   `json:"repoPath"`
	Branch   string   `json:"branch"`
	Upstream string   `json:"upstream"`
	Remotes  []string `json:"remotes"`
}

func (r *Repository) GetPushInfo() (PushInfo, error) {
	info := PushInfo{RepoPath: r.Path, Remotes: []string{}}
	head, err := r.repo.Head()
	if err != nil {
		return info, err
	}
	if !head.Name().IsBranch() {
		return info, fmt.Errorf("cannot push from detached HEAD; check out a branch first")
	}
	info.Branch = head.Name().Short()
	cfg, err := r.repo.Config()
	if err != nil {
		return info, err
	}
	if branch := cfg.Branches[info.Branch]; branch != nil && branch.Remote != "" && branch.Merge != "" {
		info.Upstream = branch.Remote + "/" + branch.Merge.Short()
	}
	for name := range cfg.Remotes {
		info.Remotes = append(info.Remotes, name)
	}
	sort.Strings(info.Remotes)
	return info, nil
}

// PushToRemotes publishes the current branch to every selected remote. Call it
// only after the user confirmed the remote selection and whether tags should be
// published: a repository can reject tag creation with server-side rules, so
// tags must never ride along unasked. The branch is always named explicitly
// (never via push.default or remote.*.push) and the first selected remote becomes
// the upstream when the branch has none yet.
func (r *Repository) PushToRemotes(remotes []string, pushTags bool) error {
	if len(remotes) == 0 {
		return fmt.Errorf("select at least one remote to push to")
	}
	head, err := r.repo.Head()
	if err != nil {
		return err
	}
	if !head.Name().IsBranch() {
		return fmt.Errorf("cannot push from detached HEAD; check out a branch first")
	}
	branch := head.Name().Short()
	cfg, err := r.repo.Config()
	if err != nil {
		return err
	}
	selected := make(map[string]bool, len(remotes))
	for _, remote := range remotes {
		if remote == "" {
			return fmt.Errorf("select a configured remote before pushing")
		}
		if _, ok := cfg.Remotes[remote]; !ok {
			return fmt.Errorf("remote %q is not configured", remote)
		}
		if selected[remote] {
			return fmt.Errorf("remote %q selected twice", remote)
		}
		selected[remote] = true
	}
	tracked := cfg.Branches[branch]
	hasUpstream := tracked != nil && tracked.Remote != "" && tracked.Merge != ""
	src := plumbing.NewBranchReferenceName(branch).String()
	for i, remote := range remotes {
		dst := src
		if hasUpstream && tracked.Remote == remote {
			dst = tracked.Merge.String()
		}
		args := []string{"push"}
		if pushTags {
			// --tags publishes every local tag alongside the branch. An ordinary
			// push only carries tags when named explicitly, and --follow-tags
			// would skip the lightweight tags this app creates.
			args = append(args, "--tags")
		}
		// Only the first remote may create the upstream; later remotes must not
		// overwrite the tracking configuration.
		if i == 0 && !hasUpstream {
			args = append(args, "--set-upstream")
		}
		args = append(args, "--", remote, src+":"+dst)
		if _, err := CLI(r.Path, args...); err != nil {
			if IsAuthError(err) {
				return fmt.Errorf("push to %s failed: %w: %w", remote, ErrAuthFailed, err)
			}
			return fmt.Errorf("push to %s failed: %w", remote, err)
		}
	}
	return nil
}
