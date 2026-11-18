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
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestAIRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Method != "POST" {
			t.Error("wrong API route")
		}
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Error("missing auth")
		}
		var body struct {
			Model    string
			Messages []struct{ Role, Content string }
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Model != "test-model" || len(body.Messages) != 2 || !strings.Contains(body.Messages[1].Content, "staged-only") {
			t.Error("incorrect payload")
		}
		w.Write([]byte(`{"choices":[{"message":{"content":"Add feature\n\nExplain the change."}}]}`))
	}))
	defer server.Close()
	got, err := requestCommitMessage(context.Background(), server.Client(), AISettings{BaseURL: server.URL + "/v1", Model: "test-model"}, "secret", "staged-only")
	if err != nil || got != "Add feature\n\nExplain the change." {
		t.Fatalf("%q %v", got, err)
	}
}

func TestAIResponseErrors(t *testing.T) {
	for _, test := range []struct {
		name   string
		status int
		body   string
	}{
		{"unauthorized", 401, "sensitive-provider-secret"}, {"rate limit", 429, "quota"}, {"malformed", 200, "not JSON"}, {"empty choices", 200, `{"choices":[]}`}, {"empty content", 200, `{"choices":[{"message":{"content":" "}}]}`}, {"oversized", 200, strings.Repeat("x", 32769)},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(test.status); w.Write([]byte(test.body)) }))
			defer server.Close()
			_, err := requestCommitMessage(context.Background(), server.Client(), AISettings{BaseURL: server.URL}, "secret", "diff")
			if err == nil || strings.Contains(err.Error(), "sensitive-provider-secret") {
				t.Fatalf("unsafe or missing error: %v", err)
			}
		})
	}
}

func TestAIRequestBoundsAndCancellation(t *testing.T) {
	for _, diff := range []string{"", strings.Repeat("x", maxAIDiff+1)} {
		if _, err := requestCommitMessage(context.Background(), http.DefaultClient, AISettings{}, "", diff); err == nil {
			t.Fatal("expected input bound error")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := requestCommitMessage(ctx, &http.Client{Timeout: time.Second}, AISettings{BaseURL: "https://example.invalid"}, "key", "diff"); err == nil {
		t.Fatal("expected cancellation")
	}
	var b boundedBuffer
	if _, err := b.Write(make([]byte, maxAIDiff+1)); err == nil || b.Len() != 0 {
		t.Fatal("bounded diff accepted oversized data")
	}
	if _, err := b.Write(make([]byte, maxAIDiff)); err != nil || b.Len() != maxAIDiff {
		t.Fatalf("bounded diff rejected exact limit: %v", err)
	}
	if _, err := b.Write([]byte("x")); err == nil || b.Len() != maxAIDiff {
		t.Fatal("bounded diff accepted cumulative overflow")
	}
}

func TestAIRequestAcceptsLargerDiffsAndLimit(t *testing.T) {
	received := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct{ Content string }
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if len(body.Messages) != 2 {
			t.Error("expected system and user messages")
			return
		}
		received <- body.Messages[1].Content
		w.Write([]byte(`{"choices":[{"message":{"content":"Describe changes"}}]}`))
	}))
	defer server.Close()

	for _, size := range []int{64*1024 + 1, maxAIDiff} {
		diff := strings.Repeat("x", size)
		_, err := requestCommitMessage(context.Background(), server.Client(), AISettings{BaseURL: server.URL}, "key", diff)
		if err != nil {
			t.Fatalf("size %d: %v", size, err)
		}
		if got := <-received; got != "Staged diff:\n"+diff {
			t.Fatalf("size %d: diff was not sent in full", size)
		}
	}
}

