---
sidebar_position: 3
title: Using the CLI
description: Complete guide to the DocSynth command-line interface.
---

# Using the CLI

The DocSynth CLI lets you generate documentation locally and manage your configuration.

## Installation

```bash
npm install -g @docsynth/cli
```

Verify installation:

```bash
docsynth --version
```

## Commands Overview

| Command | Description |
|---------|-------------|
| `docsynth init` | Initialize DocSynth in a repository |
| `docsynth generate` | Generate documentation locally |
| `docsynth status` | Check DocSynth status |
| `docsynth config` | View or modify configuration |
| `docsynth login` | Authenticate with DocSynth |

## docsynth init

Initialize DocSynth in your repository:

```bash
docsynth init
```

### Interactive Mode

```
🔧 Initializing DocSynth...

? Which documentation types do you want to generate?
  ◉ README
  ◉ API Reference
  ◉ Changelog
  ◯ Guides/Tutorials

? What tone should the documentation use?
  ❯ Technical (formal, precise)
    Casual (friendly, approachable)
    Formal (professional, enterprise)

? Which branches should trigger documentation? main, master

✅ DocSynth initialized successfully!
```

### Non-Interactive Mode

Skip prompts with defaults:

```bash
docsynth init --yes
```

### Options

| Option | Description |
|--------|-------------|
| `--yes`, `-y` | Use defaults, skip prompts |
| `--force` | Overwrite existing configuration |

### Output

Creates `.docsynth.json`:

```json
{
  "version": 1,
  "triggers": {
    "onPRMerge": true,
    "branches": ["main", "master"]
  },
  "filters": {
    "includePaths": ["src/**/*", "lib/**/*"],
    "excludePaths": ["**/*.test.*", "**/*.spec.*", "**/node_modules/**"]
  },
  "docTypes": {
    "readme": true,
    "apiDocs": true,
    "changelog": true
  },
  "style": {
    "tone": "technical",
    "includeExamples": true
  }
}
```

## docsynth generate

Generate documentation locally:

```bash
docsynth generate
```

### Output

```
📚 Generating documentation...

✔ Found 47 source files
✔ Found 23 exports
✔ Documentation generated

✅ Documentation generated successfully!

Files created:
  • docs/api-reference.md
```

### Options

| Option | Description |
|--------|-------------|
| `--path <dir>` | Repository path (default: current directory) |
| `--output <dir>` | Output directory (default: `docs`) |
| `--dry-run` | Preview without creating files |
| `--pr <number>` | Generate docs for a specific PR |

### Dry Run

Preview what would be generated:

```bash
docsynth generate --dry-run
```

```
📚 Generating documentation...

✔ Found 47 source files
✔ Found 23 exports

📋 Dry run - would generate:

  • README.md
  • docs/api-reference.md
  • CHANGELOG.md (entry)

Exports found:
  - UserService (class) from src/services/user.ts
  - createUser (function) from src/services/user.ts
  - User (interface) from src/types/user.ts
  ... and 20 more
```

### Generate for a Specific PR

Generate docs for a merged PR:

```bash
docsynth generate --pr 42
```

This simulates the webhook flow for testing.

## docsynth status

Check DocSynth status:

```bash
docsynth status
```

### Output

```
📊 DocSynth Status

Configuration: ✓ Found

Settings:
  Triggers:
    • On PR merge: Yes
    • Branches: main, master
  Doc types:
    • readme: enabled
    • apiDocs: enabled
    • changelog: enabled
  Style:
    • Tone: technical
    • Include examples: Yes

Authentication: ✓ Logged in
Docs directory: ✓ Exists
  Found 3 markdown files

Run `docsynth --help` for available commands.
```

## docsynth config

View or modify configuration:

### View Configuration

```bash
docsynth config --show
```

```
📝 DocSynth Configuration

{
  "version": 1,
  "triggers": {
    "onPRMerge": true,
    "branches": ["main", "master"]
  },
  ...
}
```

### Modify Configuration

```bash
docsynth config --set style.tone=casual
```

```
✅ Configuration updated
  style.tone = casual
```

### Options

| Option | Description |
|--------|-------------|
| `--show` | Display current configuration |
| `--set <key=value>` | Set a configuration value |

### Setting Nested Values

Use dot notation for nested keys:

```bash
docsynth config --set triggers.onPush=true
docsynth config --set filters.excludePaths='["**/*.test.*"]'
```

## docsynth login

Authenticate with DocSynth:

```bash
docsynth login
```

### Flow

```
🔐 DocSynth Login

To authenticate, visit the following URL in your browser:

https://docsynth.dev/auth/github?state=abc123

After authorizing, you will receive a token.
? Paste your token here: ********

✅ Logged in as your-username
```

### Token Storage

Tokens are stored securely in `~/.config/docsynth/token`.

### Re-authenticate

If already logged in:

```
You are already logged in. Do you want to re-authenticate? (y/N)
```

## Global Options

Available for all commands:

| Option | Description |
|--------|-------------|
| `--help`, `-h` | Show help |
| `--version`, `-V` | Show version |
| `--verbose` | Verbose output |
| `--quiet` | Minimal output |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Configuration error |
| `3` | Authentication error |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DOCSYNTH_API_URL` | API server URL (for self-hosted) |
| `DOCSYNTH_TOKEN` | Auth token (alternative to login) |
| `DOCSYNTH_CONFIG` | Config file path |

## Scripting

Use the CLI in scripts:

```bash
#!/bin/bash

# Check if initialized
if ! docsynth status --quiet 2>/dev/null; then
  echo "Initializing DocSynth..."
  docsynth init --yes
fi

# Generate docs
docsynth generate --output docs

# Check exit code
if [ $? -eq 0 ]; then
  echo "Documentation generated successfully"
else
  echo "Documentation generation failed"
  exit 1
fi
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Generate Docs
on:
  pull_request:
    types: [closed]
    branches: [main]

jobs:
  docs:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install -g @docsynth/cli
      - run: docsynth generate
        env:
          DOCSYNTH_TOKEN: ${{ secrets.DOCSYNTH_TOKEN }}
```

## Troubleshooting

### Command Not Found

```bash
# Check if installed globally
npm list -g @docsynth/cli

# Reinstall
npm install -g @docsynth/cli
```

### Authentication Issues

```bash
# Clear stored token
rm ~/.config/docsynth/token

# Re-login
docsynth login
```

### Configuration Not Found

```bash
# Initialize if missing
docsynth init

# Or specify path
docsynth generate --path /path/to/repo
```

## Next Steps

- [Configuration Guide](/docs/guides/configuring-docsynth) — All config options
- [Dashboard Overview](/docs/guides/dashboard-overview) — Web interface
- [Troubleshooting](/docs/reference/troubleshooting) — Common issues
