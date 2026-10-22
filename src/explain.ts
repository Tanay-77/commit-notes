import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { z } from "zod";
import type { CommitData } from "./git.js";
import { getCommit } from "./git.js";
import { filterFiles, truncate } from "./filter.js";
import { loadConfig, type Config } from "./config.js";
import { createLLMProvider, type LLMProvider } from "./llm.js";
import { stripCodeFences } from "./analyze.js";
import { GRADE_SYSTEM_PROMPT } from "./prompts/grade.js";

export const GradeSchema = z.object({
  score: z.number().int().min(0).max(5),
  whatIGotRight: z.array(z.string()),
  whatIMissed: z.array(z.string()),
  misconceptions: z.array(z.string()),
  followUpQuestion: z.string().min(1, "followUpQuestion is required"),
});

export type GradeResult = z.infer<typeof GradeSchema>;

export interface UsageRecord {
  date: string;
  command: string;
}

export interface ConceptProgress {
  concept: string;
  scores: number[];
  dates: string[];
}

export async function trackUsage(
  vaultPath: string,
  commandName: string
): Promise<void> {
  const filePath = path.join(vaultPath, "usage.json");
  let history: UsageRecord[] = [];

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      history = parsed;
    }
  } catch {
    history = [];
  }

  history.push({
    date: new Date().toISOString(),
    command: commandName,
  });

  await fs.mkdir(vaultPath, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(history, null, 2) + "\n", "utf-8");
}

export async function updateProgress(
  vaultPath: string,
  concepts: string[],
  score: number,
  dateStr: string = new Date().toISOString().slice(0, 10)
): Promise<void> {
  const filePath = path.join(vaultPath, "progress.json");
  let progressList: ConceptProgress[] = [];

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      progressList = parsed;
    }
  } catch {
    progressList = [];
  }

  const targets = concepts.length > 0 ? concepts : ["General Commit Comprehension"];

  for (const conceptName of targets) {
    const existing = progressList.find(
      (p) => p.concept.toLowerCase() === conceptName.toLowerCase()
    );
    if (existing) {
      existing.scores.push(score);
      existing.dates.push(dateStr);
    } else {
      progressList.push({
        concept: conceptName,
        scores: [score],
        dates: [dateStr],
      });
    }
  }

  await fs.mkdir(vaultPath, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(progressList, null, 2) + "\n", "utf-8");
}

export async function getConceptsForCommit(
  vaultPath: string,
  dateStr: string,
  shortSha: string
): Promise<string[]> {
  const commitNoteFile = path.join(vaultPath, "commits", `${dateStr}-${shortSha}.md`);
  try {
    const content = await fs.readFile(commitNoteFile, "utf-8");
    const conceptsSection = content.split("## Concepts")[1];
    if (!conceptsSection) return [];

    const lines = conceptsSection.split(/\r?\n/);
    const names: string[] = [];
    for (const line of lines) {
      const match = line.match(/- \[\[(?:.*?\|)?(.*?)\]\]/);
      if (match && match[1]) {
        names.push(match[1].trim());
      }
    }
    return names;
  } catch {
    return [];
  }
}

export function buildGradeUserPrompt(
  commit: CommitData,
  userExplanation: string
): string {
  const fileLines = commit.files.map((f) => `- ${f.path}`).join("\n");
  const diffs = commit.files
    .map((f) => `### File: ${f.path}\n\`\`\`diff\n${f.diff}\n\`\`\``)
    .join("\n\n");

  return [
    `Commit: ${commit.sha.slice(0, 7)} - ${commit.message.split("\n")[0]}`,
    `Author: ${commit.author}`,
    `Date: ${commit.date}`,
    "",
    "Files Changed in this commit:",
    fileLines || "(No changed files)",
    "",
    "Commit Diff:",
    diffs || "(No diff available)",
    "",
    "=== DEVELOPER'S EXPLANATION ===",
    userExplanation,
    "=== END DEVELOPER'S EXPLANATION ===",
  ].join("\n");
}

export async function gradeExplanation(
  commit: CommitData,
  userExplanation: string,
  provider: LLMProvider
): Promise<GradeResult> {
  const userPrompt = buildGradeUserPrompt(commit, userExplanation);
  let rawResponse = await provider.complete(GRADE_SYSTEM_PROMPT, userPrompt);

  try {
    const cleaned = stripCodeFences(rawResponse);
    return GradeSchema.parse(JSON.parse(cleaned));
  } catch (firstErr: unknown) {
    const errorMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const retryPrompt = [
      userPrompt,
      "",
      "CRITICAL: Your previous response was invalid. Output ONLY valid JSON matching the schema.",
      `Validation Error: ${errorMsg}`,
    ].join("\n");

    rawResponse = await provider.complete(GRADE_SYSTEM_PROMPT, retryPrompt);
    const cleaned = stripCodeFences(rawResponse);
    return GradeSchema.parse(JSON.parse(cleaned));
  }
}

