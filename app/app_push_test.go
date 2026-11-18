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

package main

import (
	"os/exec"
	"strings"
	"testing"

	gitpkg "gitmorrow/git"
)

func TestPushToRemotesConfirmsSelectionAndPreservesNormalPush(t *testing.T) {
	dir := t.TempDir()
	remote := t.TempDir()
	run := func(path string, args ...string) string {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = path
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	run(remote, "init", "--bare")
	run(dir, "init")
	run(dir, "config", "user.name", "Test")
	run(dir, "config", "user.email", "test@example.com")
	run(dir, "commit", "--allow-empty", "-m", "initial")
	run(dir, "remote", "add", "publish", remote)
	run(dir, "config", "push.autoSetupRemote", "true")
	repo, err := gitpkg.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	app := &App{repo: repo}
	info, err := app.GetPushInfo()
	if err != nil {
		t.Fatal(err)
	}
	if err := app.PushToRemotes(nil, true); err == nil || !strings.Contains(err.Error(), "at least one remote") {
		t.Fatalf("empty selection error = %v", err)
	}
	if got := run(remote, "for-each-ref"); got != "" {
		t.Fatalf("unconfirmed push wrote remote: %s", got)
	}
	if err := app.PushToRemotes([]string{"publish"}, false); err != nil {
		t.Fatal(err)
	}
	if got := run(remote, "rev-parse", "refs/heads/"+info.Branch); got != run(dir, "rev-parse", "HEAD") {
		t.Fatal("push did not publish the branch")
	}
	run(dir, "commit", "--allow-empty", "-m", "next")
	if err := app.PushToRemotes([]string{"publish"}, false); err != nil {
		t.Fatalf("normal tracked push: %v", err)
	}
	if got := run(remote, "rev-parse", "refs/heads/"+info.Branch); got != run(dir, "rev-parse", "HEAD") {
		t.Fatal("tracked push did not advance upstream")
	}
	run(dir, "checkout", "--detach")
	if err := app.PushToRemotes([]string{"publish"}, false); err == nil || !strings.Contains(err.Error(), "detached HEAD") {
		t.Fatalf("detached push error = %v", err)
	}
}

// TestPushPreferencesRoundTrip exercises the bound wrappers, so a broken wiring
// between the app and the preference store fails the app tests.
func TestPushPreferencesRoundTrip(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("HOME", configDir)            // macOS: ~/Library/Application Support
	t.Setenv("XDG_CONFIG_HOME", configDir) // Linux
	t.Setenv("APPDATA", configDir)         // Windows

	app := &App{}
	if prefs := app.GetPushPreferences("/repo"); prefs.Saved || len(prefs.Remotes) != 0 {
		t.Fatalf("unknown repository returned %+v", prefs)
	}
	if err := app.SavePushPreferences("/repo", []string{"origin", "fork"}, false); err != nil {
		t.Fatal(err)
	}
	prefs := app.GetPushPreferences("/repo")
	if !prefs.Saved || prefs.PushTags || len(prefs.Remotes) != 2 || prefs.Remotes[1] != "fork" {
		t.Fatalf("remembered choice = %+v", prefs)
	}
}
