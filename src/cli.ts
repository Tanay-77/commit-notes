#!/usr/bin/env node
import { Command } from "commander";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { saveConfig, getConfigPath, type Config } from "./config.js";

const program = new Command();

program
  .name("commit-notes")
  .description("Turn Git commits into structured Markdown study notes")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize .commit-notes.json configuration for the current repository")
  .action(async () => {
    const rl = readline.createInterface({ input, output });
    try {
      const rawVault = await rl.question("Enter Obsidian vault or notes directory path: ");
      const vaultPath = rawVault.trim();
      if (!vaultPath) {
        console.error("Error: vaultPath is required.");
        process.exitCode = 1;
        return;
      }

      const rawProvider = await rl.question("Choose provider (anthropic | gemini | openai) [gemini]: ");
      const providerInput = rawProvider.trim().toLowerCase();
      let provider: "anthropic" | "gemini" | "openai" = "gemini";
      if (providerInput === "anthropic" || providerInput === "openai") {
        provider = providerInput;
      }

      let defaultModel = "gemini-1.5-pro";
      if (provider === "anthropic") {
        defaultModel = "claude-3-5-sonnet-latest";
      } else if (provider === "openai") {
        defaultModel = "gpt-4o";
      }

      const config: Config = {
        vaultPath,
        provider,
        model: defaultModel,
        ignore: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
        maxDiffChars: 24000,
      };

      await saveConfig(config);
      console.log(`Configuration written to ${getConfigPath()}`);
    } catch (err: unknown) {
      console.error("Failed to initialize configuration:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    } finally {
      rl.close();
    }
  });

program
  .command("run")
  .description("Generate study notes for a specific commit (default: HEAD)")
  .argument("[sha]", "Commit SHA or ref to analyze", "HEAD")
  .action((sha: string) => {
    console.log(`[stub] Generating study notes for commit: ${sha}`);
  });

program
  .command("quiz")
  .description("Start an interactive review / quiz session from generated notes")
  .action(() => {
    console.log("[stub] Starting interactive review session...");
  });

program
  .command("explain")
  .description("Start an explain-back session for a commit")
  .argument("[sha]", "Commit SHA or ref to explain", "HEAD")
  .action((sha: string) => {
    console.log(`[stub] Starting explain-back session for commit: ${sha}`);
  });

program.parse(process.argv);
