export interface LLMProvider {
  complete(system: string, user: string): Promise<string>;
}

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  maxRetries?: number;
  baseDelayMs?: number;
}

export class GeminiProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(options: GeminiProviderOptions = {}) {
    const key = options.apiKey ?? process.env.GEMINI_API_KEY;
    if (!key || key.trim() === "") {
      throw new Error(
        "Missing GEMINI_API_KEY environment variable. Please set GEMINI_API_KEY in your environment or in a .env file."
      );
    }
    this.apiKey = key.trim();
    this.model = options.model ?? "gemini-1.5-pro";
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
  }

  async complete(system: string, user: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const payload = {
      system_instruction: {
        parts: [{ text: system }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: user }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            candidates?: Array<{
              content?: {
                parts?: Array<{ text?: string }>;
              };
            }>;
          };

          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) {
            throw new Error("Gemini returned an empty response with no content parts.");
          }
          return text;
        }

        const isRateLimit = response.status === 429 || response.status === 503;
        const errorText = await response.text();

        if (isRateLimit && attempt < this.maxRetries) {
          const delay = this.baseDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw new Error(`Gemini API error (${response.status}): ${errorText}`);
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Only retry network errors or rate limit errors
        if (attempt < this.maxRetries && (lastError.message.includes("429") || lastError.message.includes("503") || lastError.message.includes("fetch failed"))) {
          const delay = this.baseDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw lastError;
      }
    }

    throw lastError ?? new Error("Gemini API request failed after retries.");
  }
}

export function createLLMProvider(
  provider: "gemini" | "anthropic" | "openai" = "gemini",
  model?: string
): LLMProvider {
  if (provider === "gemini") {
    return new GeminiProvider({ model });
  }

  throw new Error(
    `Provider "${provider}" is not implemented yet. Currently active provider: "gemini".`
  );
}
