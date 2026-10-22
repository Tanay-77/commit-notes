import { z } from "zod";
import type { CommitData } from "./git.js";
import { type LLMProvider, createLLMProvider } from "./llm.js";
import { ANALYZE_SYSTEM_PROMPT } from "./prompts/analyze.js";

export const ConceptSchema = z
  .object({
    name: z.string().min(1, "Concept name is required"),
    file: z.string().min(1, "File path is required"),
    codeSnippet: z.string().default(""),
    existing: z.boolean(),
    explanation: z.string().optional(),
    difficulty: z.enum(["basic", "intermediate", "advanced"]).optional(),
    interviewQuestion: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.existing) {
      if (!data.explanation || data.explanation.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "explanation is required when existing is false",
          path: ["explanation"],
        });
      }
      if (!data.difficulty) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "difficulty is required when existing is false",
          path: ["difficulty"],
        });
      }
      if (!data.interviewQuestion || data.interviewQuestion.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "interviewQuestion is required when existing is false",
          path: ["interviewQuestion"],
        });
      }
    }
  });

export const CommitAnalysisSchema = z.object({
  summary: z.string().min(1, "Summary is required"),
  concepts: z
    .array(ConceptSchema)
    .max(6, "At most 6 concepts are allowed per commit")
    .refine(
      (concepts) => {
        const names = concepts.map((c) => c.name.toLowerCase().trim());
        return new Set(names).size === names.length;
      },
      {
        message: "Duplicate concept names in the same commit are not allowed",
        path: [],
      }
    ),
});

export type Concept = z.infer<typeof ConceptSchema>;
export type CommitAnalysis = z.infer<typeof CommitAnalysisSchema>;

export function stripCodeFences(raw: string): string {
  let cleaned = raw.trim();

  // Strip markdown code fences ```json ... ``` or ``` ... ```
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\r?\n?/, "");
    cleaned = cleaned.replace(/\r?\n?```\s*$/, "");
  }

  // If there is preamble or postamble, extract between first { and last }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned.trim();
}

export function buildAnalysisUserPrompt(
  commit: CommitData,
  knownConcepts: string[]
): string {
  // If knownConcepts has > 200 items, take the 200 most recent
  const recentConcepts =
    knownConcepts.length > 200 ? knownConcepts.slice(-200) : knownConcepts;

  const filesSection = commit.files
    .map((f) => `### File: ${f.path}\n\`\`\`diff\n${f.diff}\n\`\`\``)
    .join("\n\n");

  return [
    `Commit SHA: ${commit.sha}`,
    `Author: ${commit.author}`,
    `Date: ${commit.date}`,
    `Commit Message: ${commit.message}`,
    "",
    `Known existing concepts in vault (${recentConcepts.length}):`,
    recentConcepts.length > 0
      ? JSON.stringify(recentConcepts, null, 2)
      : "None (this is a fresh vault).",
    "",
    "Commit Diffs to Analyze:",
    filesSection || "(No changes in diff)",
  ].join("\n");
}

function parseAndValidate(rawResponse: string): CommitAnalysis {
  const cleaned = stripCodeFences(rawResponse);
  const parsedJson: unknown = JSON.parse(cleaned);
  return CommitAnalysisSchema.parse(parsedJson);
}

export async function analyzeCommit(
  commit: CommitData,
  knownConcepts: string[] = [],
  provider?: LLMProvider
): Promise<CommitAnalysis> {
  const llm = provider ?? createLLMProvider();
  const userPrompt = buildAnalysisUserPrompt(commit, knownConcepts);

  let rawResponse = await llm.complete(ANALYZE_SYSTEM_PROMPT, userPrompt);

  try {
    return parseAndValidate(rawResponse);
  } catch (firstErr: unknown) {
    // Retry once with validation error included
    const errorMsg =
      firstErr instanceof Error ? firstErr.message : String(firstErr);

    const retryPrompt = [
      userPrompt,
      "",
      "CRITICAL: Your previous response was invalid. Please fix the error and output valid JSON matching the schema.",
      `Validation Error: ${errorMsg}`,
      "",
      "Your previous output was:",
      rawResponse,
    ].join("\n");

    rawResponse = await llm.complete(ANALYZE_SYSTEM_PROMPT, retryPrompt);
    return parseAndValidate(rawResponse);
  }
}