export function formatSessionMarkdown(
  commit: CommitData,
  userExplanation: string,
  grade: GradeResult,
  followUpAnswer: string
): string {
  const shortSha = commit.sha.slice(0, 7);
  const dateStr = commit.date
    ? commit.date.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const rightList =
    grade.whatIGotRight.length > 0
      ? grade.whatIGotRight.map((p) => `- ${p}`).join("\n")
      : "- None noted";

  const missedList =
    grade.whatIMissed.length > 0
      ? grade.whatIMissed.map((p) => `- ${p}`).join("\n")
      : "- None noted";

  const misconceptionsList =
    grade.misconceptions.length > 0
      ? grade.misconceptions.map((p) => `- ${p}`).join("\n")
      : "- None noted";

  return `---
sha: ${commit.sha}
date: ${dateStr}
score: ${grade.score}/5
---
# Explain Session: ${shortSha}

## Commit
- **Message:** ${commit.message.split("\n")[0]}
- **Author:** ${commit.author}
- **Date:** ${commit.date}

## Your Explanation
${userExplanation}

## Grader Feedback (Score: ${grade.score}/5)

### What You Got Right
${rightList}

### What You Missed
${missedList}

### Misconceptions
${misconceptionsList}

## Follow-up Question
**Question:** ${grade.followUpQuestion}

**Your Follow-up Answer:**
${followUpAnswer || "(No follow-up answer provided)"}
`;
}

export async function readMultiLineFromTerminal(promptText: string): Promise<string> {
  console.log(promptText);
  console.log("(Type your answer below. Hit Enter on an empty line when finished:)\n");

  const rl = readline.createInterface({ input, output });
  const lines: string[] = [];

  try {
    for await (const line of rl) {
      if (line.trim() === "" && lines.length > 0) {
        break;
      }
      lines.push(line);
    }
  } finally {
    rl.close();
  }

  return lines.join("\n").trim();
}

export async function readSingleLineFromTerminal(promptText: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(promptText);
    return answer.trim();
  } finally {
    rl.close();
  }
}

export interface ExplainSessionOptions {
  commit?: CommitData;
  config?: Config;
  provider?: LLMProvider;
  readExplanation?: (prompt: string) => Promise<string>;
  readFollowUp?: (prompt: string) => Promise<string>;
}

export async function runExplainSession(
  sha: string = "HEAD",
  repoRoot: string = process.cwd(),
  options: ExplainSessionOptions = {}
): Promise<void> {
  const config = options.config ?? (await loadConfig(repoRoot));
  const commit = options.commit ?? (await getCommit(sha, repoRoot));

  // 1. Show commit message and list of changed files (NOT the explanation)
  const shortSha = commit.sha.slice(0, 7);
  const dateStr = commit.date
    ? commit.date.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  console.log(`\n=== Explain-Back Mode: Commit ${shortSha} ===`);
  console.log(`Message: ${commit.message.split("\n")[0]}`);
  console.log(`Author:  ${commit.author}`);
  console.log(`Date:    ${commit.date}`);
  console.log("\nChanged Files:");
  for (const f of commit.files) {
    console.log(`  - ${f.path}`);
  }
  console.log("");

  // 2. Ask user for their explanation
  const promptMessage = 'In your own words, what does this commit do and why?';
  const readExplanationFn = options.readExplanation ?? readMultiLineFromTerminal;
  const userExplanation = await readExplanationFn(promptMessage);

  if (!userExplanation) {
    console.log("No explanation provided. Exiting explain session.");
    return;
  }

  // Filter & truncate diff
  const filtered = filterFiles(commit.files, config.ignore);
  const { files: truncatedFiles } = truncate(filtered, config.maxDiffChars);
  const commitForGrading: CommitData = {
    ...commit,
    files: truncatedFiles,
  };

  // 3. Send to LLM for grading
  console.log("\nGrading your explanation against the diff...");
  const provider = options.provider ?? createLLMProvider(config.provider, config.model);
  const grade = await gradeExplanation(commitForGrading, userExplanation, provider);

  // 4. Print feedback clearly
  console.log("\n==========================================");
  console.log(`GRADE: ${grade.score} / 5`);
  console.log("==========================================");

  console.log("\nWhat You Got Right:");
  for (const item of grade.whatIGotRight) {
    console.log(`  [+] ${item}`);
  }

  console.log("\nWhat You Missed:");
  for (const item of grade.whatIMissed) {
    console.log(`  [-] ${item}`);
  }

  if (grade.misconceptions.length > 0) {
    console.log("\nMisconceptions to Clarify:");
    for (const item of grade.misconceptions) {
      console.log(`  [!] ${item}`);
    }
  }

  // Ask follow-up question
  console.log("\n==========================================");
  console.log(`Follow-up Question: ${grade.followUpQuestion}`);
  console.log("==========================================");

  const readFollowUpFn = options.readFollowUp ?? readSingleLineFromTerminal;
  const followUpAnswer = await readFollowUpFn("Your answer: ");

  // 5. Save session markdown
  const sessionsDir = path.join(config.vaultPath, "explain-sessions");
  await fs.mkdir(sessionsDir, { recursive: true });

  const sessionFilePath = path.join(sessionsDir, `${dateStr}-${shortSha}.md`);
  const sessionContent = formatSessionMarkdown(
    commit,
    userExplanation,
    grade,
    followUpAnswer
  );
  await fs.writeFile(sessionFilePath, sessionContent, "utf-8");

  // 6. Record progress score per concept
  const concepts = await getConceptsForCommit(config.vaultPath, dateStr, shortSha);
  await updateProgress(config.vaultPath, concepts, grade.score, dateStr);

  // 7. Track usage in usage.json
  await trackUsage(config.vaultPath, "explain");

  console.log(`\nSession saved to "${sessionFilePath}"`);
  console.log(`Concept progress updated in "${path.join(config.vaultPath, "progress.json")}"`);
}
