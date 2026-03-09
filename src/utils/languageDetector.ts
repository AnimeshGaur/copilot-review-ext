/**
 * @module utils/languageDetector
 *
 * Detects programming languages based on file extensions.
 */

const LANGUAGE_MAP: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  jsx: "javascriptreact",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  cs: "csharp",
  cpp: "cpp",
  c: "c",
  h: "c",
  hpp: "cpp",
  swift: "swift",
  md: "markdown",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  html: "html",
  css: "css",
  scss: "scss",
  less: "less",
  sql: "sql",
  sh: "shellscript",
  bash: "shellscript",
  dockerfile: "dockerfile",
  vue: "vue",
  svelte: "svelte",
  dart: "dart",
  php: "php",
  lua: "lua",
  r: "r",
  scala: "scala",
};

/**
 * Detects programming language from a file extension.
 *
 * @param filePath - Path of the file.
 * @returns Language identifier string.
 */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_MAP[ext] ?? "plaintext";
}
