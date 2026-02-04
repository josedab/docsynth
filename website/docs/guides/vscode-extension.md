---
sidebar_position: 5
title: VS Code Extension
description: Use DocSynth directly in VS Code.
---

# VS Code Extension

The DocSynth VS Code extension brings documentation generation directly into your IDE.

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (`Cmd/Ctrl + Shift + X`)
3. Search for "DocSynth"
4. Click **Install**

### From Command Line

```bash
code --install-extension docsynth.vscode-docsynth
```

## Features

### Real-Time Preview

See documentation previews as you edit code:

```
┌─────────────────────────────────────────────────────────────────┐
│ user.ts                              │ DocSynth Preview        │
├─────────────────────────────────────┼──────────────────────────┤
│ export interface User {              │ ## User                  │
│   id: string;                        │                          │
│   email: string;                     │ Represents a user in     │
│   name: string;                      │ the system.              │
│   createdAt: Date;                   │                          │
│ }                                    │ ### Properties           │
│                                      │                          │
│ export async function createUser(    │ | Property | Type |      │
│   data: CreateUserInput              │ |----------|------|      │
│ ): Promise<User> {                   │ | id | string |          │
│   // ...                             │ | email | string |        │
│ }                                    │ | name | string |         │
│                                      │ | createdAt | Date |      │
└─────────────────────────────────────┴──────────────────────────┘
```

### Health Status

View documentation health in the sidebar:

```
DOCSYNTH: HEALTH
├── 🟢 README.md (95)
├── 🟢 api/users.md (88)
├── 🟡 api/auth.md (65)
│   └── ⚠️ Last updated 30 days ago
├── 🔴 guides/setup.md (45)
│   └── ❌ Broken links found
└── 📊 Overall: 78/100
```

### Inline Suggestions

Get documentation suggestions for undocumented code:

```typescript
// 💡 DocSynth: This function is not documented.
//    Click to generate documentation.
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
```

### Code Lens

Documentation hints appear above functions:

```typescript
📝 Generate Docs | 👁️ Preview | ✨ Improve
export async function getUserById(id: string): Promise<User> {
  // ...
}
```

### Chat Panel

Ask questions about documentation:

```
┌─────────────────────────────────────────────────────────────────┐
│ DocSynth Chat                                            [─][□] │
├─────────────────────────────────────────────────────────────────┤
│ You: How do I document the authentication flow?                 │
│                                                                 │
│ DocSynth: Based on your codebase, here's a suggested            │
│ structure for documenting the authentication flow:              │
│                                                                 │
│ 1. **Overview** - JWT-based authentication                      │
│ 2. **Login Flow** - /auth/login endpoint                        │
│ 3. **Token Validation** - Middleware usage                      │
│ 4. **Refresh Flow** - Token renewal process                     │
│                                                                 │
│ Would you like me to generate this documentation?               │
│ [Generate] [Customize]                                          │
├─────────────────────────────────────────────────────────────────┤
│ Ask a question...                                          [⏎] │
└─────────────────────────────────────────────────────────────────┘
```

## Commands

Access commands via Command Palette (`Cmd/Ctrl + Shift + P`):

| Command | Description |
|---------|-------------|
| `DocSynth: Generate Documentation` | Generate docs for current file |
| `DocSynth: Preview Documentation` | Open preview panel |
| `DocSynth: Explain Selection` | Explain selected code |
| `DocSynth: Document Function` | Document function at cursor |
| `DocSynth: Show Health` | Open health panel |
| `DocSynth: Find Undocumented` | List undocumented exports |
| `DocSynth: Login` | Authenticate with DocSynth |
| `DocSynth: Select Repository` | Switch active repository |

## Context Menu

Right-click options:

```
┌─────────────────────────────────┐
│ DocSynth                      ▶ │
├─────────────────────────────────┤
│   📝 Generate Documentation     │
│   👁️ Preview                    │
│   💡 Explain This Code          │
│   ✨ Improve Documentation      │
└─────────────────────────────────┘
```

## Settings

Configure in VS Code settings:

### Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `docsynth.autoPreview` | `true` | Auto-show preview on file open |
| `docsynth.previewDelay` | `500` | Delay before preview updates (ms) |
| `docsynth.showCodeLens` | `true` | Show code lens hints |
| `docsynth.inlineSuggestions` | `true` | Show inline suggestions |
| `docsynth.healthInStatusBar` | `true` | Show health in status bar |

### Configure via settings.json

```json
{
  "docsynth.autoPreview": true,
  "docsynth.previewDelay": 500,
  "docsynth.showCodeLens": true,
  "docsynth.inlineSuggestions": true,
  "docsynth.healthInStatusBar": true,
  "docsynth.style": {
    "enforcement": "warning"
  }
}
```

## Authentication

Connect to your DocSynth account:

1. Run `DocSynth: Login` from Command Palette
2. Browser opens for GitHub authentication
3. Copy token and paste in VS Code
4. Extension shows "Connected" in status bar

### Status Bar

```
DocSynth: ✓ Connected | Health: 92 | Repo: api-service
```

## Workflow Examples

### Document a New Function

1. Write your function
2. Click "📝 Generate Docs" in code lens
3. Review in preview panel
4. Save to apply

### Review Documentation Health

1. Open Health panel (`DocSynth: Show Health`)
2. Click on items with warnings
3. Use "Improve" to fix issues

### Explore Undocumented Code

1. Run `DocSynth: Find Undocumented`
2. Review list of exports without docs
3. Click to navigate and document

### Ask Questions

1. Open Chat panel
2. Select code you're curious about
3. Ask "What does this do?" or "How should I document this?"

## Keyboard Shortcuts

Default keybindings:

| Shortcut | Command |
|----------|---------|
| `Cmd/Ctrl + Shift + D` | Generate documentation |
| `Cmd/Ctrl + Shift + P` | Preview documentation |
| `Cmd/Ctrl + .` | Quick actions (includes DocSynth) |

### Custom Keybindings

Add to `keybindings.json`:

```json
[
  {
    "key": "cmd+shift+d",
    "command": "docsynth.generateDocs",
    "when": "editorTextFocus"
  }
]
```

## Troubleshooting

### Extension Not Loading

1. Check VS Code version (requires 1.80+)
2. Reload window (`Developer: Reload Window`)
3. Check Output panel for errors

### Authentication Issues

1. Run `DocSynth: Logout`
2. Run `DocSynth: Login`
3. Ensure browser allows popups

### Preview Not Updating

1. Check `docsynth.previewDelay` setting
2. Save the file to force update
3. Close and reopen preview panel

### No Suggestions Appearing

1. Verify `docsynth.inlineSuggestions` is `true`
2. Check file is in a supported language
3. Ensure repository is initialized

## Supported Languages

| Language | Support Level |
|----------|--------------|
| TypeScript | Full |
| JavaScript | Full |
| Python | Full |
| Go | Full |
| Java | Full |
| C# | Full |
| Rust | Beta |
| Ruby | Beta |

## Next Steps

- [Configuration](/docs/guides/configuring-docsynth) — Customize settings
- [CLI Guide](/docs/guides/using-the-cli) — Command-line workflow
- [Dashboard](/docs/guides/dashboard-overview) — Web interface