func TestStagedAIDiffLargerThanPreviousLimit(t *testing.T) {
	dir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git: %s %v", out, err)
		}
	}
	run("init")
	path := filepath.Join(dir, "large.txt")
	content := strings.Repeat("staged content\n", 5000)
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	run("add", "large.txt")
	diff, err := stagedAIDiff(context.Background(), dir)
	if err != nil || len(diff) <= 64*1024 || !strings.Contains(diff, "+staged content") {
		t.Fatalf("expected full diff larger than 64 KiB, got %d bytes: %v", len(diff), err)
	}

	if err := os.WriteFile(path, []byte(strings.Repeat("staged content\n", maxAIDiff/10)), 0600); err != nil {
		t.Fatal(err)
	}
	run("add", "large.txt")
	if _, err := stagedAIDiff(context.Background(), dir); err == nil || !strings.Contains(err.Error(), "512 KiB") {
		t.Fatalf("expected oversized diff error with current limit, got %v", err)
	}
}

func TestAISettingsValidation(t *testing.T) {
	for _, url := range []string{"http://remote.example/v1", "https://user:secret@example.com", "https://example.com?key=secret", "file:///tmp/test"} {
		if validateAISettings(AISettings{Provider: "openrouter", BaseURL: url, Model: "model"}) == nil {
			t.Errorf("accepted %s", url)
		}
	}
	for _, url := range []string{"https://openrouter.ai/api/v1", "http://127.0.0.1:1234/v1"} {
		if err := validateAISettings(AISettings{Provider: "openrouter", BaseURL: url, Model: "model"}); err != nil {
			t.Error(err)
		}
	}
}

func TestStagedAIDiffExcludesWorktree(t *testing.T) {
	dir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git: %s %v", out, err)
		}
	}
	run("init")
	path := filepath.Join(dir, "change.txt")
	if err := os.WriteFile(path, []byte("staged-content\n"), 0600); err != nil {
		t.Fatal(err)
	}
	run("add", "change.txt")
	if err := os.WriteFile(path, []byte("unstaged-private-content\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "untracked.txt"), []byte("untracked-private"), 0600); err != nil {
		t.Fatal(err)
	}
	diff, err := stagedAIDiff(context.Background(), dir)
	if err != nil || !strings.Contains(diff, "staged-content") || strings.Contains(diff, "unstaged-private") || strings.Contains(diff, "untracked") {
		t.Fatalf("incorrect staged diff: %q %v", diff, err)
	}
	run("rm", "--cached", "-f", "change.txt")
	if _, err := stagedAIDiff(context.Background(), dir); err == nil {
		t.Fatal("expected empty staging error")
	}
}

// cliScript writes an executable shell script into dir and returns its path.
func cliScript(t *testing.T, dir, name, body string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCLISettingsValidation(t *testing.T) {
	// A settings file written before authMode existed has no mode and must keep
	// working as the API key path.
	legacy := AISettings{Provider: "openrouter", BaseURL: "https://openrouter.ai/api/v1", Model: "openai/gpt-4o-mini"}
	if got := normalizeAISettings(legacy); got.AuthMode != authModeAPIKey || got.CLI != "claude" {
		t.Fatalf("unexpected defaults: %+v", got)
	}
	if err := validateAISettings(legacy); err != nil {
		t.Errorf("legacy settings rejected: %v", err)
	}
	if err := validateAISettings(AISettings{AuthMode: authModeCLI, CLI: "claude"}); err != nil {
		t.Errorf("preset without a path rejected: %v", err)
	}
	if err := validateAISettings(AISettings{AuthMode: authModeCLI, CLI: "nonsense"}); err == nil {
		t.Error("accepted an unknown CLI")
	}
	if err := validateAISettings(AISettings{AuthMode: authModeCLI, CLI: cliCustomPreset}); err == nil {
		t.Error("accepted a custom CLI without a path")
	}
	if err := validateAISettings(AISettings{AuthMode: authModeCLI, CLI: cliCustomPreset, CLIPath: "/usr/local/bin/my-cli"}); err != nil {
		t.Errorf("rejected a custom CLI with a path: %v", err)
	}
	if err := validateAISettings(AISettings{AuthMode: authModeCLI, CLI: cliCustomPreset, CLIPath: "/tmp/x\nrm -rf /"}); err == nil {
		t.Error("accepted a path containing a newline")
	}
	if err := validateAISettings(AISettings{AuthMode: "nonsense"}); err == nil {
		t.Error("accepted an unknown auth mode")
	}
}

func TestCLICommitMessage(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fixture")
	}
	dir := t.TempDir()
	capture := filepath.Join(dir, "stdin.txt")
	script := cliScript(t, dir, "fake-cli", "cat > '"+capture+"'\nprintf 'feat: fake subject\\n\\nBody from the fake CLI.\\n'\n")
	settings := AISettings{AuthMode: authModeCLI, CLI: cliCustomPreset, CLIPath: script}

	got, err := runCLICommitMessage(context.Background(), settings, "+++ b/app.go\n+added line\n")
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if got != "feat: fake subject\n\nBody from the fake CLI." {
		t.Fatalf("unexpected message: %q", got)
	}
	prompt, err := os.ReadFile(capture)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(prompt), aiSystemPrompt) || !strings.Contains(string(prompt), aiDiffPrefix) || !strings.Contains(string(prompt), "+added line") {
		t.Fatalf("prompt was not piped to the CLI: %q", string(prompt))
	}
}

