import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export interface CommitFile {
  path: string;
  diff: string;
}

export interface CommitData {
  sha: string;
  message: string;
  author: string;
  date: string;
  files: CommitFile[];
}

function cleanQuotedPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseGitDiff(patchOutput: string): CommitFile[] {
  if (!patchOutput || !patchOutput.trim()) {
    return [];
  }

  // Split on diff boundary at beginning of line
  const chunks = patchOutput.split(/(?=^diff --git )/m);
  const files: CommitFile[] = [];

  for (const chunk of chunks) {
    const trimmedChunk = chunk.trim();
    if (!trimmedChunk.startsWith("diff --git")) {
      continue;
    }

    const lines = trimmedChunk.split(/\r?\n/);
    let filePath = "";

    // 1. Look for '+++ b/<path>' (normal modified or added files)
    for (const line of lines) {
      if (line.startsWith("+++ b/") && line !== "+++ /dev/null") {
        filePath = cleanQuotedPath(line.substring(6));
        break;
      }
      if (line.startsWith("rename to ")) {
        filePath = cleanQuotedPath(line.substring(10));
        break;
      }
    }

    // 2. Look for '--- a/<path>' (deleted files)
    if (!filePath) {
      for (const line of lines) {
        if (line.startsWith("--- a/") && line !== "--- /dev/null") {
          filePath = cleanQuotedPath(line.substring(6));
          break;
        }
      }
    }

    // 3. Look for binary files line
    if (!filePath) {
      for (const line of lines) {
        const binMatch = line.match(/^Binary files (?:a\/(.+?)|\/dev\/null) and (?:b\/(.+?)|\/dev\/null) differ/);
        if (binMatch) {
          const rawTarget = binMatch[2] || binMatch[1];
          if (rawTarget) {
            filePath = cleanQuotedPath(rawTarget);
            break;
          }
        }
      }
    }

    // 4. Fallback to header: diff --git a/<path> b/<path>
    if (!filePath) {
      const header = lines[0] ?? "";
      const headerMatch = header.match(/^diff --git (?:"?a\/(.+?)"?|a\/(.+?)) (?:"?b\/(.+?)"?|b\/(.+?))$/);
      if (headerMatch) {
        const candidate = headerMatch[3] || headerMatch[4] || headerMatch[1] || headerMatch[2];
        if (candidate) {
          filePath = cleanQuotedPath(candidate);
        }
      }
    }

    if (filePath) {
      files.push({
        path: filePath.replace(/\\/g, "/"),
        diff: trimmedChunk,
      });
    }
  }

  return files;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFile("git", args, {
      cwd,
      windowsHide: true,
      maxBuffer: 50 * 1024 * 1024,
    });
    return stdout;
  } catch (err: unknown) {
    const error = err as Error & { stderr?: string };
    const stderr = (error.stderr || "").trim();

    if (
      /does not have any commits yet/i.test(stderr) ||
      /ambiguous argument 'HEAD'/i.test(stderr) ||
      /bad default revision 'HEAD'/i.test(stderr)
    ) {
      throw new Error("Repository has no commits.");
    }

    if (/not a git repository/i.test(stderr)) {
      throw new Error("Current directory is not a git repository.");
    }

    if (/bad object/i.test(stderr) || /unknown revision/i.test(stderr)) {
      const targetSha = args[args.length - 1] ?? "unknown";
      throw new Error(`Commit not found: ${targetSha}`);
    }

    throw new Error(stderr || error.message);
  }
}

export async function getCommit(
  sha: string = "HEAD",
  cwd: string = process.cwd()
): Promise<CommitData> {
  // 1. Fetch metadata with NUL delimiter
  const metaStdout = await runGit(
    ["show", "-s", "--format=%H%x00%an <%ae>%x00%aI%x00%B", sha],
    cwd
  );

  const parts = metaStdout.split("\0");
  const resolvedSha = parts[0]?.trim() || sha;
  const author = parts[1]?.trim() || "";
  const date = parts[2]?.trim() || "";
  const message = parts.slice(3).join("\0").replace(/\r\n/g, "\n").trim();

  // 2. Fetch patch with first-parent and -m support (handles merges, root commits, and regular commits)
  const patchStdout = await runGit(
    ["show", "--patch", "-m", "--first-parent", "--format=", sha],
    cwd
  );

  const files = parseGitDiff(patchStdout);

  return {
    sha: resolvedSha,
    message,
    author,
    date,
    files,
  };
}
