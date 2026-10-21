import type { CommitFile } from "./git.js";

const DEFAULT_IGNORED_LOCKFILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
]);

const DEFAULT_IGNORED_DIRECTORIES = [
  "dist/",
  "build/",
  ".next/",
  "out/",
  "coverage/",
  "node_modules/",
];

const MINIFIED_AND_MAP_REGEX = /\.(min\.js|min\.css|map)$/i;

const BINARY_IMAGE_EXT_REGEX =
  /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff|pdf|zip|tar|gz|7z|rar|exe|dll|so|dylib|wasm|woff|woff2|ttf|eot|mp4|webm|mp3|wav|ogg)$/i;

export function globToRegex(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, "/").replace(/^\.\//, "");
  let regexStr = "";
  let i = 0;

  while (i < normalized.length) {
    const char = normalized[i];
    if (char === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          regexStr += "(?:.*\\/)?";
          i += 3;
          continue;
        } else {
          regexStr += ".*";
          i += 2;
          continue;
        }
      } else {
        regexStr += "[^/]*";
        i += 1;
        continue;
      }
    } else if (char === "?") {
      regexStr += "[^/]";
      i += 1;
      continue;
    } else if (/[.+^${}()|[\]\\]/.test(char)) {
      regexStr += "\\" + char;
      i += 1;
    } else {
      regexStr += char;
      i += 1;
    }
  }

  if (normalized.endsWith("/")) {
    return new RegExp(`^${regexStr}.*$`, "i");
  }

  if (!normalized.includes("/")) {
    return new RegExp(`(?:^|\\/)${regexStr}$`, "i");
  }

  return new RegExp(`^${regexStr}$`, "i");
}

export function matchesGlob(filePath: string, glob: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const rx = globToRegex(glob);
  return rx.test(normalized);
}

export function isBinaryOrGenerated(file: CommitFile): boolean {
  const normalizedPath = file.path.replace(/\\/g, "/");
  const baseName = normalizedPath.split("/").pop() || "";

  // 1. Lockfiles
  if (DEFAULT_IGNORED_LOCKFILES.has(baseName)) {
    return true;
  }

  // 2. Directories (dist/, build/, etc.)
  for (const dir of DEFAULT_IGNORED_DIRECTORIES) {
    if (normalizedPath.startsWith(dir) || normalizedPath.includes(`/${dir}`)) {
      return true;
    }
  }

  // 3. Minified files and source maps
  if (MINIFIED_AND_MAP_REGEX.test(baseName)) {
    return true;
  }

  // 4. Binary extensions and images
  if (BINARY_IMAGE_EXT_REGEX.test(baseName)) {
    return true;
  }

  // 5. Binary content markers in diff
  if (
    file.diff.includes("Binary files") ||
    file.diff.includes("GIT binary patch")
  ) {
    return true;
  }

  return false;
}

export function filterFiles(
  files: CommitFile[],
  ignoreGlobs: string[] = []
): CommitFile[] {
  return files.filter((file) => {
    // Exclude if empty diff or whitespace-only
    if (!file.diff || file.diff.trim().length === 0) {
      return false;
    }

    // Exclude if binary, lockfile, minified, etc.
    if (isBinaryOrGenerated(file)) {
      return false;
    }

    // Exclude if matches any custom ignore glob
    for (const pattern of ignoreGlobs) {
      if (matchesGlob(file.path, pattern)) {
        return false;
      }
    }

    return true;
  });
}

export function getFilePriority(filePath: string): number {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const base = normalized.split("/").pop() || "";
  const ext = base.includes(".") ? "." + base.split(".").pop() : "";

  // Priority 1: Core source code
  const sourceExts = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".rs", ".go", ".java", ".c", ".cpp", ".cc", ".h", ".hpp",
    ".cs", ".rb", ".php", ".swift", ".kt", ".kts", ".scala",
    ".vue", ".svelte", ".sql", ".sh", ".bash", ".zsh",
  ]);
  if (sourceExts.has(ext)) {
    return 1;
  }

  // Priority 2: Config and data
  const configExts = new Set([
    ".json", ".yaml", ".yml", ".toml", ".xml", ".ini",
  ]);
  const configNames = new Set(["dockerfile", "makefile", "cmakelists.txt"]);
  if (configExts.has(ext) || configNames.has(base) || base.startsWith(".env")) {
    return 2;
  }

  // Priority 3: Documentation and styles
  const docExts = new Set([
    ".md", ".markdown", ".rst", ".txt",
    ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ]);
  if (docExts.has(ext)) {
    return 3;
  }

  return 4;
}

function truncateSingleDiff(
  diff: string,
  targetMaxChars: number
): { diff: string; truncatedLines: number } {
  if (diff.length <= targetMaxChars) {
    return { diff, truncatedLines: 0 };
  }

  const lines = diff.split(/\r?\n/);
  const kept: string[] = [];
  let currentLen = 0;
  const allowed = Math.max(0, targetMaxChars - 35);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const addedLen = line.length + 1;
    if (currentLen + addedLen > allowed && kept.length > 0) {
      break;
    }
    kept.push(line);
    currentLen += addedLen;
  }

  const omitted = lines.length - kept.length;
  const marker = `\n... [truncated ${omitted} lines]`;
  return {
    diff: kept.length > 0 ? kept.join("\n") + marker : `[truncated ${omitted} lines]`,
    truncatedLines: omitted,
  };
}

export interface TruncateResult {
  files: CommitFile[];
  truncated: boolean;
}

export function truncate(
  files: CommitFile[],
  maxDiffChars: number = 24000
): TruncateResult {
  if (files.length === 0) {
    return { files: [], truncated: false };
  }

  // Sort files by relevance: source code (1) -> config (2) -> docs (3) -> other (4)
  const sorted = [...files].sort((a, b) => getFilePriority(a.path) - getFilePriority(b.path));

  const totalChars = sorted.reduce((sum, f) => sum + f.diff.length, 0);
  if (totalChars <= maxDiffChars) {
    return { files: sorted, truncated: false };
  }

  let remaining = maxDiffChars;
  // Per-file ceiling to ensure multiple large files share the budget fairly
  const perFileCap =
    sorted.length > 1
      ? Math.max(Math.floor((maxDiffChars / sorted.length) * 1.5), Math.floor(maxDiffChars * 0.5))
      : maxDiffChars;

  const resultFiles: CommitFile[] = [];

  for (const file of sorted) {
    if (remaining <= 40) {
      const lineCount = file.diff.split(/\r?\n/).length;
      resultFiles.push({
        path: file.path,
        diff: `[truncated ${lineCount} lines]`,
      });
      continue;
    }

    const fileLimit = Math.min(remaining, perFileCap);
    if (file.diff.length <= fileLimit) {
      resultFiles.push(file);
      remaining -= file.diff.length;
    } else {
      const truncatedRes = truncateSingleDiff(file.diff, fileLimit);
      resultFiles.push({
        path: file.path,
        diff: truncatedRes.diff,
      });
      remaining = Math.max(0, remaining - truncatedRes.diff.length);
    }
  }

  return {
    files: resultFiles,
    truncated: true,
  };
}

export const truncateDiffs = truncate;
