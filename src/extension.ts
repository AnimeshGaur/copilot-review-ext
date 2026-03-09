/**
 * @module extension
 *
 * Root activation point for the Copilot Code Review extension.
 *
 * Purpose: Registers all commands, creates the Copilot Chat participant
 * (@review), wires the dependency injection container, and manages
 * lifecycle cleanup on deactivation.
 *
 * Inputs: vscode.ExtensionContext
 * Outputs: Command registrations, chat participant, disposables
 * Dependencies: All modules in this extension
 */

import * as vscode from "vscode";
import { ContextWindowManager } from "./engine/contextWindowManager.js";
import { PromptBuilder } from "./engine/prompts.js";
import { ReviewEngine } from "./engine/reviewEngine.js";
import type {
  IOutputWriter,
  IReviewMode,
  PullRequestRef,
} from "./engine/types.js";
import { GitHubApiClient } from "./github/api.js";
import { AuthSessionManager } from "./github/auth.js";
import { ChatResponseWriter } from "./outputs/chatResponse.js";
import { GitHubCommentWriter } from "./outputs/githubComments.js";
import { InlineDiagnosticsWriter } from "./outputs/inlineDiagnostics.js";
import { SummaryPanelWriter } from "./outputs/summaryPanel.js";
import { CodebaseReviewMode } from "./reviewModes/codebaseReview.js";
import { LocalDiffReviewMode } from "./reviewModes/localDiff.js";
import { PullRequestReviewMode } from "./reviewModes/prReview.js";
import { logger } from "./utils/logger.js";

/**
 * Shared diagnostics writer instance — persists across reviews
 * so diagnostics accumulate until explicitly cleared.
 */
let diagnosticsWriter: InlineDiagnosticsWriter | undefined;

/**
 * Shared summary panel writer — reuses the same webview panel.
 */
let summaryPanelWriter: SummaryPanelWriter | undefined;

/**
 * Activates the Copilot Code Review extension.
 *
 * Registers:
 * - Three commands: reviewPR, reviewLocalDiff, reviewCodebase
 * - One Copilot Chat participant: @review with /pr, /diff, /codebase commands
 * - Diagnostic collection for inline findings
 * - Webview panel for summary output
 *
 * @param context - VS Code extension context for managing subscriptions.
 */
export function activate(context: vscode.ExtensionContext): void {
  // Initialize logger first
  logger.init();
  logger.info("Copilot Code Review extension activating...");

  // Initialize shared services
  const authManager = new AuthSessionManager();
  const gitHubClient = new GitHubApiClient(authManager);
  const contextManager = new ContextWindowManager();
  const promptBuilder = new PromptBuilder();
  logger.debug("Shared services initialized");

  // Initialize shared output writers
  diagnosticsWriter = new InlineDiagnosticsWriter();
  summaryPanelWriter = new SummaryPanelWriter(context.extensionUri);

  context.subscriptions.push(
    {
      dispose: () => {
        diagnosticsWriter?.dispose();
      },
    },
    {
      dispose: () => {
        summaryPanelWriter?.dispose();
      },
    },
  );

  const logChannel = logger.getChannel();
  if (logChannel !== undefined) {
    context.subscriptions.push(logChannel);
  }

  // ── Command: Review Pull Request ────────────────────────────────────
  const prCommand = vscode.commands.registerCommand(
    "copilotReview.reviewPR",
    async () => {
      const mode = new PullRequestReviewMode(gitHubClient);
      await runCommandReview(
        mode,
        contextManager,
        promptBuilder,
        context,
        gitHubClient,
      );
    },
  );

  // ── Command: Review Local Diff ──────────────────────────────────────
  const diffCommand = vscode.commands.registerCommand(
    "copilotReview.reviewLocalDiff",
    async () => {
      const mode = new LocalDiffReviewMode();
      await runCommandReview(
        mode,
        contextManager,
        promptBuilder,
        context,
        gitHubClient,
      );
    },
  );

  // ── Command: Review Codebase ────────────────────────────────────────
  const codebaseCommand = vscode.commands.registerCommand(
    "copilotReview.reviewCodebase",
    async () => {
      const mode = new CodebaseReviewMode();
      await runCommandReview(
        mode,
        contextManager,
        promptBuilder,
        context,
        gitHubClient,
      );
    },
  );

  // ── Copilot Chat Participant: @review ───────────────────────────────
  const chatParticipant = vscode.chat.createChatParticipant(
    "copilotReview.review",
    async (
      request: vscode.ChatRequest,
      chatContext: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken,
    ): Promise<void> => {
      await handleChatRequest(
        request,
        chatContext,
        stream,
        token,
        contextManager,
        promptBuilder,
        gitHubClient,
      );
    },
  );

  chatParticipant.iconPath = new vscode.ThemeIcon("code");

  context.subscriptions.push(
    prCommand,
    diffCommand,
    codebaseCommand,
    chatParticipant,
  );

  logger.info("Copilot Code Review extension activated successfully");
}

