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

package pushprefs

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// useTempConfigDir points os.UserConfigDir at a fresh directory for the test.
func useTempConfigDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)
	t.Setenv("APPDATA", dir) // Windows equivalent, keeps the test portable
	t.Setenv("HOME", dir)
	return dir
}

func TestPushPreferencesRoundTrip(t *testing.T) {
	useTempConfigDir(t)

	if prefs := Load("/repo/one"); prefs.Saved || len(prefs.Remotes) != 0 {
		t.Fatalf("unknown repo returned %+v, want empty preferences", prefs)
	}
	if err := Save("/repo/one", []string{"origin", "fork"}, false); err != nil {
		t.Fatal(err)
	}
	prefs := Load("/repo/one")
	if !prefs.Saved || prefs.PushTags || len(prefs.Remotes) != 2 || prefs.Remotes[0] != "origin" || prefs.Remotes[1] != "fork" {
		t.Fatalf("remembered preferences = %+v", prefs)
	}
	// Other repositories keep their own choice.
	if other := Load("/repo/two"); other.Saved {
		t.Fatalf("other repo inherited preferences: %+v", other)
	}
	// A trailing separator is the same repository.
	if same := Load("/repo/one/"); !same.Saved || same.PushTags != prefs.PushTags {
		t.Fatalf("normalized path lookup = %+v", same)
	}
}

func TestSavePushPreferencesCleansRemotes(t *testing.T) {
	useTempConfigDir(t)
	if err := Save("/repo", []string{" origin ", "", "origin", "fork"}, true); err != nil {
		t.Fatal(err)
	}
	prefs := Load("/repo")
	if len(prefs.Remotes) != 2 || prefs.Remotes[0] != "origin" || prefs.Remotes[1] != "fork" {
		t.Fatalf("cleaned remotes = %v", prefs.Remotes)
	}
	if !prefs.PushTags {
		t.Fatal("push tags flag was not remembered")
	}
	if err := Save("/repo", []string{"", "  "}, true); err == nil {
		t.Fatal("empty selection was accepted")
	}
	if err := Save("", []string{"origin"}, true); err == nil {
		t.Fatal("empty repository path was accepted")
	}
}

func TestPushPreferencesSurviveBrokenFile(t *testing.T) {
	dir := useTempConfigDir(t)
	path := filepath.Join(dir, "GitMorrow", "push_prefs.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if prefs := Load("/repo"); prefs.Saved {
		t.Fatalf("broken file returned %+v, want defaults", prefs)
	}
	// Saving must not be blocked by the unreadable file.
	if err := Save("/repo", []string{"origin"}, true); err != nil {
		t.Fatal(err)
	}
	if prefs := Load("/repo"); !prefs.Saved {
		t.Fatal("preferences were not written over the broken file")
	}
}

func TestPrunePushPreferencesKeepsNewest(t *testing.T) {
	repos := map[string]savedPreferences{}
	for i := 0; i <= maxPushPrefRepos; i++ {
		repos[filepath.Join("/repo", string(rune('a'+i)))] = savedPreferences{
			Remotes: []string{"origin"},
			Updated: time.Unix(int64(i), 0),
		}
	}
	prunePreferences(repos)
	if len(repos) != maxPushPrefRepos {
		t.Fatalf("kept %d entries, want %d", len(repos), maxPushPrefRepos)
	}
	if _, ok := repos["/repo/a"]; ok {
		t.Fatal("oldest entry survived pruning")
	}
	if _, ok := repos[filepath.Join("/repo", string(rune('a'+maxPushPrefRepos)))]; !ok {
		t.Fatal("newest entry was pruned")
	}
}