func TestCLICommitMessageErrors(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fixture")
	}
	cases := []struct {
		name string
		body string
		want []string
	}{
		{"exit code and stderr", "echo 'token expired' >&2\nexit 3\n", []string{"exit code 3", "token expired"}},
		{"empty output", "exit 0\n", []string{"empty message"}},
		{"too much output", "i=0\nwhile [ $i -lt 40000 ]; do printf x; i=$((i+1)); done\n", []string{"too much output"}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			script := cliScript(t, t.TempDir(), "fake-cli", test.body)
			_, err := runCLICommitMessage(context.Background(), AISettings{AuthMode: authModeCLI, CLI: cliCustomPreset, CLIPath: script}, "diff")
			if err == nil {
				t.Fatal("expected an error")
			}
			for _, want := range test.want {
				if !strings.Contains(err.Error(), want) {
					t.Fatalf("error %q does not contain %q", err, want)
				}
			}
		})
	}

	t.Run("missing binary", func(t *testing.T) {
		t.Setenv("PATH", t.TempDir())
		_, err := runCLICommitMessage(context.Background(), AISettings{AuthMode: authModeCLI, CLI: "claude"}, "diff")
		if err == nil || !strings.Contains(err.Error(), "claude") {
			t.Fatalf("missing binary not reported: %v", err)
		}
	})

	t.Run("path is a directory", func(t *testing.T) {
		dir := t.TempDir()
		_, err := runCLICommitMessage(context.Background(), AISettings{AuthMode: authModeCLI, CLI: cliCustomPreset, CLIPath: dir}, "diff")
		if err == nil || !strings.Contains(err.Error(), "configured path") {
			t.Fatalf("directory not reported: %v", err)
		}
	})

	t.Run("diff bounds", func(t *testing.T) {
		for _, diff := range []string{"", strings.Repeat("x", maxAIDiff+1)} {
			if _, err := runCLICommitMessage(context.Background(), AISettings{AuthMode: authModeCLI, CLI: "claude"}, diff); err == nil || !strings.Contains(err.Error(), "512 KiB") {
				t.Fatalf("expected a diff bound error for %d bytes: %v", len(diff), err)
			}
		}
	})
}

func TestCLICommitMessageTimeout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fixture")
	}
	script := cliScript(t, t.TempDir(), "slow-cli", "sleep 5\n")
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := runCLICommitMessage(ctx, AISettings{AuthMode: authModeCLI, CLI: cliCustomPreset, CLIPath: script}, "diff")
	if err == nil || !strings.Contains(err.Error(), "did not finish in time") {
		t.Fatalf("timeout not reported: %v", err)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("timeout was not enforced, took %s", elapsed)
	}
}

