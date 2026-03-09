/**
 * @module github/api
 *
 * Typed GitHub REST API client for the Copilot Code Review extension.
 *
 * Purpose: Provides methods for fetching pull request data, diffs,
 * and posting review comments. All API calls include full error
 * handling for 401 (re-auth), 403 (rate limit), 404, and 422.
 *
 * Inputs: PullRequestRef, IAuthProvider
 * Outputs: PullRequestInfo, diff strings, posted comments
 * Dependencies: @octokit/rest, github/auth, engine/types
 */

import { Octokit } from "@octokit/rest";
import type {
  IAuthProvider,
  IGitHubClient,
  PullRequestInfo,
  PullRequestRef,
} from "../engine/types.js";

/**
 * Error class for GitHub API failures with structured metadata.
 */
class GitHubApiError extends Error {
  public readonly statusCode: number;
  public readonly retryAfter: number | undefined;

  public constructor(message: string, statusCode: number, retryAfter?: number) {
    super(message);
    this.name = "GitHubApiError";
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
  }
}

/**
 * Extracts a numeric retry-after value from Octokit error headers.
 * @param headers - Response headers from the Octokit error.
 * @returns The retry-after value in seconds, or undefined.
 */
function extractRetryAfter(
  headers: Record<string, string | undefined> | undefined,
): number | undefined {
  if (headers === undefined) {
    return undefined;
  }
  const raw = headers["retry-after"];
  if (raw === undefined) {
    return undefined;
  }
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * GitHubApiClient provides typed methods for interacting with
 * the GitHub REST API using Octokit.
 *
 * Authentication is provided via an injected IAuthProvider.
 * All methods include comprehensive error handling with automatic
 * re-auth on 401 responses.
 *
 * @example
 * ```ts
 * const client = new GitHubApiClient(authProvider);
 * const pr = await client.getPullRequest({ owner: 'me', repo: 'myrepo', number: 42 });
 * ```
 */
export class GitHubApiClient implements IGitHubClient {
  private readonly authProvider: IAuthProvider;
  private octokit: Octokit | undefined;

  /**
   * Creates a new GitHubApiClient.
   * @param authProvider - Authentication session provider for GitHub tokens.
   */
  public constructor(authProvider: IAuthProvider) {
    this.authProvider = authProvider;
  }

  /**
   * Fetches pull request metadata from the GitHub API.
   *
   * @param ref - Pull request reference (owner, repo, number).
   * @returns Pull request info including title, refs, and metadata.
   * @throws GitHubApiError on API failures.
   */
  public async getPullRequest(ref: PullRequestRef): Promise<PullRequestInfo> {
    const client = await this.getClient();

    try {
      const response = await client.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
      });

      return {
        title: response.data.title,
        number: response.data.number,
        headRef: response.data.head.ref,
        headSha: response.data.head.sha,
        baseRef: response.data.base.ref,
        owner: ref.owner,
        repo: ref.repo,
      };
    } catch (err: unknown) {
      throw this.handleApiError(err, "getPullRequest");
    }
  }

  /**
   * Fetches the unified diff for a pull request.
   *
   * @param ref - Pull request reference (owner, repo, number).
   * @returns Raw unified diff string.
   * @throws GitHubApiError on API failures.
   */
  public async getPullRequestDiff(ref: PullRequestRef): Promise<string> {
    const client = await this.getClient();

    try {
      const response = await client.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
        mediaType: { format: "diff" },
      });

      // When requesting diff format, data comes back as a string
      return response.data as unknown as string;
    } catch (err: unknown) {
      throw this.handleApiError(err, "getPullRequestDiff");
    }
  }

  /**
   * Posts review comments on a pull request.
   *
   * Creates a single review with all comments attached for atomic submission.
   *
   * @param ref - Pull request reference (owner, repo, number).
   * @param commitId - The commit SHA to attach comments to.
   * @param comments - Array of comments with path, line, and body.
   * @throws GitHubApiError on API failures.
   */
  public async postReviewComment(
    ref: PullRequestRef,
    commitId: string,
    comments: ReadonlyArray<{
      readonly path: string;
      readonly line: number;
      readonly body: string;
    }>,
  ): Promise<void> {
    const client = await this.getClient();

    try {
      await client.pulls.createReview({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
        commit_id: commitId,
        event: "COMMENT",
        comments: comments.map((c) => ({
          path: c.path,
          line: c.line,
          body: c.body,
        })),
      });
    } catch (err: unknown) {
      throw this.handleApiError(err, "postReviewComment");
    }
  }

  /**
   * Lazily initializes and returns an authenticated Octokit instance.
   *
   * @returns Authenticated Octokit client.
   */
  private async getClient(): Promise<Octokit> {
    if (this.octokit !== undefined) {
      return this.octokit;
    }

    const token = await this.authProvider.getToken();
    this.octokit = new Octokit({ auth: token });
    return this.octokit;
  }

  /**
   * Handles Octokit errors by mapping HTTP status codes to
   * actionable GitHubApiError instances.
   *
   * - 401: Clears cached session for re-auth
   * - 403: Includes retry-after header if present
   * - 404: Resource not found
   * - 422: Validation error
   * - Other: Generic error
   *
   * @param err - The raw error from Octokit.
   * @param operation - Name of the operation that failed.
   * @returns A structured GitHubApiError.
   */
  private handleApiError(err: unknown, operation: string): GitHubApiError {
    if (typeof err !== "object" || err === null) {
      return new GitHubApiError(`${operation}: Unknown error`, 500);
    }

    const octokitError = err as {
      status?: number;
      message?: string;
      response?: { headers?: Record<string, string | undefined> };
    };

    const status = octokitError.status ?? 500;
    const message = octokitError.message ?? "Unknown error";

    switch (status) {
      case 401: {
        // Clear cached session so next call re-authenticates
        this.authProvider.clearSession();
        this.octokit = undefined;
        return new GitHubApiError(
          `${operation}: Authentication failed — please re-authorize GitHub access.`,
          401,
        );
      }
      case 403: {
        const retryAfter = extractRetryAfter(octokitError.response?.headers);
        const retryMsg =
          retryAfter !== undefined ? ` Retry after ${retryAfter} seconds.` : "";
        return new GitHubApiError(
          `${operation}: Rate limit exceeded or forbidden.${retryMsg}`,
          403,
          retryAfter,
        );
      }
      case 404: {
        return new GitHubApiError(
          `${operation}: Resource not found — verify the owner, repo, and PR number.`,
          404,
        );
      }
      case 422: {
        return new GitHubApiError(
          `${operation}: Validation error — ${message}`,
          422,
        );
      }
      default: {
        return new GitHubApiError(
          `${operation}: GitHub API error (${status}) — ${message}`,
          status,
        );
      }
    }
  }
}
