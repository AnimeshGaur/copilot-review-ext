/**
 * @module engine/contextWindowManager
 *
 * Manages token budgeting and batch construction for LLM calls.
 *
 * Purpose: Estimates token counts, splits oversized payloads into ordered batches
 * that respect the 32,000-token hard ceiling, and injects repository metadata
 * headers into each batch.
 *
 * Inputs: DiffFile[], RepoMeta
 * Outputs: ReviewBatch[]
 * Dependencies: engine/types
 */

import type {
  DiffFile,
  IContextWindowManager,
  RepoMeta,
  ReviewBatch,
  SessionStats,
} from "./types.js";

/**
 * Hard ceiling for tokens per LLM call (Copilot GPT-4o safe limit).
 * Never exceeded — batches are sized to fit within this budget.
 */
const TOKEN_CEILING = 32_000;

/**
 * Approximate characters-per-token ratio.
 * Conservative heuristic: ~4 characters ≈ 1 token.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Reserved tokens for the system prompt, meta header, and response headroom.
 * This ensures the actual diff content never consumes the full ceiling.
 */
const RESERVED_TOKENS = 4_000;

/**
 * Maximum tokens available for diff content per batch.
 */
const CONTENT_BUDGET = TOKEN_CEILING - RESERVED_TOKENS;

/**
 * Builds the metadata header string injected into every batch.
 * @param meta - Repository metadata.
 * @returns Formatted header string.
 */
function formatMetaHeader(meta: RepoMeta): string {
  const langEntries = Array.from(meta.languageStats.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([lang, pct]) => `${lang}: ${pct}%`)
    .join(", ");

  const lines: string[] = [
    `[REPO] ${meta.repoName}`,
    `[BRANCH] ${meta.branch}`,
  ];

  if (meta.prTitle !== undefined && meta.prNumber !== undefined) {
    lines.push(`[PR #${meta.prNumber}] ${meta.prTitle}`);
  }

  lines.push(`[LANGUAGES] ${langEntries || "unknown"}`);

  return lines.join("\n");
}

/**
 * ContextWindowManager implements token estimation, batch splitting,
 * and session-level token tracking.
 *
 * @example
 * ```ts
 * const mgr = new ContextWindowManager();
 * const batches = mgr.buildBatches(diffFiles);
 * const enriched = batches.map(b => mgr.injectMetaHeader(b, repoMeta));
 * console.log(mgr.getSessionStats());
 * ```
 */
export class ContextWindowManager implements IContextWindowManager {
  private totalTokensConsumed = 0;
  private batchCount = 0;
  private fileCount = 0;

  /**
   * Estimates the token count for a string using the ~4 chars/token heuristic.
   * @param content - The text content to estimate.
   * @returns Estimated token count (always ≥ 1 for non-empty strings).
   */
  public estimateTokens(content: string): number {
    if (content.length === 0) {
      return 0;
    }
    return Math.max(1, Math.ceil(content.length / CHARS_PER_TOKEN));
  }

