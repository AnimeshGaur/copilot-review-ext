/**
 * @module outputs/summaryPanel
 *
 * CSP-compliant webview panel for displaying review results.
 *
 * Purpose: Renders all findings in a rich HTML panel with collapsible
 * sections for high/medium findings and a separate "Uncertain Findings"
 * section for low-confidence items.
 *
 * Inputs: ReviewResult
 * Outputs: vscode.WebviewPanel
 * Dependencies: vscode, engine/types
 */

import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type {
  IOutputWriter,
  ReviewFinding,
  ReviewResult,
  SessionStats,
} from "../engine/types.js";

/**
 * SummaryPanelWriter renders review results in a CSP-compliant
 * webview panel.
 *
 * Features:
 * - Findings grouped by severity
 * - Collapsible "Uncertain Findings" section for low-confidence items
 * - Session statistics display
 * - Nonce-based CSP for security
 *
 * @example
 * ```ts
 * const panel = new SummaryPanelWriter(extensionUri);
 * await panel.write(result, token);
 * ```
 */
export class SummaryPanelWriter implements IOutputWriter {
  private panel: vscode.WebviewPanel | undefined;
  private readonly extensionUri: vscode.Uri;

  /**
   * Creates a new SummaryPanelWriter.
   * @param extensionUri - The extension's root URI for resolving resources.
   */
  public constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  /**
   * Writes review results to the webview panel.
   *
   * Creates the panel if it doesn't exist, or updates its content
   * if it's already open.
   *
   * @param result - The aggregated review result.
   * @param _token - Cancellation token (reserved for future use).
   */
  public async write(
    result: ReviewResult,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    if (this.panel === undefined) {
      this.panel = vscode.window.createWebviewPanel(
        "copilotReviewSummary",
        "Copilot Code Review — Summary",
        vscode.ViewColumn.Two,
        {
          enableScripts: true,
          localResourceRoots: [this.extensionUri],
        },
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }

    this.panel.webview.html = this.buildHtml(this.panel.webview, result);
  }

  /**
   * Disposes the webview panel if it exists.
   */
  public dispose(): void {
    if (this.panel !== undefined) {
      this.panel.dispose();
      this.panel = undefined;
    }
  }

  /**
   * Builds the full CSP-compliant HTML for the webview panel.
   *
   * @param webview - The webview instance for nonce generation.
   * @param result - Review result to render.
   * @returns Complete HTML string.
   */
  private buildHtml(webview: vscode.Webview, result: ReviewResult): string {
    const nonce = this.generateNonce();
    const cspSource = webview.cspSource;

    const findingsHtml = this.renderFindings(result.findings, "Findings");
    const uncertainHtml =
      result.uncertainFindings.length > 0
        ? this.renderUncertainFindings(result.uncertainFindings)
        : "";
    const statsHtml = this.renderStats(
      result.sessionStats,
      result.repoMeta.repoName,
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <title>Copilot Code Review Summary</title>
    <style nonce="${nonce}">
        :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --border: var(--vscode-panel-border);
            --error-bg: var(--vscode-inputValidation-errorBackground, #5a1d1d);
            --warning-bg: var(--vscode-inputValidation-warningBackground, #4d3a1a);
            --info-bg: var(--vscode-inputValidation-infoBackground, #1a3a4d);
        }
        body { font-family: var(--vscode-font-family); color: var(--fg); background: var(--bg); padding: 16px; margin: 0; line-height: 1.6; }
        h1 { font-size: 1.4em; margin-bottom: 8px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
        h2 { font-size: 1.1em; margin: 16px 0 8px; }
        .stats { display: flex; gap: 16px; margin-bottom: 16px; padding: 8px 12px; background: var(--vscode-textBlockQuote-background); border-radius: 4px; font-size: 0.9em; }
        .stat-item { display: flex; gap: 4px; }
        .stat-label { opacity: 0.7; }
        .finding { border: 1px solid var(--border); border-radius: 4px; margin: 8px 0; padding: 10px 14px; }
        .finding.severity-error { border-left: 3px solid var(--vscode-errorForeground, #f44); }
        .finding.severity-warning { border-left: 3px solid var(--vscode-list-warningForeground, #fa4); }
        .finding.severity-info { border-left: 3px solid var(--vscode-notificationsInfoIcon-foreground, #4af); }
        .finding.severity-hint { border-left: 3px solid var(--vscode-editorGhostText-foreground, #888); }
        .finding-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
        .finding-location { font-family: var(--vscode-editor-font-family); font-size: 0.85em; opacity: 0.8; cursor: pointer; text-decoration: underline; }
        .finding-badge { font-size: 0.75em; padding: 1px 6px; border-radius: 3px; text-transform: uppercase; }
        .badge-error { background: var(--error-bg); }
        .badge-warning { background: var(--warning-bg); }
        .badge-info { background: var(--info-bg); }
        .finding-message { margin: 4px 0; }
        .finding-suggestion { font-size: 0.9em; opacity: 0.8; margin-top: 4px; padding: 6px 10px; background: var(--vscode-textBlockQuote-background); border-radius: 3px; }
        .uncertain-section { margin-top: 24px; }
        .uncertain-section summary { cursor: pointer; font-weight: bold; padding: 8px; background: var(--vscode-textBlockQuote-background); border-radius: 4px; }
        .no-findings { text-align: center; padding: 32px; opacity: 0.6; }
    </style>
</head>
<body>
    <h1>Copilot Code Review Summary</h1>
    ${statsHtml}
    ${findingsHtml}
    ${uncertainHtml}
    <script nonce="${nonce}">
        (function() {
            const vscode = acquireVsCodeApi();
            document.querySelectorAll('.finding-location').forEach(function(el) {
                el.addEventListener('click', function() {
                    const file = el.getAttribute('data-file');
                    const line = parseInt(el.getAttribute('data-line'), 10);
                    if (file && !isNaN(line)) {
                        vscode.postMessage({ command: 'openFile', file: file, line: line });
                    }
                });
            });
        })();
    </script>
</body>
</html>`;
  }

  /**
   * Renders a list of findings as HTML.
   *
   * @param findings - Findings to render.
   * @param title - Section title.
   * @returns HTML string for the findings section.
   */
  private renderFindings(
    findings: readonly ReviewFinding[],
    title: string,
  ): string {
    if (findings.length === 0) {
      return `<div class="no-findings"><p>No issues found — looking clean! ✅</p></div>`;
    }

    const items = findings.map((f) => this.renderSingleFinding(f)).join("\n");
    return `<h2>${title} (${findings.length})</h2>\n${items}`;
  }

  /**
   * Renders the uncertain findings in a collapsible details element.
   *
   * @param findings - Low-confidence findings.
   * @returns HTML string for the collapsible section.
   */
  private renderUncertainFindings(findings: readonly ReviewFinding[]): string {
    const items = findings.map((f) => this.renderSingleFinding(f)).join("\n");
    return `
<div class="uncertain-section">
    <details>
        <summary>Uncertain Findings (${findings.length}) — Low Confidence</summary>
        <p style="font-size: 0.85em; opacity: 0.7; margin: 8px 0;">
            These findings could not be confirmed from the diff alone. Review with caution.
        </p>
        ${items}
    </details>
</div>`;
  }

  /**
   * Renders a single finding as an HTML card.
   *
   * @param finding - The finding to render.
   * @returns HTML string for the finding card.
   */
  private renderSingleFinding(finding: ReviewFinding): string {
    const endLineDisplay =
      finding.endLine !== undefined ? `-${finding.endLine}` : "";
    const suggestionHtml =
      finding.suggestion !== undefined
        ? `<div class="finding-suggestion">💡 ${this.escapeHtml(finding.suggestion)}</div>`
        : "";

    return `
<div class="finding severity-${finding.severity}">
    <div class="finding-header">
        <span class="finding-location" data-file="${this.escapeHtml(finding.file)}" data-line="${finding.line}">${this.escapeHtml(finding.file)}:${finding.line}${endLineDisplay}</span>
        <span class="finding-badge badge-${finding.severity}">${finding.severity}</span>
    </div>
    <div class="finding-message">${this.escapeHtml(finding.message)}</div>
    ${suggestionHtml}
</div>`;
  }

  /**
   * Renders session statistics as HTML.
   *
   * @param stats - Session stats.
   * @param repoName - Repository name.
   * @returns HTML string for the stats bar.
   */
  private renderStats(stats: SessionStats, repoName: string): string {
    return `
<div class="stats">
    <div class="stat-item"><span class="stat-label">Repo:</span> ${this.escapeHtml(repoName)}</div>
    <div class="stat-item"><span class="stat-label">Files:</span> ${stats.fileCount}</div>
    <div class="stat-item"><span class="stat-label">Batches:</span> ${stats.batchCount}</div>
    <div class="stat-item"><span class="stat-label">Tokens:</span> ${stats.totalTokensConsumed.toLocaleString()}</div>
</div>`;
  }

  /**
   * Generates a cryptographically-appropriate nonce for CSP.
   *
   * @returns A 32-character hex nonce string.
   */
  private generateNonce(): string {
    return randomBytes(16).toString("hex");
  }

  /**
   * Escapes HTML special characters to prevent XSS.
   *
   * @param text - Raw text to escape.
   * @returns HTML-safe text.
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
