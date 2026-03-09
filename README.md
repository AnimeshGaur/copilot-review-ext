# Copilot Review Extension

An intelligent, context-aware code review extension powered by GitHub Copilot. 

This extension transforms GitHub Copilot into an automated code reviewer that lives directly inside VS Code. It analyzes your code for bugs, security vulnerabilities, edge cases, and architectural improvements.

## ✨ Features

- **Local Diff Review**: Review your uncommitted local changes before you commit them.
- **Pull Request Review**: Automatically inspect the diffs of GitHub Pull Requests.
- **Full Codebase Scan**: Analyze your entire workspace for potential issues.
- **Anti-Hallucination Filtering**: Ensures Copilot only flags real lines of code that actually exist in your project.
- **Detailed Interactive Summaries**: Generates a visually appealing summary panel with prioritized findings.
- **Inline VS Code Diagnostics**: Review feedback appears exactly where it's needed—as squiggly lines in your text editor.
- **GitHub PR Comments**: (For PR reviews) Automatically posts a review summary back to your GitHub Pull Request!

## 🚀 How to Use

You can trigger a review in two distinct ways: using the **Command Palette** or interacting organically in **Copilot Chat**.

### 1. The Command Palette (Quickest)
Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and type `Copilot Review`. You'll see three options:
- **Copilot Review: Review Local Diff**
- **Copilot Review: Review Pull Request**
- **Copilot Review: Review Codebase**

### 2. Copilot Chat Integration
Open the VS Code Copilot Chat panel and use the `@review` participant!

Type exactly what you want it to review using slash commands:
- `@review /diff` - Analyzes your locally staged and unstaged Git changes.
- `@review /pr` - Analyzes an active GitHub PR.
- `@review /codebase` - Scans your entire project folder.

## 📋 Requirements
- Visual Studio Code v1.90.0 or higher.
- A GitHub Copilot subscription.
- Both the `GitHub Copilot` and `GitHub Copilot Chat` extensions must be installed and active in VS Code.

## 🛠 Usage Notes
When running a Pull Request Review (`/pr`), the extension will prompt you to authenticate with your GitHub account to securely fetch the PR details directly from GitHub.

For large files or codebases, the review process may take several seconds as Copilot intelligently processes your changes in the background.
