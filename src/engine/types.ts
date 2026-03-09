/**
 * @module engine/types
 *
 * Central type definitions for the Copilot Code Review extension.
 *
 * Purpose: Defines all shared interfaces, discriminated unions, and type guards
 * used across the engine, GitHub integration, review modes, and output layers.
 *
 * Dependencies: vscode (for diagnostic/chat types referenced downstream)
 */

import type * as vscode from "vscode";

/* ------------------------------------------------------------------ */
/*  Diff & Batch Types                                                 */
/* ------------------------------------------------------------------ */

/** A single file's diff content with metadata. */
export interface DiffFile {
  /** Absolute or repo-relative file path. */
  readonly filePath: string;
  /** Programming language identifier (e.g. "typescript", "python"). */
  readonly language: string;
  /** Raw unified-diff content or full file content for codebase scan. */
  readonly content: string;
  /** Estimated token count for this file's content. */
  readonly estimatedTokens: number;
}

/** Metadata about the repository under review. */
export interface RepoMeta {
  readonly repoName: string;
  readonly branch: string;
  readonly headSha?: string | undefined;
  readonly prTitle: string | undefined;
  readonly prNumber: number | undefined;
  readonly languageStats: ReadonlyMap<string, number>;
}

/** A single batch of files sized to fit within the token ceiling. */
export interface ReviewBatch {
  readonly batchIndex: number;
  readonly totalBatches: number;
  readonly estimatedTokens: number;
  readonly files: readonly DiffFile[];
  readonly metaHeader: string;
}

/** Cumulative stats for a review session. */
export interface SessionStats {
  readonly totalTokensConsumed: number;
  readonly batchCount: number;
  readonly fileCount: number;
}

/* ------------------------------------------------------------------ */
/*  Review Findings                                                    */
/* ------------------------------------------------------------------ */

/** Confidence level for a review finding. */
export type ConfidenceLevel = "high" | "medium" | "low";

/** Severity of a review finding. */
export type FindingSeverity = "error" | "warning" | "info" | "hint";

/** A single review finding from the LLM. */
export interface ReviewFinding {
  readonly file: string;
  readonly line: number;
  readonly endLine: number | undefined;
  readonly severity: FindingSeverity;
  readonly message: string;
  readonly category: string;
  readonly confidence: ConfidenceLevel;
  readonly suggestion: string | undefined;
  readonly requiresContext: boolean;
}

/** Parsed result from a single LLM batch response. */
export interface BatchReviewResult {
  readonly batchIndex: number;
  readonly findings: readonly ReviewFinding[];
  readonly rawResponse: string;
}

/** Aggregated result of a full review session. */
export interface ReviewResult {
  readonly findings: readonly ReviewFinding[];
  readonly uncertainFindings: readonly ReviewFinding[];
  readonly sessionStats: SessionStats;
  readonly repoMeta: RepoMeta;
}

/* ------------------------------------------------------------------ */
/*  LLM Response Schema (what we expect from Copilot)                  */
/* ------------------------------------------------------------------ */

/** Raw JSON shape expected from the LLM. */
export interface LlmReviewResponse {
  readonly findings: readonly LlmFinding[];
}

/** Individual finding in the raw LLM response. */
export interface LlmFinding {
  readonly file: string;
  readonly line: number;
  readonly endLine?: number;
  readonly severity: string;
  readonly message: string;
  readonly category: string;
  readonly confidence: string;
  readonly suggestion?: string;
  readonly requires_context?: boolean;
}

/* ------------------------------------------------------------------ */
/*  PR Info                                                            */
/* ------------------------------------------------------------------ */

/** Parsed pull request reference. */
export interface PullRequestRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/** Pull request metadata from the GitHub API. */
export interface PullRequestInfo {
  readonly title: string;
  readonly number: number;
  readonly headRef: string;
  readonly headSha: string;
  readonly baseRef: string;
  readonly owner: string;
  readonly repo: string;
}

/* ------------------------------------------------------------------ */
/*  Dependency-Injection Interfaces                                    */
/* ------------------------------------------------------------------ */

/** Token estimation and batch-building service. */
export interface IContextWindowManager {
  estimateTokens(content: string): number;
  buildBatches(files: DiffFile[]): ReviewBatch[];
  injectMetaHeader(batch: ReviewBatch, meta: RepoMeta): ReviewBatch;
  getSessionStats(): SessionStats;
  resetSession(): void;
}

/** System and user prompt construction. */
export interface IPromptBuilder {
  buildSystemPrompt(): string;
  buildUserPrompt(batch: ReviewBatch): string;
}

/** Routes review results to an output target. */
export interface IOutputWriter {
  write(result: ReviewResult, token: vscode.CancellationToken): Promise<void>;
  dispose(): void;
}

/** Orchestrates the full review pipeline. */
export interface IReviewEngine {
  runReview(
    files: DiffFile[],
    meta: RepoMeta,
    token: vscode.CancellationToken,
    progress: vscode.Progress<{ message: string; increment: number }>,
  ): Promise<ReviewResult>;
}

/** Produces diff files from a particular source. */
export interface IReviewMode {
  readonly name: string;
  getDiffs(token: vscode.CancellationToken): Promise<DiffFile[]>;
  getRepoMeta(): Promise<RepoMeta>;
}

/** GitHub REST API operations. */
export interface IGitHubClient {
  getPullRequest(ref: PullRequestRef): Promise<PullRequestInfo>;
  getPullRequestDiff(ref: PullRequestRef): Promise<string>;
  postReviewComment(
    ref: PullRequestRef,
    commitId: string,
    comments: ReadonlyArray<{
      readonly path: string;
      readonly line: number;
      readonly body: string;
    }>,
  ): Promise<void>;
}

/** VS Code GitHub authentication provider. */
export interface IAuthProvider {
  getToken(): Promise<string>;
  clearSession(): void;
}

/* ------------------------------------------------------------------ */
/*  Type Guards                                                        */
/* ------------------------------------------------------------------ */

/**
 * Validates that a raw severity string is a known FindingSeverity.
 * @param value - The string to check.
 * @returns True if the value is a valid FindingSeverity.
 */
export function isFindingSeverity(value: string): value is FindingSeverity {
  return (
    value === "error" ||
    value === "warning" ||
    value === "info" ||
    value === "hint"
  );
}

/**
 * Validates that a raw confidence string is a known ConfidenceLevel.
 * @param value - The string to check.
 * @returns True if the value is a valid ConfidenceLevel.
 */
export function isConfidenceLevel(value: string): value is ConfidenceLevel {
  return value === "high" || value === "medium" || value === "low";
}

/**
 * Validates that a value looks like an LlmFinding (structural check).
 * @param value - The unknown value to validate.
 * @returns True if the value structurally matches LlmFinding.
 */
export function isLlmFinding(value: unknown): value is LlmFinding {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj["file"] === "string" &&
    typeof obj["line"] === "number" &&
    typeof obj["severity"] === "string" &&
    typeof obj["message"] === "string" &&
    typeof obj["category"] === "string" &&
    typeof obj["confidence"] === "string"
  );
}
