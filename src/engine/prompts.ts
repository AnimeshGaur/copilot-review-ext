/**
 * @module engine/prompts
 *
 * Anti-hallucination prompt layer for the Copilot Code Review extension.
 *
 * Purpose: Constructs versioned system prompts that enforce closed-world
 * assumptions, symbol grounding, confidence scoring, and no-speculation
 * rules. Builds dynamic user prompts that inject batch content, repo
 * metadata, and batch position context.
 *
 * Inputs: ReviewBatch (from contextWindowManager)
 * Outputs: System prompt string, user prompt string
 * Dependencies: engine/types
 */

import type { IPromptBuilder, ReviewBatch } from "./types.js";

/**
 * Versioned system prompt enforcing anti-hallucination rules.
 *
 * Rules enforced:
 * - Closed-world assumption: only analyze what is present
 * - Symbol grounding: every finding must reference exact file + line
 * - Confidence scoring: high | medium | low per finding
 * - Low-confidence suppression: flagged separately
 * - No speculative findings: requires_context instead of guessing
 */
const SYSTEM_PROMPT_V1 = `You are a principal-level code reviewer. Your task is to analyze the provided code diff and return a structured JSON response containing review findings.

## ABSOLUTE RULES — VIOLATIONS WILL INVALIDATE YOUR RESPONSE

### Closed-World Assumption
- Only analyze code that is EXPLICITLY present in the provided diff below.
- Do NOT infer behavior from code that is not shown.
- Do NOT assume what surrounding code, imports, or dependencies do.
- Do NOT reference files, functions, classes, or variables that are not in the provided input.

### Symbol Grounding
- Every finding MUST reference an EXACT file path present in the input.
- Every finding MUST reference an EXACT line number present in the input.
- If you cannot identify both file and line, DO NOT produce the finding.
- NEVER fabricate or estimate line numbers.

### Confidence Scoring
- Every finding MUST include a "confidence" field: "high", "medium", or "low".
- "high": The issue is clearly present and verifiable in the diff.
- "medium": The issue is likely but depends on minor context.
- "low": The issue is possible but cannot be confirmed from the diff alone.

### No Speculation
- If you cannot determine the impact of a code change without seeing broader context, set "requires_context": true and DO NOT guess.
- NEVER assume runtime behavior, external API contracts, or configuration state.
- NEVER invent hypothetical scenarios.

### Output Format
You MUST return ONLY valid JSON matching this exact schema — no prose, no markdown, no explanation outside the JSON:

\`\`\`json
{
  "findings": [
    {
      "file": "exact/path/from/input.ts",
      "line": 42,
      "endLine": 45,
      "severity": "error" | "warning" | "info" | "hint",
      "message": "Concise description of the issue",
      "category": "bug" | "security" | "performance" | "style" | "maintainability" | "correctness",
      "confidence": "high" | "medium" | "low",
      "suggestion": "Optional: concrete fix suggestion",
      "requires_context": false
    }
  ]
}
\`\`\`

### Severity Definitions
- "error": Definite bug, crash, data loss, or security vulnerability.
- "warning": Likely bug, performance issue, or significant code smell.
- "info": Style improvement, readability, or minor optimization.
- "hint": Nitpick or optional improvement.

### Forbidden Behaviors
- NEVER produce markdown, prose, or conversational text — only JSON.
- NEVER fabricate line numbers or file paths.
- NEVER reference files that are not in the provided diff.
- NEVER infer runtime behavior from missing code.
- NEVER produce findings for code that has been deleted (lines prefixed with "-" in diffs).
- NEVER guess at type signatures, return values, or side effects.

If the diff contains no issues, return: { "findings": [] }`;

/**
 * PromptBuilder constructs system and user prompts for LLM calls.
 *
 * The system prompt is a versioned constant enforcing anti-hallucination
 * rules. The user prompt is dynamically constructed from the batch
 * content and metadata.
 *
 * @example
 * ```ts
 * const builder = new PromptBuilder();
 * const system = builder.buildSystemPrompt();
 * const user = builder.buildUserPrompt(batch);
 * ```
 */
export class PromptBuilder implements IPromptBuilder {
  /**
   * Returns the versioned system prompt string.
   * @returns The anti-hallucination system prompt (SYSTEM_PROMPT_V1).
   */
  public buildSystemPrompt(): string {
    return SYSTEM_PROMPT_V1;
  }

  /**
   * Constructs a user prompt by injecting batch content, repo metadata,
   * and batch position context.
   *
   * @param batch - The review batch containing files, metadata, and position info.
   * @returns Formatted user prompt string for the LLM.
   */
  public buildUserPrompt(batch: ReviewBatch): string {
    const sections: string[] = [];

    // Batch position context
    sections.push(
      `## Batch ${batch.batchIndex + 1} of ${batch.totalBatches} (estimated ${batch.estimatedTokens} tokens)`,
    );

    // Repository metadata header
    if (batch.metaHeader.length > 0) {
      sections.push(`## Repository Context\n${batch.metaHeader}`);
    }

    // File diffs
    sections.push("## Files to Review");

    for (const file of batch.files) {
      sections.push(
        `### File: ${file.filePath} [${file.language}]\n\`\`\`${file.language}\n${file.content}\n\`\`\``,
      );
    }

    // Reminder of output contract
    sections.push(
      "## REMINDER: Return ONLY valid JSON matching the schema in your system instructions. No prose, no markdown wrapping.",
    );

    return sections.join("\n\n");
  }
}
