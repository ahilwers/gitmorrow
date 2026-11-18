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
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// maxPushPrefRepos caps how many repositories keep a remembered push choice, so
// the config file cannot grow with every repository the user ever pushed to.
const maxPushPrefRepos = 20

// pushPrefsMu serializes reads and writes of the push preferences file.
var pushPrefsMu sync.Mutex

// Preferences is the push dialog choice the user confirmed for a repository
// last time. Saved is false while nothing has been confirmed for that path yet,
// so the dialog can fall back to its defaults.
type Preferences struct {
	Remotes  []string `json:"remotes"`
	PushTags bool     `json:"pushTags"`
	Saved    bool     `json:"saved"`
}

// savedPreferences is one entry of the push preferences file. Updated only
// orders the entries when old ones are pruned.
type savedPreferences struct {
	Remotes  []string  `json:"remotes"`
	PushTags bool      `json:"pushTags"`
	Updated  time.Time `json:"updated"`
}

type savedPreferencesFile struct {
	Repos map[string]savedPreferences `json:"repos"`
}

func pushPrefsPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "GitMorrow", "push_prefs.json"), nil
}

// loadPreferencesFile returns the stored preferences. A missing or unusable
// file yields empty preferences: the dialog defaults are always a safe fallback.
func loadPreferencesFile() savedPreferencesFile {
	prefs := savedPreferencesFile{Repos: map[string]savedPreferences{}}
	path, err := pushPrefsPath()
	if err != nil {
		return prefs
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return prefs
	}
	if err := json.Unmarshal(data, &prefs); err != nil || prefs.Repos == nil {
		return savedPreferencesFile{Repos: map[string]savedPreferences{}}
	}
	return prefs
}

// normalizePushRemotes drops blanks, trims surrounding spaces and removes
// duplicates while keeping the order in which the user selected the remotes.
func normalizePushRemotes(remotes []string) []string {
	seen := make(map[string]bool, len(remotes))
	clean := make([]string, 0, len(remotes))
	for _, remote := range remotes {
		name := strings.TrimSpace(remote)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		clean = append(clean, name)
	}
	return clean
}

// repoPrefKey normalizes a repository path into the key used in the file.
func repoPrefKey(repoPath string) string {
	repoPath = strings.TrimSpace(repoPath)
	if repoPath == "" {
		return ""
	}
	return filepath.Clean(repoPath)
}

// Load returns the remembered push dialog choice for a repository. The saved
// remote names are returned as they were confirmed; the caller still has to
// check them against the configured remotes, because a remote may have been
// renamed or removed since.
func Load(repoPath string) Preferences {
	prefs := Preferences{Remotes: []string{}}
	key := repoPrefKey(repoPath)
	if key == "" {
		return prefs
	}
	pushPrefsMu.Lock()
	defer pushPrefsMu.Unlock()
	saved, ok := loadPreferencesFile().Repos[key]
	if !ok {
		return prefs
	}
	prefs.Remotes = normalizePushRemotes(saved.Remotes)
	prefs.PushTags = saved.PushTags
	prefs.Saved = true
	return prefs
}

// SavePreferences stores the choice the user confirmed for a repository so
// the dialog opens with the same selection next time.
func Save(repoPath string, remotes []string, pushTags bool) error {
	key := repoPrefKey(repoPath)
	if key == "" {
		return errors.New("cannot remember push settings without a repository path")
	}
	clean := normalizePushRemotes(remotes)
	if len(clean) == 0 {
		return errors.New("select at least one remote to push to")
	}
	path, err := pushPrefsPath()
	if err != nil {
		return err
	}
	pushPrefsMu.Lock()
	defer pushPrefsMu.Unlock()
	prefs := loadPreferencesFile()
	prefs.Repos[key] = savedPreferences{Remotes: clean, PushTags: pushTags, Updated: time.Now()}
	prunePreferences(prefs.Repos)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(prefs)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// prunePreferences drops the least recently used entries beyond the cap.
func prunePreferences(repos map[string]savedPreferences) {
	if len(repos) <= maxPushPrefRepos {
		return
	}
	keys := make([]string, 0, len(repos))
	for key := range repos {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		return repos[keys[i]].Updated.After(repos[keys[j]].Updated)
	})
	for _, key := range keys[maxPushPrefRepos:] {
		delete(repos, key)
	}
}
