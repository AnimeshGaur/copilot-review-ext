/**
 * @module utils/diffParser
 *
 * Parses unified diff output into structured DiffFile[] arrays.
 */

import type { DiffFile } from "../engine/types.js";
import { detectLanguage } from "./languageDetector.js";

/**
 * Parses a unified diff string into an array of DiffFile objects.
 *
 * Handles the standard `diff --git a/path b/path` format.
 *
 * @param rawDiff - Raw unified diff text.
 * @returns Array of DiffFile objects.
 */
export function parseUnifiedDiff(rawDiff: string): DiffFile[] {
  const files: DiffFile[] = [];
  const diffSections = rawDiff
    .split(/^diff --git /m)
    .filter((s) => s.length > 0);

  for (const section of diffSections) {
    const lines = section.split("\n");
    const headerLine = lines[0];
    if (headerLine === undefined) {
      continue;
    }

    // Extract file path from "a/path b/path"
    const pathMatch = /b\/(.+)$/.exec(headerLine);
    if (pathMatch === null || pathMatch[1] === undefined) {
      continue;
    }

    const filePath = pathMatch[1];
    const language = detectLanguage(filePath);
    const content = lines.slice(1).join("\n");

    files.push({
      filePath,
      language,
      content,
      estimatedTokens: Math.max(1, Math.ceil(content.length / 4)),
    });
  }

  return files;
}
