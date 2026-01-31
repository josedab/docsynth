# DocSynth VS Code Extension

AI-powered documentation that stays current with your code.

## Features

### 📝 Real-Time Documentation Preview
See what documentation would be generated as you write code, with suggestions for improvements.

### 🔍 Inline Documentation Hints
Code lenses show where documentation is missing, with one-click generation.

### 📊 Documentation Health Dashboard
Monitor the freshness of your documentation across the entire repository.

### 🎨 Style Enforcement
Automatically check documentation against your team's style guide.

### ⚡ AI-Powered Generation
Generate high-quality documentation using AI, matching your team's writing style.

## Installation

1. Install the extension from VS Code Marketplace
2. Open Command Palette (`Cmd/Ctrl+Shift+P`)
3. Run `DocSynth: Login` and enter your API token
4. Run `DocSynth: Select Repository` to connect a repository

## Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| Generate Documentation | - | Generate docs for the current file |
| Preview Documentation | `Cmd/Ctrl+Shift+P` | Preview what docs would be generated |
| Check Documentation Health | - | View documentation health status |
| Add Inline Documentation | `Cmd/Ctrl+Shift+D` | Generate docs for selected code |
| Login to DocSynth | - | Authenticate with DocSynth API |
| Select Repository | - | Choose which repository to work with |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `docsynth.apiUrl` | `https://api.docsynth.io` | DocSynth API URL |
| `docsynth.autoPreview` | `true` | Enable auto-preview on save |
| `docsynth.previewDebounceMs` | `500` | Debounce delay for preview updates |
| `docsynth.showInlineHints` | `true` | Show inline documentation hints |
| `docsynth.styleEnforcement` | `warn` | Style enforcement level (`off`, `warn`, `error`) |
| `docsynth.excludePatterns` | `["**/node_modules/**", ...]` | Patterns to exclude |

## Sidebar Views

### Documentation Health
Shows the status of all documents in your repository:
- 🟢 **Fresh** - Updated within 7 days
- 🟡 **Aging** - Updated 8-30 days ago
- 🔴 **Stale** - Not updated in 30+ days

### Suggestions
Lists documentation suggestions for the current file, including:
- Missing documentation
- Style issues
- Complexity warnings

## Requirements

- VS Code 1.85.0 or higher
- DocSynth account (free tier available)
- Repository connected to DocSynth

## Supported Languages

- TypeScript
- JavaScript
- Python
- Go
- Rust
- Java (coming soon)

## Privacy

The extension sends code snippets to the DocSynth API for documentation generation. All data is encrypted in transit and not stored beyond the session. See our [Privacy Policy](https://docsynth.io/privacy) for details.

## License

MIT
