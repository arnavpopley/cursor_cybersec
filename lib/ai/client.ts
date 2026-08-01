import OpenAI from "openai";

export type AskModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
};

export type AskModelTool = OpenAI.Chat.Completions.ChatCompletionTool;

export type AskModelResult = {
  message: OpenAI.Chat.Completions.ChatCompletionMessage;
  raw: OpenAI.Chat.Completions.ChatCompletion | null;
  usedFallback: boolean;
};

export type AskModelProvider = {
  createChatCompletion: (params: {
    model: string;
    temperature: number;
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    tools?: AskModelTool[];
    tool_choice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
  }) => Promise<OpenAI.Chat.Completions.ChatCompletion>;
};

export type CannedResponseFactory = (input: {
  messages: AskModelMessage[];
  tools?: AskModelTool[];
  error?: unknown;
}) => AskModelResult;

function defaultOpenAIProvider(apiKey: string): AskModelProvider {
  const client = new OpenAI({ apiKey });
  return {
    async createChatCompletion(params) {
      return client.chat.completions.create(params);
    },
  };
}

function emptyCompletion(
  message: OpenAI.Chat.Completions.ChatCompletionMessage,
): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: "canned",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "canned",
    choices: [
      {
        index: 0,
        message,
        finish_reason: message.tool_calls?.length ? "tool_calls" : "stop",
        logprobs: null,
      },
    ],
    usage: undefined,
  };
}

/** Default canned reply when the live API is down — never throws. */
export function defaultCannedResponse(input: {
  messages: AskModelMessage[];
  tools?: AskModelTool[];
  error?: unknown;
}): AskModelResult {
  const lastUser = [...input.messages]
    .reverse()
    .find((m) => m.role === "user")?.content;

  // If we already have a tool result in the thread, phrase from it.
  const lastTool = [...input.messages]
    .reverse()
    .find((m) => m.role === "tool");
  if (lastTool?.content) {
    const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
      role: "assistant",
      content:
        "Based on the engine result (live model unavailable): see the structured tool output and citations. The engine—not the model—decided these permissions.",
      refusal: null,
    };
    return {
      message,
      raw: emptyCompletion(message),
      usedFallback: true,
    };
  }

  // Otherwise emit a generic tool call hint via canned text; the ask pipeline
  // will route deterministically if no tool_calls are present.
  const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
    role: "assistant",
    content: lastUser
      ? `Model unavailable. Falling back to the deterministic engine router for: "${lastUser.slice(0, 160)}"`
      : "Model unavailable. Falling back to the deterministic engine router.",
    refusal: null,
  };

  return {
    message,
    raw: emptyCompletion(message),
    usedFallback: true,
  };
}

/**
 * Single gateway for all OpenAI calls. Nothing else calls the API directly.
 * Accepts a provider override and falls back to canned responses on error so
 * a dead API cannot break the demo.
 */
export async function askModel(options: {
  messages: AskModelMessage[];
  tools?: AskModelTool[];
  tool_choice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
  model?: string;
  temperature?: number;
  provider?: AskModelProvider;
  canned?: CannedResponseFactory;
}): Promise<AskModelResult> {
  const canned = options.canned ?? defaultCannedResponse;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!options.provider && !apiKey) {
    return canned({
      messages: options.messages,
      tools: options.tools,
      error: new Error("OPENAI_API_KEY is not set"),
    });
  }

  try {
    const provider =
      options.provider ?? defaultOpenAIProvider(apiKey as string);
    const raw = await provider.createChatCompletion({
      model: options.model ?? "gpt-4o-mini",
      temperature: options.temperature ?? 0,
      messages:
        options.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools: options.tools,
      tool_choice: options.tool_choice,
    });

    const message = raw.choices[0]?.message;
    if (!message) {
      return canned({
        messages: options.messages,
        tools: options.tools,
        error: new Error("Empty completion"),
      });
    }

    return { message, raw, usedFallback: false };
  } catch (error) {
    return canned({
      messages: options.messages,
      tools: options.tools,
      error,
    });
  }
}

export function hasOpenAI(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
