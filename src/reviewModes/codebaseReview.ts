/**
 * @module reviewModes/codebaseReview
 *
 * Full workspace scan review mode implementation.
 *
 * Purpose: Scans all files in the open workspace, respecting .gitignore
 * patterns and common exclusion rules, reads file contents, and returns
 * them as DiffFile[] (full content treated as "added" for review).
 *
 * Inputs: vscode.workspace
 * Outputs: DiffFile[], RepoMeta
 * Dependencies: vscode, engine/types
 */

import * as vscode from "vscode";
import type { DiffFile, IReviewMode, RepoMeta } from "../engine/types.js";
import { detectLanguage } from "../utils/languageDetector.js";
import { logger } from "../utils/logger.js";

/**
 * Maximum file size in bytes to include in the review (500 KB).
 * Files larger than this are skipped to avoid token budget exhaustion.
 */
const MAX_FILE_SIZE = 500 * 1024;

/**
 * File extensions to include in the codebase review.
 */
const INCLUDED_EXTENSIONS: ReadonlySet<string> = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "cs",
  "cpp",
  "c",
  "h",
  "hpp",
  "swift",
  "sql",
  "sh",
  "bash",
  "yaml",
  "yml",
  "json",
  "xml",
  "html",
  "css",
  "scss",
  "less",
  "vue",
  "svelte",
  "dart",
  "php",
  "lua",
  "r",
  "scala",
]);

/**
 * Glob patterns to exclude from scanning.
 */
const EXCLUDE_PATTERNS: readonly string[] = [
  "**/node_modules/**",
  "**/dist/**",
  "**/out/**",
  "**/build/**",
  "**/.git/**",
  "**/vendor/**",
  "**/__pycache__/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/target/**",
  "**/*.min.js",
  "**/*.min.css",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
];

/**
 * CodebaseReviewMode scans the entire workspace for review.
 *
 * Files are included based on extension allowlist and excluded
 * based on common patterns (node_modules, dist, etc.). Each file's
 * full content is treated as new code for the LLM to review.
 *
 * @example
 * ```ts
 * const mode = new CodebaseReviewMode();
 * const files = await mode.getDiffs(token);
 * const meta = await mode.getRepoMeta();
 * ```
 */
export class CodebaseReviewMode implements IReviewMode {
  public readonly name = "codebase";

  private workspaceRoot: string | undefined;
  private languageCounts: Map<string, number> = new Map();
  private totalFiles = 0;

  /**
   * Scans the workspace and returns all source files as DiffFile[].
   *
   * @param token - Cancellation token.
   * @returns Array of DiffFile objects representing workspace files.
   * @throws Error if no workspace is open.
   */
  public async getDiffs(token: vscode.CancellationToken): Promise<DiffFile[]> {
    const root = this.getWorkspaceRoot();
    this.workspaceRoot = root;

    // Build exclude glob pattern
    const excludePattern = `{${EXCLUDE_PATTERNS.join(",")}}`;

    // Build include glob pattern from allowed extensions
    const extArray = Array.from(INCLUDED_EXTENSIONS);
    const includePattern = `**/*.{${extArray.join(",")}}`;

    // Find all matching files
    const uris = await vscode.workspace.findFiles(
      includePattern,
      excludePattern,
      5000, // Cap at 5000 files to prevent runaway scans
    );

    if (uris.length === 5000) {
      vscode.window.showWarningMessage(
        "Copilot Code Review: Workspace scan capped at 5,000 files. " +
          "Some files may not have been reviewed. Use /diff for targeted review.",
      );
    }

    logger.info(`CodebaseReview: found ${uris.length} file(s) to scan`);

    const files: DiffFile[] = [];
    this.languageCounts = new Map();
    this.totalFiles = 0;

    // Process files in batches of 20 to speed up I/O while limiting concurrency
    for (let i = 0; i < uris.length; i += 20) {
      if (token.isCancellationRequested) {
        break;
      }

      const chunk = uris.slice(i, i + 20);
      const results = await Promise.all(
        chunk.map((uri) => this.readFileAsDiff(uri)),
      );

      for (const diffFile of results) {
        if (diffFile !== undefined) {
          files.push(diffFile);
          this.totalFiles += 1;

          // Track language stats
          const currentCount = this.languageCounts.get(diffFile.language) ?? 0;
          this.languageCounts.set(diffFile.language, currentCount + 1);
        }
      }
    }

    return files;
  }

  /**
   * Returns repository metadata for the workspace.
   *
   * Computes language percentages from scanned files.
   *
   * @returns RepoMeta with language statistics.
   */
  public async getRepoMeta(): Promise<RepoMeta> {
    const languageStats = new Map<string, number>();

    if (this.totalFiles > 0) {
      for (const [lang, count] of this.languageCounts) {
        const percentage = Math.round((count / this.totalFiles) * 100);
        languageStats.set(lang, percentage);
      }
    }

    return {
      repoName: this.extractRepoName(this.workspaceRoot ?? "workspace"),
      branch: "workspace-scan",
      prTitle: undefined,
      prNumber: undefined,
      languageStats,
    };
  }

  /**
   * Gets the workspace root directory.
   *
   * @returns Absolute path to workspace root.
   * @throws Error if no workspace is open.
   */
  private getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders === undefined || folders.length === 0) {
      throw new Error(
        "No workspace folder is open. Open a project to use codebase review.",
      );
    }

    const firstFolder = folders[0];
    if (firstFolder === undefined) {
      throw new Error("No workspace folder is open.");
    }

    return firstFolder.uri.fsPath;
  }

  /**
   * Reads a single file and converts it to a DiffFile.
   *
   * Skips files that exceed the size limit.
   *
   * @param uri - File URI to read.
   * @returns DiffFile or undefined if the file should be skipped.
   */
  private async readFileAsDiff(uri: vscode.Uri): Promise<DiffFile | undefined> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);

      if (stat.size > MAX_FILE_SIZE) {
        return undefined;
      }

      const contentBytes = await vscode.workspace.fs.readFile(uri);
      const content = new TextDecoder("utf-8").decode(contentBytes);

      // Skip binary-looking files
      if (this.looksLikeBinary(content)) {
        return undefined;
      }

      const filePath = vscode.workspace.asRelativePath(uri);
      const language = detectLanguage(filePath);

      return {
        filePath,
        language,
        content,
        estimatedTokens: Math.max(1, Math.ceil(content.length / 4)),
      };
    } catch {
      // Skip files that can't be read
      return undefined;
    }
  }

  /**
   * Simple heuristic to detect binary file content.
   *
   * @param content - File content string.
   * @returns True if the content appears to be binary.
   */
  private looksLikeBinary(content: string): boolean {
    // Check first 1000 chars for null bytes or high ratio of non-printable chars
    const sample = content.substring(0, 1000);
    let nonPrintable = 0;

    for (let i = 0; i < sample.length; i++) {
      const code = sample.charCodeAt(i);
      if (
        code === 0 ||
        (code < 32 && code !== 9 && code !== 10 && code !== 13)
      ) {
        nonPrintable++;
      }
    }

    return sample.length > 0 && nonPrintable / sample.length > 0.1;
  }

  /**
   * Extracts a repository name from a path.
   *
   * @param rootPath - Workspace root path.
   * @returns Last path segment as repo name.
   */
  private extractRepoName(rootPath: string): string {
    const segments = rootPath.split("/").filter((s) => s.length > 0);
    return segments[segments.length - 1] ?? "workspace";
  }
}
