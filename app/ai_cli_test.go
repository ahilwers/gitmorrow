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

import "testing"

func TestCLIModeNeedsNoAPIKey(t *testing.T) {
	if needsAPIKey(AISettings{AuthMode: authModeCLI}) {
		t.Error("CLI mode must not require a key from the credential store")
	}
	// The API key mode and a settings file without a mode both need one.
	for _, settings := range []AISettings{{AuthMode: authModeAPIKey}, {}} {
		if !needsAPIKey(settings) {
			t.Errorf("mode %q must require a key", settings.AuthMode)
		}
	}
}
