import { describe, expect, it } from "vitest";
import { askModel } from "./client";
import { redactSensitive } from "./redact";
import { routeQuestionToTool, ENGINE_TOOLS } from "./tools";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAccountJson } from "@/engine/parse";
import { createQueryEngine } from "@/engine/queries";
import { answerQuestion } from "./ask";

describe("askModel", () => {
  it("falls back to canned responses when the provider fails", async () => {
    const result = await askModel({
      messages: [{ role: "user", content: "who can access production?" }],
      tools: ENGINE_TOOLS,
      provider: {
        async createChatCompletion() {
          throw new Error("network down");
        },
      },
    });
    expect(result.usedFallback).toBe(true);
    expect(result.message.role).toBe("assistant");
    expect(result.message.content).toMatch(/unavailable|fallback/i);
  });

  it("accepts a provider override for successful calls", async () => {
    const result = await askModel({
      messages: [{ role: "user", content: "hello" }],
      provider: {
        async createChatCompletion() {
          return {
            id: "x",
            object: "chat.completion",
            created: 0,
            model: "test",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                logprobs: null,
                message: {
                  role: "assistant",
                  content: "ok",
                  refusal: null,
                },
              },
            ],
          };
        },
      },
    });
    expect(result.usedFallback).toBe(false);
    expect(result.message.content).toBe("ok");
  });
});

describe("redactSensitive", () => {
  it("redacts emails, keys, and tokens and records them", () => {
    const { text, redactions } = redactSensitive(
      "mail priya@acme.io key sk-abc1234567890 token ghp_abcdefghijklmnopqrstuv",
    );
    expect(text).toContain("[REDACTED_EMAIL]");
    expect(text).toContain("[REDACTED_KEY]");
    expect(text).toContain("[REDACTED_TOKEN]");
    expect(redactions.length).toBe(3);
    expect(text).not.toContain("priya@acme.io");
  });
});

describe("answerQuestion pipeline", () => {
  it("returns toolCalled, args, citations without sending the policy file to the model", async () => {
    const raw = readFileSync(
      resolve(__dirname, "../../fixtures/acme-account.json"),
      "utf8",
    );
    const parsed = parseAccountJson(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const engine = createQueryEngine(parsed.data);
    let sawPolicyFile = false;

    const result = await answerQuestion(
      "How can u-dev-marco reach databases-for-postgresql/production?",
      engine,
      {
        provider: {
          async createChatCompletion(params) {
            const blob = JSON.stringify(params.messages);
            if (blob.includes('"account_id"') || blob.includes("pol-14")) {
              sawPolicyFile = true;
            }
            // First call with tools → emit pathsBetween
            if (params.tools?.length) {
              return {
                id: "t",
                object: "chat.completion",
                created: 0,
                model: "test",
                choices: [
                  {
                    index: 0,
                    finish_reason: "tool_calls",
                    logprobs: null,
                    message: {
                      role: "assistant",
                      content: null,
                      refusal: null,
                      tool_calls: [
                        {
                          id: "call_1",
                          type: "function",
                          function: {
                            name: "pathsBetween",
                            arguments: JSON.stringify({
                              subjectId: "u-dev-marco",
                              target: "databases-for-postgresql/production",
                            }),
                          },
                        },
                      ],
                    },
                  },
                ],
              };
            }
            // Phrasing call
            return {
              id: "p",
              object: "chat.completion",
              created: 0,
              model: "test",
              choices: [
                {
                  index: 0,
                  finish_reason: "stop",
                  logprobs: null,
                  message: {
                    role: "assistant",
                    content:
                      "Marco can reach production Postgres in 3 steps via iam-groups Editor.",
                    refusal: null,
                  },
                },
              ],
            };
          },
        },
      },
    );

    expect(sawPolicyFile).toBe(false);
    expect(result.toolCalled).toBe("pathsBetween");
    expect(result.args).toEqual({
      subjectId: "u-dev-marco",
      target: "databases-for-postgresql/production",
    });
    expect(result.answer).toMatch(/3 steps|iam-groups|Marco/i);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.confidence).toBe("high");
  });

  it("routes deterministically when the model returns no tool call", async () => {
    const routed = routeQuestionToTool(
      "How can u-dev-marco reach databases-for-postgresql/production?",
    );
    expect(routed.name).toBe("pathsBetween");
    expect(routed.args.subjectId).toBe("u-dev-marco");
  });
});
