# commit-notes

`commit-notes` is an engineer's companion CLI tool that transforms Git commits into structured Obsidian Markdown study notes and interactive spaced-repetition quizzes. By analyzing git diffs with LLMs (Google Gemini, Anthropic Claude, or OpenAI), it extracts architectural decisions, rationale, trade-offs, and self-test prompts, helping developers retain and articulate the technical context behind their daily code changes.

## Quickstart for Cloned Repositories

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure API Keys**:
   Copy the example environment file and add your API key:
   ```bash
   # Windows (PowerShell / CMD)
   copy .env.example .env

   # macOS / Linux
   cp .env.example .env
   ```
   Open `.env` and fill in `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY`.

3. **Initialize the tool in your repository**:
   ```bash
   npm run dev -- init
   ```
