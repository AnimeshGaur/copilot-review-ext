/**
 * @module engine/reviewEngine
 *
 * Orchestrates the full code review pipeline: receives diff files,
 * batches them within the token ceiling, sends each batch to the
 * Copilot LLM via VS Code's language model API, parses responses,
 * filters hallucinated findings, and routes results to output writers.
 *
 * Inputs: DiffFile[], RepoMeta, CancellationToken, Progress
 * Outputs: ReviewResult
 * Dependencies: engine/types, engine/contextWindowManager, engine/prompts, vscode
 */

import * as vscode from "vscode";
import type {
  BatchReviewResult,
  DiffFile,
  IContextWindowManager,
  IOutputWriter,
  IPromptBuilder,
  IReviewEngine,
  LlmFinding,
  RepoMeta,
  ReviewFinding,
  ReviewResult,
} from "./types.js";
import { isConfidenceLevel, isFindingSeverity, isLlmFinding } from "./types.js";

/**
 * Copilot model family identifiers to try, in priority order.
 * Different Copilot versions expose models under different family names.
 */
const MODEL_FAMILIES: readonly string[] = [
  "gpt-4o",
  "copilot-gpt-4o",
  "gpt-4",
  "gpt-3.5-turbo",
];

/**
 * Attempts to select a language model from the available Copilot models.
 * Tries each preferred family in order, then falls back to any available model.
 * If absolutely no models are found, logs all available models for debugging.
 *
 * @param token - Cancellation token.
 * @returns The selected language model, or undefined if none available.
 */
async function selectBestModel(
  token: vscode.CancellationToken,
): Promise<vscode.LanguageModelChat | undefined> {
  // Try each preferred family in order
  for (const family of MODEL_FAMILIES) {
    if (token.isCancellationRequested) {
      return undefined;
    }
    const models = await vscode.lm.selectChatModels({ family });
    if (models.length > 0 && models[0] !== undefined) {
      return models[0];
    }
  }

  // Fallback: select any available model
  const allModels = await vscode.lm.selectChatModels();
  if (allModels.length > 0 && allModels[0] !== undefined) {
    return allModels[0];
  }

  return undefined;
}

/**
 * ReviewEngine orchestrates the end-to-end review pipeline.
 *
 * All dependencies are injected via the constructor, enabling
 * testability and loose coupling.
 *
 * @example
 * ```ts
 * const engine = new ReviewEngine(contextMgr, promptBuilder, [diagnosticsWriter, panelWriter]);
 * const result = await engine.runReview(files, meta, token, progress);
 * ```
 */
export class ReviewEngine implements IReviewEngine {
  private readonly contextManager: IContextWindowManager;
  private readonly promptBuilder: IPromptBuilder;
  private readonly outputWriters: readonly IOutputWriter[];

  /**
   * Creates a new ReviewEngine.
   * @param contextManager - Token budgeting and batch construction service.
   * @param promptBuilder - System and user prompt builder.
   * @param outputWriters - Output targets for review results.
   */
  public constructor(
    contextManager: IContextWindowManager,
    promptBuilder: IPromptBuilder,
    outputWriters: readonly IOutputWriter[],
  ) {
    this.contextManager = contextManager;
    this.promptBuilder = promptBuilder;
    this.outputWriters = outputWriters;
  }

