/**
 * @module outputs/githubComments
 *
 * GitHub PR comment poster for review findings.
 *
 * Purpose: Posts high and medium confidence findings as PR review
 * comments via the GitHub API. Shows a confirmation modal before
 * posting. Low-confidence findings are filtered out entirely.
 *
 * Inputs: ReviewResult, IGitHubClient, PullRequestRef
 * Outputs: GitHub PR review comments
 * Dependencies: vscode, engine/types, github/api
 */

import * as vscode from "vscode";
import type {
  IGitHubClient,
  IOutputWriter,
  PullRequestRef,
  ReviewResult,
} from "../engine/types.js";

/**
 * GitHubCommentWriter posts review findings as PR review comments.
 *
 * Only high and medium confidence findings are posted.
 * A confirmation modal is shown before any comments are submitted.
 *
 * @example
 * ```ts
 * const writer = new GitHubCommentWriter(gitHubClient, prRef, commitSha);
 * await writer.write(result, token);
 * ```
 */
export class GitHubCommentWriter implements IOutputWriter {
  private readonly gitHubClient: IGitHubClient;
  private readonly prRef: PullRequestRef;
  private readonly commitId: string;

  /**
   * Creates a new GitHubCommentWriter.
   * @param gitHubClient - GitHub API client for posting comments.
   * @param prRef - The pull request to comment on.
   * @param commitId - The commit SHA to attach comments to.
   */
  public constructor(
    gitHubClient: IGitHubClient,
    prRef: PullRequestRef,
    commitId: string,
  ) {
    this.gitHubClient = gitHubClient;
    this.prRef = prRef;
    this.commitId = commitId;
  }

  /**
   * Posts review findings as PR comments after user confirmation.
   *
   * Filters to high/medium confidence findings only, formats them
   * as review comments, and shows a confirmation dialog before posting.
   *
   * @param result - The aggregated review result.
   * @param _token - Cancellation token (reserved for future use).
   */
  public async write(
    result: ReviewResult,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    // Only post high and medium confidence findings
    const postableFindings = result.findings.filter(
      (f) => f.confidence === "high" || f.confidence === "medium",
    );

    if (postableFindings.length === 0) {
      return;
    }

    // Format findings as comments
    const comments = postableFindings.map((finding) => {
      const severityEmoji = this.getSeverityEmoji(finding.severity);
      let body = `${severityEmoji} **${finding.severity.toUpperCase()}** | ${finding.category}\n\n${finding.message}`;

      if (finding.suggestion !== undefined) {
        body += `\n\n💡 **Suggestion:** ${finding.suggestion}`;
      }

      body += `\n\n_Confidence: ${finding.confidence} | Copilot Code Review_`;

      return {
        path: finding.file,
        line: finding.line,
        body,
      };
    });

    // Confirmation modal
    const answer = await vscode.window.showInformationMessage(
      `Copilot Code Review wants to post ${comments.length} review comment(s) on PR #${this.prRef.number}. Proceed?`,
      { modal: true },
      "Post Comments",
      "Cancel",
    );

    if (answer !== "Post Comments") {
      return;
    }

    try {
      await this.gitHubClient.postReviewComment(
        this.prRef,
        this.commitId,
        comments,
      );

      vscode.window.showInformationMessage(
        `Copilot Code Review: Posted ${comments.length} comment(s) on PR #${this.prRef.number}.`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(
        `Copilot Code Review: Failed to post comments — ${message}`,
      );
    }
  }

  /**
   * No-op dispose — no resources to clean up.
   */
  public dispose(): void {
    // No resources to dispose
  }

  /**
   * Returns an emoji for the given severity level.
   *
   * @param severity - Finding severity.
   * @returns Emoji string.
   */
  private getSeverityEmoji(severity: string): string {
    switch (severity) {
      case "error":
        return "🔴";
      case "warning":
        return "🟡";
      case "info":
        return "🔵";
      case "hint":
        return "⚪";
      default:
        return "⚪";
    }
  }
}