/**
 * Deactivates the extension and cleans up resources.
 */
export function deactivate(): void {
  diagnosticsWriter?.dispose();
  diagnosticsWriter = undefined;
  summaryPanelWriter?.dispose();
  summaryPanelWriter = undefined;
}

/**
 * Runs a review from a VS Code command (not chat participant).
 *
 * Wraps the review in a progress notification and routes results
 * to the diagnostics writer and summary panel.
 *
 * @param mode - The review mode to execute.
 * @param contextManager - Token budgeting service.
 * @param promptBuilder - Prompt construction service.
 * @param context - Extension context.
 * @param gitHubClient - GitHub API client.
 */
async function runCommandReview(
  mode: IReviewMode,
  contextManager: ContextWindowManager,
  promptBuilder: PromptBuilder,
  context: vscode.ExtensionContext,
  gitHubClient: GitHubApiClient,
): Promise<void> {
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Copilot Code Review (${mode.name})`,
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: "Fetching changes...", increment: 0 });

        logger.info(`Starting ${mode.name} review...`);
        const files = await mode.getDiffs(token);
        logger.info(`Fetched ${files.length} file(s) for review`);

        if (files.length === 0) {
          vscode.window.showInformationMessage(
            "Copilot Code Review: No files to review.",
          );
          return;
        }

        const meta = await mode.getRepoMeta();

        // Build output writers for command-based reviews
        const writers: IOutputWriter[] = [
          diagnosticsWriter!,
          summaryPanelWriter!,
        ];

        // For PR mode, add the GitHub comment writer
        if (mode.name === "pr" && meta.prNumber !== undefined) {
          const prRef: PullRequestRef = {
            owner: meta.repoName.split("/")[0] ?? "",
            repo: meta.repoName.split("/")[1] ?? "",
            number: meta.prNumber,
          };
          writers.push(
            new GitHubCommentWriter(
              gitHubClient,
              prRef,
              meta.headSha ?? "HEAD",
            ),
          );
        }

        const engine = new ReviewEngine(contextManager, promptBuilder, writers);
        const result = await engine.runReview(files, meta, token, progress);

        vscode.window.showInformationMessage(
          `Copilot Code Review: Found ${result.findings.length} issue(s) ` +
            `(${result.uncertainFindings.length} uncertain).`,
        );

        logger.info(
          `Review complete: ${result.findings.length} findings, ${result.uncertainFindings.length} uncertain`,
        );
      },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("cancelled")) {
      logger.error(`Review failed: ${message}`);
      vscode.window.showErrorMessage(`Copilot Code Review: ${message}`);
    }
  }
}

/**
 * Handles incoming Copilot Chat requests for the @review participant.
 *
 * Routes /pr, /diff, and /codebase commands to their respective
 * review modes and streams results back to the chat panel.
 *
 * @param request - The chat request from the user.
 * @param _chatContext - Chat conversation context.
 * @param stream - Response stream for writing output.
 * @param token - Cancellation token.
 * @param contextManager - Token budgeting service.
 * @param promptBuilder - Prompt construction service.
 * @param gitHubClient - GitHub API client.
 */
async function handleChatRequest(
  request: vscode.ChatRequest,
  _chatContext: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  contextManager: ContextWindowManager,
  promptBuilder: PromptBuilder,
  gitHubClient: GitHubApiClient,
): Promise<void> {
  const command = request.command ?? "";
  let mode: IReviewMode;

  switch (command) {
    case "pr": {
      mode = new PullRequestReviewMode(gitHubClient);
      break;
    }
    case "diff": {
      mode = new LocalDiffReviewMode();
      break;
    }
    case "codebase": {
      mode = new CodebaseReviewMode();
      break;
    }
    default: {
      stream.markdown(
        "## Copilot Code Review\n\n" +
          "Available commands:\n\n" +
          "- `/pr` — Review a GitHub Pull Request\n" +
          "- `/diff` — Review local uncommitted changes\n" +
          "- `/codebase` — Scan the entire workspace\n\n" +
          "Example: `@review /diff`\n",
      );
      return;
    }
  }

  try {
    stream.progress("Fetching changes...");

    const files = await mode.getDiffs(token);

    if (files.length === 0) {
      stream.markdown("No files to review.\n");
      return;
    }

    const meta = await mode.getRepoMeta();

    const chatWriter = new ChatResponseWriter(stream);
    const writers: IOutputWriter[] = [chatWriter];

    // Also write to diagnostics and summary panel
    if (diagnosticsWriter !== undefined) {
      writers.push(diagnosticsWriter);
    }

    const engine = new ReviewEngine(contextManager, promptBuilder, writers);

    const dummyProgress: vscode.Progress<{
      message: string;
      increment: number;
    }> = {
      report: (value) => {
        stream.progress(value.message);
      },
    };

    await engine.runReview(files, meta, token, dummyProgress);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    stream.markdown(`\n❌ **Error:** ${message}\n`);
  }
}