  /**
   * Splits an array of diff files into ordered batches that each fit
   * within the token ceiling.
   *
   * Files that individually exceed the content budget are split into
   * sub-chunks with carry-over headers indicating continuation.
   *
   * @param files - The diff files to batch.
   * @returns An array of ReviewBatch objects with placeholder metaHeaders.
   */
  public buildBatches(files: DiffFile[]): ReviewBatch[] {
    const enrichedFiles = files.map((f) => ({
      ...f,
      estimatedTokens: this.estimateTokens(f.content),
    }));

    const rawBatches: DiffFile[][] = [];
    let currentBatch: DiffFile[] = [];
    let currentTokens = 0;

    for (const file of enrichedFiles) {
      if (file.estimatedTokens > CONTENT_BUDGET) {
        // Flush current batch if non-empty
        if (currentBatch.length > 0) {
          rawBatches.push(currentBatch);
          currentBatch = [];
          currentTokens = 0;
        }
        // Split oversized file into sub-chunks
        const chunks = this.splitOversizedFile(file);
        for (const chunk of chunks) {
          rawBatches.push([chunk]);
        }
      } else if (currentTokens + file.estimatedTokens > CONTENT_BUDGET) {
        // Current batch is full — start a new one
        rawBatches.push(currentBatch);
        currentBatch = [file];
        currentTokens = file.estimatedTokens;
      } else {
        currentBatch.push(file);
        currentTokens += file.estimatedTokens;
      }
    }

    if (currentBatch.length > 0) {
      rawBatches.push(currentBatch);
    }

    // Handle empty input
    if (rawBatches.length === 0) {
      return [];
    }

    const totalBatches = rawBatches.length;

    const batches: ReviewBatch[] = rawBatches.map((batchFiles, index) => {
      const batchTokens = batchFiles.reduce(
        (sum, f) => sum + f.estimatedTokens,
        0,
      );
      this.totalTokensConsumed += batchTokens;
      this.batchCount += 1;
      this.fileCount += batchFiles.length;

      return {
        batchIndex: index,
        totalBatches,
        estimatedTokens: batchTokens,
        files: batchFiles,
        metaHeader: "",
      };
    });

    return batches;
  }

  /**
   * Injects repository metadata into a batch's metaHeader field.
   * @param batch - The batch to enrich.
   * @param meta - Repository metadata.
   * @returns A new ReviewBatch with the metaHeader populated.
   */
  public injectMetaHeader(batch: ReviewBatch, meta: RepoMeta): ReviewBatch {
    return {
      ...batch,
      metaHeader: formatMetaHeader(meta),
    };
  }

  /**
   * Returns cumulative session statistics.
   * @returns SessionStats with total tokens, batch count, and file count.
   */
  public getSessionStats(): SessionStats {
    return {
      totalTokensConsumed: this.totalTokensConsumed,
      batchCount: this.batchCount,
      fileCount: this.fileCount,
    };
  }

  /**
   * Resets session-level tracking counters.
   */
  public resetSession(): void {
    this.totalTokensConsumed = 0;
    this.batchCount = 0;
    this.fileCount = 0;
  }

  /**
   * Splits an oversized file into multiple DiffFile chunks, each fitting
   * within the content budget. Each chunk gets a carry-over header.
   * @param file - The oversized DiffFile.
   * @returns An array of sub-chunked DiffFiles.
   */
  private splitOversizedFile(file: DiffFile): DiffFile[] {
    const lines = file.content.split("\n");
    const chunks: DiffFile[] = [];
    let chunkLines: string[] = [];
    let chunkTokens = 0;

    const headerBudget = this.estimateTokens(
      `[CONTINUATION] ${file.filePath} (chunk N of M)\n`,
    );
    const effectiveBudget = CONTENT_BUDGET - headerBudget;

    for (const line of lines) {
      const lineTokens = this.estimateTokens(line + "\n");

      if (chunkTokens + lineTokens > effectiveBudget && chunkLines.length > 0) {
        chunks.push(this.createChunk(file, chunkLines));
        chunkLines = [];
        chunkTokens = 0;
      }

      chunkLines.push(line);
      chunkTokens += lineTokens;
    }

    if (chunkLines.length > 0) {
      chunks.push(this.createChunk(file, chunkLines));
    }

    // Update chunk carry-over headers with correct total
    return chunks.map((chunk, idx) => ({
      ...chunk,
      filePath: `${file.filePath}`,
      content:
        `[CONTINUATION] ${file.filePath} (chunk ${idx + 1} of ${chunks.length})\n` +
        chunk.content,
      estimatedTokens: chunk.estimatedTokens + headerBudget,
    }));
  }

  /**
   * Creates a single DiffFile chunk from partial lines.
   * @param original - The original DiffFile being split.
   * @param lines - Subset of lines for this chunk.
   * @returns A new DiffFile representing this chunk.
   */
  private createChunk(original: DiffFile, lines: string[]): DiffFile {
    const content = lines.join("\n");
    return {
      filePath: original.filePath,
      language: original.language,
      content,
      estimatedTokens: this.estimateTokens(content),
    };
  }
}
