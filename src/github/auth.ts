/**
 * @module github/auth
 *
 * VS Code GitHub authentication session manager.
 *
 * Purpose: Wraps the VS Code authentication API to provide GitHub
 * access tokens. Caches the active session and handles re-authentication
 * when tokens are revoked or expired.
 *
 * Inputs: VS Code authentication API
 * Outputs: GitHub access token string
 * Dependencies: vscode
 */

import * as vscode from "vscode";
import type { IAuthProvider } from "../engine/types.js";

/**
 * Required GitHub OAuth scopes for the extension.
 * - repo: Full repository access for reading PRs and posting comments
 */
const GITHUB_SCOPES: readonly string[] = ["repo"];

/**
 * AuthSessionManager manages GitHub authentication sessions via
 * the VS Code built-in GitHub authentication provider.
 *
 * It caches the current session and provides methods to retrieve
 * tokens and clear cached sessions on auth failures.
 *
 * @example
 * ```ts
 * const auth = new AuthSessionManager();
 * const token = await auth.getToken();
 * // Use token with GitHub API...
 * ```
 */
export class AuthSessionManager implements IAuthProvider {
  private cachedSession: vscode.AuthenticationSession | undefined;

  /**
   * Retrieves a valid GitHub access token.
   *
   * If no session is cached, prompts the user to sign in via VS Code's
   * built-in GitHub authentication provider. Returns the cached token
   * on subsequent calls until `clearSession()` is called.
   *
   * @returns The GitHub OAuth access token.
   * @throws Error if the user declines authentication or no session is available.
   */
  public async getToken(): Promise<string> {
    if (this.cachedSession !== undefined) {
      return this.cachedSession.accessToken;
    }

    try {
      const session = await vscode.authentication.getSession(
        "github",
        [...GITHUB_SCOPES],
        { createIfNone: true },
      );

      this.cachedSession = session;
      return session.accessToken;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `GitHub authentication failed: ${message}. ` +
          "Please sign in to GitHub via VS Code to use PR review features.",
      );
    }
  }

  /**
   * Clears the cached authentication session.
   *
   * Call this after receiving a 401 from the GitHub API to force
   * re-authentication on the next `getToken()` call.
   */
  public clearSession(): void {
    this.cachedSession = undefined;
  }
}
