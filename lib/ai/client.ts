import OpenAI from "openai";

export type AskModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
};

export type AskModelTool = OpenAI.Chat.Completions.ChatCompletionTool;

export type AskModelResult = {
  message: OpenAI.Chat.Completions.ChatCompletionMessage;
  raw: OpenAI.Chat.Completions.ChatCompletion;
};

/**
 * Single gateway for all OpenAI calls. Nothing else calls the API directly.
 */
export async function askModel(options: {
  messages: AskModelMessage[];
  tools?: AskModelTool[];
  tool_choice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
  model?: string;
  temperature?: number;
}): Promise<AskModelResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const client = new OpenAI({ apiKey });
  const raw = await client.chat.completions.create({
    model: options.model ?? "gpt-4o-mini",
    temperature: options.temperature ?? 0,
    messages: options.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    tools: options.tools,
    tool_choice: options.tool_choice,
  });

  const message = raw.choices[0]?.message;
  if (!message) {
    throw new Error("askModel received an empty completion");
  }

  return { message, raw };
}

export function hasOpenAI(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