// testOutputPreset registers a preset whose message is written to the file
// named by cliOutputArg, the way Codex CLI is invoked.
func testOutputPreset(t *testing.T, binary string) string {
	t.Helper()
	const name = "test-output-file"
	previous, existed := cliPresets[name]
	cliPresets[name] = cliPreset{Binary: binary, Args: []string{"--output-last-message", cliOutputArg}}
	t.Cleanup(func() {
		if existed {
			cliPresets[name] = previous
			return
		}
		delete(cliPresets, name)
	})
	return name
}

func TestCLICommitMessageUsesOutputFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fixture")
	}
	// Codex CLI echoes the prompt and its log to stdout and writes only the
	// message to the output file; the transcript must not become the message.
	body := "out=\"$2\"\n" +
		"i=0\nwhile [ $i -lt 40000 ]; do printf 'x'; i=$((i+1)); done\n" +
		"printf 'feat: from the output file\\n\\nBody from the file.\\n' > \"$out\"\n"
	script := cliScript(t, t.TempDir(), "fake-cli", body)
	settings := AISettings{AuthMode: authModeCLI, CLI: testOutputPreset(t, script)}

	got, err := runCLICommitMessage(context.Background(), settings, "diff")
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if got != "feat: from the output file\n\nBody from the file." {
		t.Fatalf("unexpected message: %q", got)
	}
}

func TestCLICommitMessageOutputFileMissing(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fixture")
	}
	// A CLI that exits 0 without a message leaves the reason on the transcript.
	body := "printf 'starting\\n'\nprintf \"ERROR: the 'x' model is not supported\\n\"\n"
	script := cliScript(t, t.TempDir(), "fake-cli", body)
	settings := AISettings{AuthMode: authModeCLI, CLI: testOutputPreset(t, script)}

	_, err := runCLICommitMessage(context.Background(), settings, "diff")
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, want := range []string{"empty message", "model is not supported"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error %q does not contain %q", err, want)
		}
	}
}

func TestCLICommitMessageOutputFileOversized(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fixture")
	}
	body := "out=\"$2\"\ni=0\nwhile [ $i -lt 40000 ]; do printf 'x'; i=$((i+1)); done > \"$out\"\n"
	script := cliScript(t, t.TempDir(), "fake-cli", body)
	settings := AISettings{AuthMode: authModeCLI, CLI: testOutputPreset(t, script)}

	if _, err := runCLICommitMessage(context.Background(), settings, "diff"); err == nil || !strings.Contains(err.Error(), "too much output") {
		t.Fatalf("oversized output not reported: %v", err)
	}
}

func TestPrepareCLIOutput(t *testing.T) {
	args := []string{"exec", "--output-last-message", cliOutputArg}
	got, file, cleanup, err := prepareCLIOutput(args)
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if file == "" || got[2] == cliOutputArg || got[2] != file {
		t.Fatalf("placeholder not replaced: %v (file %q)", got, file)
	}
	// The preset's own slice must survive: it is shared by every call.
	if args[2] != cliOutputArg {
		t.Fatalf("preset arguments were modified: %v", args)
	}
	if _, err := os.Stat(file); err != nil {
		t.Fatalf("output file was not created: %v", err)
	}
	cleanup()
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatalf("output file was not removed: %v", err)
	}

	plain, file, cleanup, err := prepareCLIOutput([]string{"-p"})
	defer cleanup()
	if err != nil || file != "" || len(plain) != 1 {
		t.Fatalf("preset without an output file changed: %v, %q, %v", plain, file, err)
	}
}

func TestCodexPresetTakesMessageFromFile(t *testing.T) {
	// Codex CLI exits 0 after a stream error and prints its transcript to
	// stdout, so the preset must read --output-last-message.
	preset, ok := cliPresets["codex"]
	if !ok {
		t.Fatal("codex preset missing")
	}
	if preset.Binary != "codex" {
		t.Fatalf("unexpected binary: %q", preset.Binary)
	}
	joined := strings.Join(preset.Args, " ")
	for _, want := range []string{"exec", "--skip-git-repo-check", "--output-last-message", cliOutputArg} {
		if !strings.Contains(joined, want) {
			t.Fatalf("codex preset %q does not contain %q", joined, want)
		}
	}
}