  /**
   * Runs the full review pipeline.
   *
   * Steps:
   * 1. Reset session tracking
   * 2. Build batches from diff files
   * 3. Inject repo metadata into each batch
   * 4. Send each batch to Copilot LLM
   * 5. Parse and validate LLM responses
   * 6. Filter hallucinated findings
   * 7. Separate low-confidence findings
   * 8. Route results to output writers
   *
   * @param files - Diff files to review.
   * @param meta - Repository metadata.
   * @param token - Cancellation token.
   * @param progress - Progress reporter.
   * @returns Aggregated review result.
   */
  public async runReview(
    files: DiffFile[],
    meta: RepoMeta,
    token: vscode.CancellationToken,
    progress: vscode.Progress<{ message: string; increment: number }>,
  ): Promise<ReviewResult> {
    this.contextManager.resetSession();

    // Step 1: Build batches
    progress.report({ message: "Building review batches...", increment: 5 });
    const rawBatches = this.contextManager.buildBatches(files);

    if (rawBatches.length === 0) {
      const emptyResult: ReviewResult = {
        findings: [],
        uncertainFindings: [],
        sessionStats: this.contextManager.getSessionStats(),
        repoMeta: meta,
      };
      await this.routeToOutputs(emptyResult, token);
      return emptyResult;
    }

    // Step 2: Inject metadata
    const batches = rawBatches.map((b) =>
      this.contextManager.injectMetaHeader(b, meta),
    );

    // Step 3: Process each batch through the LLM
    const allBatchResults: BatchReviewResult[] = [];
    const incrementPerBatch = 80 / batches.length;

    for (const batch of batches) {
      if (token.isCancellationRequested) {
        break;
      }

      progress.report({
        message: `Reviewing batch ${batch.batchIndex + 1} of ${batch.totalBatches}...`,
        increment: incrementPerBatch,
      });

      const batchResult = await this.processBatch(batch, token);
      allBatchResults.push(batchResult);
    }

    // Step 4: Aggregate and filter findings
    progress.report({
      message: "Filtering and validating findings...",
      increment: 10,
    });

    const allFindings = allBatchResults.flatMap((br) => br.findings);
    const validatedFindings = this.filterHallucinatedFindings(
      allFindings,
      files,
    );

    const highMedFindings = validatedFindings.filter(
      (f) => f.confidence === "high" || f.confidence === "medium",
    );
    const lowFindings = validatedFindings.filter((f) => f.confidence === "low");

    const result: ReviewResult = {
      findings: highMedFindings,
      uncertainFindings: lowFindings,
      sessionStats: this.contextManager.getSessionStats(),
      repoMeta: meta,
    };

    // Step 5: Route to output writers
    progress.report({ message: "Writing results...", increment: 5 });
    await this.routeToOutputs(result, token);

    return result;
  }

  /**
   * Processes a single batch through the Copilot LLM.
   *
   * Tries multiple model families in priority order, then falls back
   * to any available language model.
   *
   * @param batch - The review batch to process.
   * @param token - Cancellation token.
   * @returns Parsed batch review result.
   */
  private async processBatch(
    batch: import("./types.js").ReviewBatch,
    token: vscode.CancellationToken,
  ): Promise<BatchReviewResult> {
    const systemPrompt = this.promptBuilder.buildSystemPrompt();
    const userPrompt = this.promptBuilder.buildUserPrompt(batch);

    const emptyResult: BatchReviewResult = {
      batchIndex: batch.batchIndex,
      findings: [],
      rawResponse: "",
    };

    try {
      const model = await selectBestModel(token);

      if (model === undefined) {
        vscode.window.showWarningMessage(
          "Copilot Code Review: No language model found. Ensure GitHub Copilot is installed and active.",
        );
        return emptyResult;
      }

      const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(
          `${systemPrompt}\n\n---\n\n${userPrompt}`,
        ),
      ];

      const response = await model.sendRequest(messages, {}, token);

      let fullResponse = "";
      for await (const chunk of response.text) {
        fullResponse += chunk;
      }

      const findings = this.parseResponse(fullResponse);

      return {
        batchIndex: batch.batchIndex,
        findings,
        rawResponse: fullResponse,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      vscode.window.showWarningMessage(
        `Copilot Code Review: LLM error on batch ${batch.batchIndex + 1}: ${errorMessage}`,
      );
      return emptyResult;
    }
  }

