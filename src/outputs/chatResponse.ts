/**
 * @module outputs/chatResponse
 *
 * Copilot Chat streaming responder for review findings.
 *
 * Purpose: Writes review findings into a vscode.ChatResponseStream
 * for inline display in the Copilot Chat panel. Formats findings
 * as structured markdown with code references.
 *
 * Inputs: ReviewResult, vscode.ChatResponseStream
 * Outputs: Streamed markdown in Copilot Chat
 * Dependencies: vscode, engine/types
 */

import * as vscode from "vscode";
import type {
  IOutputWriter,
  ReviewFinding,
  ReviewResult,
} from "../engine/types.js";

/**
 * ChatResponseWriter streams review findings into the Copilot Chat UI.
 *
 * Formats findings as structured markdown with severity icons,
 * file references, and suggestions. Low-confidence findings
 * are shown in a separate section.
 *
 * @example
 * ```ts
 * const writer = new ChatResponseWriter(chatStream);
 * await writer.write(result, token);
 * ```
 */
export class ChatResponseWriter implements IOutputWriter {
  private readonly stream: vscode.ChatResponseStream;

  /**
   * Creates a new ChatResponseWriter.
   * @param stream - The Copilot Chat response stream to write to.
   */
  public constructor(stream: vscode.ChatResponseStream) {
    this.stream = stream;
  }

  /**
   * Writes review findings to the Copilot Chat response stream.
   *
   * @param result - The aggregated review result.
   * @param _token - Cancellation token (reserved for future use).
   */
  public async write(
    result: ReviewResult,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    // Header with stats
    this.stream.markdown(
      `## Copilot Code Review\n\n` +
        `📊 **${result.findings.length}** findings | ` +
        `${result.sessionStats.fileCount} files | ` +
        `${result.sessionStats.batchCount} batches | ` +
        `${result.sessionStats.totalTokensConsumed.toLocaleString()} tokens\n\n`,
    );

    if (result.findings.length === 0 && result.uncertainFindings.length === 0) {
      this.stream.markdown("✅ No issues found — looking clean!\n");
      return;
    }

    // Render high/medium confidence findings
    if (result.findings.length > 0) {
      this.stream.markdown("### Findings\n\n");

      for (const finding of result.findings) {
        this.renderFinding(finding);
      }
    }

    // Render low-confidence findings separately
    if (result.uncertainFindings.length > 0) {
      this.stream.markdown(
        `\n---\n\n### Uncertain Findings (${result.uncertainFindings.length})\n\n` +
          `_These could not be confirmed from the diff alone._\n\n`,
      );

      for (const finding of result.uncertainFindings) {
        this.renderFinding(finding);
      }
    }
  }

  /**
   * No-op dispose — stream lifecycle is managed externally.
   */
  public dispose(): void {
    // Stream lifecycle managed by the chat participant handler
  }

  /**
   * Renders a single finding as a markdown block in the chat stream.
   *
   * @param finding - The finding to render.
   */
  private renderFinding(finding: ReviewFinding): void {
    const emoji = this.getSeverityEmoji(finding.severity);
    const endLine = finding.endLine !== undefined ? `-${finding.endLine}` : "";

    this.stream.markdown(
      `${emoji} **${finding.severity.toUpperCase()}** \`${finding.file}:${finding.line}${endLine}\` — ${finding.category}\n\n`,
    );

    this.stream.markdown(`${finding.message}\n\n`);

    if (finding.suggestion !== undefined) {
      this.stream.markdown(`💡 *Suggestion:* ${finding.suggestion}\n\n`);
    }

    // Add anchor reference to the file
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      const uri = workspaceRoot
        ? vscode.Uri.joinPath(workspaceRoot, finding.file)
        : vscode.Uri.file(finding.file);
      const location = new vscode.Location(
        uri,
        new vscode.Position(Math.max(0, finding.line - 1), 0),
      );
      this.stream.anchor(location, finding.file);
      this.stream.markdown("\n\n");
    } catch {
      // Skip anchor if file URI construction fails
    }
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
