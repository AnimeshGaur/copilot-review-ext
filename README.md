# Copilot Code Review

AI-powered code review extension for VS Code, powered by GitHub Copilot. Analyzes PRs, local diffs, and entire codebases for bugs, security vulnerabilities, and architectural improvements — directly inside your editor.

## ✨ Features

- **🔀 Pull Request Review** — Fetch and analyze GitHub PR diffs with one click
- **📝 Local Diff Review** — Review staged, unstaged, or all uncommitted changes before committing
- **📁 Full Codebase Scan** — Scan your entire workspace (up to 5,000 files) for potential issues
- **🛡️ Anti-Hallucination Filtering** — Only flags real lines of code that actually exist in your project
- **📊 Interactive Summary Panel** — Rich webview with clickable findings that navigate to source
- **⚠️ Inline Diagnostics** — Findings appear as squiggly lines right in the editor
- **💬 GitHub PR Comments** — Automatically posts review summaries back to your PR
- **🤖 Copilot Chat Integration** — Use `@review` as a chat participant

## 🚀 Getting Started

### Prerequisites

- **VS Code** v1.90.0 or higher
- **GitHub Copilot** subscription with the Copilot and Copilot Chat extensions installed
- **Node.js** v18+ (for development)

### Installation (Development)

```bash
# Clone the repository
git clone <repo-url>
cd copilot-review-ext

# Install dependencies
npm install

# Build
npm run build

# Launch the Extension Development Host
# Press F5 in VS Code, or:
code --extensionDevelopmentPath=.
```

## 📋 Usage

### Command Palette

Press `Cmd+Shift+P` (Mac) / `Ctrl+Shift+P` (Windows/Linux) and type **"Copilot Review"**:

| Command | Description |
|---|---|
| `Copilot Review: Review Pull Request` | Analyze a GitHub PR by URL |
| `Copilot Review: Review Local Diff` | Review uncommitted git changes |
| `Copilot Review: Review Codebase` | Scan the full workspace |

### Right-Click Context Menu

All three commands are also available in the **editor** and **file explorer** right-click menus.

### Copilot Chat

Open the Copilot Chat panel and use the `@review` participant:

```
@review /pr        — Review a GitHub Pull Request
@review /diff      — Review local uncommitted changes
@review /codebase  — Scan the entire workspace
```

## ⚙️ Configuration

Settings are available under **Settings → Extensions → Copilot Code Review**:

| Setting | Default | Description |
|---|---|---|
| `copilotReview.maxFiles` | `5000` | Max files to scan in codebase review |
| `copilotReview.tokenCeiling` | `100000` | Max tokens per review session |
| `copilotReview.excludePatterns` | `node_modules, dist, ...` | Glob patterns to exclude from scans |

## 🏗️ Architecture

```
src/
├── engine/                  # Core review pipeline
│   ├── contextWindowManager.ts   # Token budgeting & batch construction
│   ├── prompts.ts                # System & user prompt templates
│   ├── reviewEngine.ts           # Orchestrates LLM calls & output routing
│   └── types.ts                  # Shared interfaces & type guards
├── github/                  # GitHub integration
│   ├── api.ts                    # Octokit-based GitHub API client
│   └── auth.ts                   # VS Code GitHub auth session manager
├── outputs/                 # Review result writers
│   ├── chatResponse.ts           # Copilot Chat stream output
│   ├── githubComments.ts         # PR review comment writer
│   ├── inlineDiagnostics.ts      # VS Code diagnostics (squigglies)
│   └── summaryPanel.ts           # Webview summary panel
├── reviewModes/             # Input sources
│   ├── prReview.ts               # GitHub PR diff fetcher
│   ├── localDiff.ts              # Local git diff (via VS Code Git API)
│   └── codebaseReview.ts         # Full workspace scanner
├── utils/                   # Shared utilities
│   ├── diffParser.ts             # Unified diff parser
│   ├── languageDetector.ts       # File extension → language mapper
│   └── logger.ts                 # Output channel logger
└── extension.ts             # Entry point, command & chat registration
```

### Key Design Decisions

- **Dependency Injection** — All services are injected via constructors for testability
- **Interface-First** — Core contracts defined in `types.ts`; implementations are swappable
- **VS Code Git API** — Uses the built-in Git extension API instead of shelling out to `git`
- **CSP-Compliant Webview** — Summary panel uses `crypto.randomBytes` nonces
- **Batched Processing** — Large codebases are split into token-budgeted batches

## 🐛 Debugging

1. Press **F5** to launch the Extension Development Host
2. Open the **Output** panel (`Cmd+Shift+U`) → select **"Copilot Code Review"** from the dropdown
3. All extension activity is logged with timestamps and severity levels

## 📜 Scripts

| Script | Description |
|---|---|
| `npm run build` | Format, lint, and compile |
| `npm run build:compile` | TypeScript compilation only |
| `npm run build:lint` | ESLint check |
| `npm run build:format` | Prettier formatting |
| `npm run watch` | Watch mode for development |
| `npm run package` | Package as `.vsix` for distribution |

## 📄 License

MIT