  /**
   * Parses the raw LLM response string into validated ReviewFinding[].
   *
   * Extracts JSON from possible markdown code fences, validates each
   * finding structurally, and normalizes field values.
   *
   * @param raw - Raw LLM response text.
   * @returns Array of validated review findings.
   */
  private parseResponse(raw: string): ReviewFinding[] {
    const jsonString = this.extractJson(raw);
    if (jsonString === undefined) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      return [];
    }

    if (typeof parsed !== "object" || parsed === null) {
      return [];
    }

    const response = parsed as Record<string, unknown>;
    const rawFindings = response["findings"];

    if (!Array.isArray(rawFindings)) {
      return [];
    }

    const validated: ReviewFinding[] = [];

    for (const item of rawFindings) {
      if (!isLlmFinding(item)) {
        continue;
      }

      const finding = item as LlmFinding;
      const severity = isFindingSeverity(finding.severity)
        ? finding.severity
        : ("info" as const);
      const confidence = isConfidenceLevel(finding.confidence)
        ? finding.confidence
        : ("low" as const);

      validated.push({
        file: finding.file,
        line: finding.line,
        endLine: finding.endLine,
        severity,
        message: finding.message,
        category: finding.category,
        confidence,
        suggestion: finding.suggestion,
        requiresContext: finding.requires_context === true,
      });
    }

    return validated;
  }

  /**
   * Extracts a JSON string from raw LLM output, handling optional
   * markdown code fences.
   *
   * @param raw - Raw text that may contain JSON wrapped in code fences.
   * @returns The extracted JSON string, or undefined if not found.
   */
  private extractJson(raw: string): string | undefined {
    const trimmed = raw.trim();

    // Try to extract from code fence
    const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/.exec(trimmed);
    if (fenceMatch !== null && fenceMatch[1] !== undefined) {
      return fenceMatch[1].trim();
    }

    // Try direct JSON object or array
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return trimmed;
    }

    // Scan for first { or [ in case of prose prefix without code fences
    const objIdx = trimmed.indexOf("{");
    const arrIdx = trimmed.indexOf("[");
    const startIdx =
      objIdx === -1
        ? arrIdx
        : arrIdx === -1
          ? objIdx
          : Math.min(objIdx, arrIdx);

    if (startIdx !== -1) {
      return trimmed.slice(startIdx);
    }

    return undefined;
  }

  /**
   * Filters out hallucinated findings — those referencing files or lines
   * not present in the input.
   *
   * The hallucination contract: any finding without a verifiable file+line
   * in the input batch is silently dropped.
   *
   * @param findings - Raw findings from the LLM.
   * @param inputFiles - The original input files for verification.
   * @returns Validated findings with verifiable file+line references.
   */
  private filterHallucinatedFindings(
    findings: readonly ReviewFinding[],
    inputFiles: readonly DiffFile[],
  ): ReviewFinding[] {
    const fileMap = new Map<string, DiffFile>();
    for (const f of inputFiles) {
      fileMap.set(f.filePath, f);
    }

    return findings.filter((finding) => {
      // Verify the file exists in input
      const matchedFile = fileMap.get(finding.file);
      if (matchedFile === undefined) {
        return false;
      }

      // Verify the line number is plausible
      const lineCount = matchedFile.content.split("\n").length;
      if (finding.line < 1 || finding.line > lineCount) {
        return false;
      }

      // Skip findings that require additional context
      if (finding.requiresContext) {
        return false;
      }

      return true;
    });
  }

  /**
   * Routes the final review result to all registered output writers.
   *
   * @param result - The aggregated review result.
   * @param token - Cancellation token.
   */
  private async routeToOutputs(
    result: ReviewResult,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const writePromises = this.outputWriters.map(async (writer) => {
      try {
        await writer.write(result, token);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showWarningMessage(
          `Copilot Code Review: Output writer error: ${msg}`,
        );
      }
    });

    await Promise.allSettled(writePromises);
  }
}
