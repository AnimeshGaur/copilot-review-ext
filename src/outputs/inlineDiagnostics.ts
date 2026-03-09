/**
 * @module outputs/inlineDiagnostics
 *
 * VS Code diagnostics writer for inline code review findings.
 *
 * Purpose: Maps review findings to VS Code Diagnostic objects and
 * pushes them into a DiagnosticCollection for inline display in
 * the editor gutter and Problems panel.
 *
 * Inputs: ReviewResult
 * Outputs: vscode.DiagnosticCollection entries
 * Dependencies: vscode, engine/types
 */

import * as vscode from "vscode";
import type {
  FindingSeverity,
  IOutputWriter,
  ReviewResult,
} from "../engine/types.js";

/**
 * Diagnostic source identifier shown in the Problems panel.
 */
const DIAGNOSTIC_SOURCE = "Copilot Code Review";

/**
 * InlineDiagnosticsWriter maps review findings to VS Code diagnostics
 * for inline display in the editor.
 *
 * Only high and medium confidence findings are shown inline.
 * Low-confidence findings are routed to the summary panel instead.
 *
 * @example
 * ```ts
 * const writer = new InlineDiagnosticsWriter();
 * await writer.write(reviewResult, token);
 * // Findings now appear in the Problems panel and editor gutter
 * ```
 */
export class InlineDiagnosticsWriter implements IOutputWriter {
  private readonly diagnosticCollection: vscode.DiagnosticCollection;

  /**
   * Creates a new InlineDiagnosticsWriter with a fresh DiagnosticCollection.
   */
  public constructor() {
    this.diagnosticCollection =
      vscode.languages.createDiagnosticCollection("copilot-review");
  }

  /**
   * Writes review findings as VS Code diagnostics.
   *
   * Groups findings by file and creates Diagnostic objects with
   * appropriate severity, range, source, and code metadata.
   *
   * @param result - The aggregated review result.
   * @param _token - Cancellation token (reserved for future use).
   */
  public async write(
    result: ReviewResult,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    // Clear previous diagnostics
    this.diagnosticCollection.clear();

    // Group findings by file path
    const grouped = new Map<string, vscode.Diagnostic[]>();

    for (const finding of result.findings) {
      const line = Math.max(0, finding.line - 1); // VS Code is 0-indexed
      const endLine =
        finding.endLine !== undefined
          ? Math.max(line, finding.endLine - 1)
          : line;

      const range = new vscode.Range(
        new vscode.Position(line, 0),
        new vscode.Position(endLine, Number.MAX_SAFE_INTEGER),
      );

      const severity = this.mapSeverity(finding.severity);

      const diagnostic = new vscode.Diagnostic(
        range,
        finding.message,
        severity,
      );

      diagnostic.source = DIAGNOSTIC_SOURCE;
      diagnostic.code = finding.category;

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      const fileUri = workspaceRoot
        ? vscode.Uri.joinPath(workspaceRoot, finding.file)
        : vscode.Uri.file(finding.file);

      if (finding.suggestion !== undefined) {
        diagnostic.relatedInformation = [
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(fileUri, range),
            `Suggestion: ${finding.suggestion}`,
          ),
        ];
      }

      const existing = grouped.get(finding.file);
      if (existing !== undefined) {
        existing.push(diagnostic);
      } else {
        grouped.set(finding.file, [diagnostic]);
      }
    }

    // Apply diagnostics per file
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    for (const [filePath, diagnostics] of grouped) {
      const uri = workspaceRoot
        ? vscode.Uri.joinPath(workspaceRoot, filePath)
        : vscode.Uri.file(filePath);
      this.diagnosticCollection.set(uri, diagnostics);
    }
  }

  /**
   * Disposes the diagnostic collection.
   */
  public dispose(): void {
    this.diagnosticCollection.dispose();
  }

  /**
   * Maps a FindingSeverity to a VS Code DiagnosticSeverity.
   *
   * @param severity - The finding severity level.
   * @returns Corresponding VS Code diagnostic severity.
   */
  private mapSeverity(severity: FindingSeverity): vscode.DiagnosticSeverity {
    switch (severity) {
      case "error":
        return vscode.DiagnosticSeverity.Error;
      case "warning":
        return vscode.DiagnosticSeverity.Warning;
      case "info":
        return vscode.DiagnosticSeverity.Information;
      case "hint":
        return vscode.DiagnosticSeverity.Hint;
    }
  }
}
