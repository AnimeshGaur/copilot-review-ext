/**
 * @module reviewModes/prReview
 *
 * Pull request review mode implementation.
 *
 * Purpose: Prompts the user for a PR URL, parses owner/repo/number,
 * fetches the diff via the GitHub API, parses unified diff format
 * into DiffFile[], and provides repository metadata.
 *
 * Inputs: User-provided PR URL, IGitHubClient
 * Outputs: DiffFile[], RepoMeta
 * Dependencies: engine/types, github/api, vscode
 */

import * as vscode from "vscode";
import type {
  DiffFile,
  IGitHubClient,
  IReviewMode,
  PullRequestRef,
  RepoMeta,
} from "../engine/types.js";
import { parseUnifiedDiff } from "../utils/diffParser.js";

/**
 * Regex pattern for parsing GitHub PR URLs.
 * Supports both github.com and GitHub Enterprise URLs.
 *
 * Captures: [1] owner, [2] repo, [3] PR number
 */
const PR_URL_PATTERN = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

/**
 * PullRequestReviewMode fetches and parses diffs from GitHub PRs.
 *
 * @example
 * ```ts
 * const mode = new PullRequestReviewMode(gitHubClient);
 * const files = await mode.getDiffs(token);
 * const meta = await mode.getRepoMeta();
 * ```
 */
export class PullRequestReviewMode implements IReviewMode {
  public readonly name = "pr";

  private readonly gitHubClient: IGitHubClient;
  private parsedRef: PullRequestRef | undefined;
  private prTitle: string | undefined;
  private headBranch: string | undefined;
  private headSha: string | undefined;

  /**
   * Creates a new PullRequestReviewMode.
   * @param gitHubClient - GitHub API client for fetching PR data.
   */
  public constructor(gitHubClient: IGitHubClient) {
    this.gitHubClient = gitHubClient;
  }

  /**
   * Prompts the user for a PR URL, fetches the diff, and returns
   * parsed DiffFile[].
   *
   * @param token - Cancellation token.
   * @returns Array of diff files extracted from the PR.
   * @throws Error if the URL is invalid or the API call fails.
   */
  public async getDiffs(token: vscode.CancellationToken): Promise<DiffFile[]> {
    const ref = await this.promptForPrUrl();
    this.parsedRef = ref;

    // Fetch PR metadata
    const prInfo = await this.gitHubClient.getPullRequest(ref);
    this.prTitle = prInfo.title;
    this.headBranch = prInfo.headRef;
    this.headSha = prInfo.headSha;

    if (token.isCancellationRequested) {
      return [];
    }

    // Fetch the diff
    const rawDiff = await this.gitHubClient.getPullRequestDiff(ref);

    return parseUnifiedDiff(rawDiff);
  }

  /**
   * Returns repository metadata for the current PR.
   *
   * @returns RepoMeta with PR-specific information.
   * @throws Error if getDiffs() has not been called first.
   */
  public async getRepoMeta(): Promise<RepoMeta> {
    if (this.parsedRef === undefined) {
      throw new Error(
        "PullRequestReviewMode: getDiffs() must be called before getRepoMeta()",
      );
    }

    return {
      repoName: `${this.parsedRef.owner}/${this.parsedRef.repo}`,
      branch: this.headBranch ?? "unknown",
      headSha: this.headSha,
      prTitle: this.prTitle,
      prNumber: this.parsedRef.number,
      languageStats: new Map<string, number>(),
    };
  }

  /**
   * Prompts the user to enter a GitHub PR URL and parses it.
   *
   * @returns Parsed PullRequestRef.
   * @throws Error if the user cancels or the URL is invalid.
   */
  private async promptForPrUrl(): Promise<PullRequestRef> {
    const input = await vscode.window.showInputBox({
      prompt: "Enter GitHub Pull Request URL",
      placeHolder: "https://github.com/owner/repo/pull/123",
      validateInput: (value: string) => {
        if (!PR_URL_PATTERN.test(value)) {
          return "Please enter a valid GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)";
        }
        return null;
      },
    });

    if (input === undefined) {
      throw new Error("PR review cancelled by user.");
    }

    return this.parsePrUrl(input);
  }

  /**
   * Parses a GitHub PR URL into a PullRequestRef.
   *
   * @param url - The PR URL to parse.
   * @returns Parsed reference with owner, repo, and PR number.
   * @throws Error if the URL doesn't match the expected pattern.
   */
  private parsePrUrl(url: string): PullRequestRef {
    const match = PR_URL_PATTERN.exec(url);
    if (
      match === null ||
      match[1] === undefined ||
      match[2] === undefined ||
      match[3] === undefined
    ) {
      throw new Error(`Invalid PR URL: ${url}`);
    }

    const prNumber = parseInt(match[3], 10);
    if (Number.isNaN(prNumber)) {
      throw new Error(`Invalid PR number in URL: ${url}`);
    }

    return {
      owner: match[1],
      repo: match[2],
      number: prNumber,
    };
  }
}
