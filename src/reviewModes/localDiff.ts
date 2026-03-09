/**
 * @module reviewModes/localDiff
 *
 * Local Git diff review mode implementation.
 *
 * Purpose: Runs `git diff` against the current workspace to capture
 * uncommitted or staged changes, parses the unified diff output,
 * and returns structured DiffFile[] for review.
 *
 * Inputs: Workspace folder, git executable
 * Outputs: DiffFile[], RepoMeta
 * Dependencies: child_process, vscode, engine/types
 */

import * as vscode from "vscode";
import type { DiffFile, IReviewMode, RepoMeta } from "../engine/types.js";
import { parseUnifiedDiff } from "../utils/diffParser.js";

/**
 * Minimal interface for the VS Code Git extension API.
 */
interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

interface GitApi {
  repositories: GitRepository[];
}

interface GitRepository {
  rootUri: vscode.Uri;
  diff(cached?: boolean): Promise<string>;
  state: {
    HEAD?: {
      name?: string;
    };
  };
}

/**
 * LocalDiffReviewMode captures local git changes for review.
 *
 * Offers the user a choice between staged changes, unstaged changes,
 * or all uncommitted changes before fetching the diff.
 *
 * @example
 * ```ts
 * const mode = new LocalDiffReviewMode();
 * const files = await mode.getDiffs(token);
 * const meta = await mode.getRepoMeta();
 * ```
 */
export class LocalDiffReviewMode implements IReviewMode {
  public readonly name = "diff";

  private workspaceRoot: string | undefined;
  private branchName: string | undefined;
  private repoName: string | undefined;

  /**
   * Prompts the user for diff scope, runs git diff, and returns
   * parsed DiffFile[].
   *
   * @param _token - Cancellation token (used for future cancellation support).
   * @returns Array of diff files from local git changes.
   * @throws Error if no workspace is open or git is not available.
   */
  public async getDiffs(_token: vscode.CancellationToken): Promise<DiffFile[]> {
    const root = this.getWorkspaceRoot();
    this.workspaceRoot = root;

    // Get current branch name
    this.branchName = await this.getGitBranch(root);
    this.repoName = this.extractRepoName(root);

    // Let user choose diff scope
    const scope = await this.promptForScope();

    // Run git diff with the selected scope
    const rawDiff = await this.runGitDiff(root, scope);

    if (rawDiff.trim().length === 0) {
      vscode.window.showInformationMessage(
        "Copilot Code Review: No changes found for the selected scope.",
      );
      return [];
    }

    return parseUnifiedDiff(rawDiff);
  }

  /**
   * Returns repository metadata for the local workspace.
   *
   * @returns RepoMeta without PR-specific fields.
   */
  public async getRepoMeta(): Promise<RepoMeta> {
    return {
      repoName: this.repoName ?? "local",
      branch: this.branchName ?? "unknown",
      prTitle: undefined,
      prNumber: undefined,
      languageStats: new Map<string, number>(),
    };
  }

  /**
   * Gets the workspace root directory.
   *
   * @returns Absolute path to the workspace root.
   * @throws Error if no workspace folder is open.
   */
  private getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders === undefined || folders.length === 0) {
      throw new Error(
        "No workspace folder is open. Open a Git repository to use local diff review.",
      );
    }

    const firstFolder = folders[0];
    if (firstFolder === undefined) {
      throw new Error("No workspace folder is open.");
    }

    return firstFolder.uri.fsPath;
  }

  /**
   * Prompts the user to select the diff scope.
   *
   * @returns The selected diff scope: 'staged', 'unstaged', or 'all'.
   * @throws Error if the user cancels.
   */
  private async promptForScope(): Promise<"staged" | "unstaged" | "all"> {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: "Staged Changes",
          description: "git diff --cached",
          value: "staged" as const,
        },
        {
          label: "Unstaged Changes",
          description: "git diff",
          value: "unstaged" as const,
        },
        {
          label: "All Uncommitted",
          description: "git diff HEAD",
          value: "all" as const,
        },
      ],
      {
        placeHolder: "Select which changes to review",
        canPickMany: false,
      },
    );

    if (choice === undefined) {
      throw new Error("Local diff review cancelled by user.");
    }

    return choice.value;
  }

  /**
   * Runs git diff with the specified scope.
   *
   * @param cwd - Working directory for the git command.
   * @param scope - Diff scope: staged, unstaged, or all.
   * @returns Raw unified diff output.
   */
  private async runGitDiff(
    cwd: string,
    scope: "staged" | "unstaged" | "all",
  ): Promise<string> {
    const gitExtension =
      vscode.extensions.getExtension<GitExtensionExports>(
        "vscode.git",
      )?.exports;
    const gitApi = gitExtension?.getAPI(1);

    if (!gitApi) {
      throw new Error("VS Code Git extension is required but not available.");
    }

    const repo =
      gitApi.repositories.find((r) => r.rootUri.fsPath === cwd) ??
      gitApi.repositories[0];
    if (!repo) {
      throw new Error(`No git repository found in the current workspace.`);
    }

    try {
      if (scope === "staged") {
        return (await repo.diff(true)) || "";
      } else if (scope === "unstaged") {
        return (await repo.diff(false)) || "";
      } else {
        const staged = (await repo.diff(true)) || "";
        const unstaged = (await repo.diff(false)) || "";
        return staged + (staged && unstaged ? "\n" : "") + unstaged;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to run git diff via VS Code API: ${message}`);
    }
  }

  /**
   * Gets the current git branch name.
   *
   * @param cwd - Working directory.
   * @returns Current branch name or 'detached'.
   */
  private async getGitBranch(cwd: string): Promise<string> {
    try {
      const gitExtension =
        vscode.extensions.getExtension<GitExtensionExports>(
          "vscode.git",
        )?.exports;
      const gitApi = gitExtension?.getAPI(1);
      if (gitApi) {
        const repo =
          gitApi.repositories.find((r) => r.rootUri.fsPath === cwd) ??
          gitApi.repositories[0];
        if (repo?.state?.HEAD?.name) {
          return repo.state.HEAD.name;
        }
      }
    } catch {
      // ignore fallback
    }
    return "unknown";
  }

  /**
   * Extracts a repository name from the workspace root path.
   *
   * @param rootPath - Absolute path to workspace root.
   * @returns The last directory component as the repo name.
   */
  private extractRepoName(rootPath: string): string {
    const segments = rootPath.split("/").filter((s) => s.length > 0);
    return segments[segments.length - 1] ?? "local";
  }
}
