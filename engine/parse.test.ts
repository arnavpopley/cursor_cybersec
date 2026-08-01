import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAccountJson } from "./parse";

const fixturePath = resolve(__dirname, "../fixtures/acme-account.json");

describe("parseAccountJson", () => {
  it("parses acme-account.json and cites pol-14 at its real file lines", () => {
    const raw = readFileSync(fixturePath, "utf8");
    const result = parseAccountJson(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const policy = result.data.policies.find((p) => p.id === "pol-14");
    expect(policy).toBeDefined();
    if (!policy) return;

    const lines = raw.split("\n");
    const idLineIdx = lines.findIndex((line) =>
      line.includes('"id": "pol-14"'),
    );
    expect(idLineIdx).toBeGreaterThan(0);

    let startIdx = idLineIdx;
    while (startIdx > 0 && !lines[startIdx].trim().startsWith("{")) {
      startIdx--;
    }

    let depth = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === "{") depth++;
        if (ch === "}") depth--;
      }
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }

    expect(policy.line_start).toBe(startIdx + 1);
    expect(policy.line_end).toBe(endIdx + 1);

    const slice = lines
      .slice(policy.line_start - 1, policy.line_end)
      .join("\n");
    expect(slice).toContain('"id": "pol-14"');
    expect(slice).not.toContain('"id": "pol-15"');
    expect(slice).not.toContain('"id": "pol-13"');
    // Hard check against the fixture layout.
    expect(policy.line_start).toBe(279);
    expect(policy.line_end).toBe(288);
  });

  it("returns structured errors with line numbers for invalid input", () => {
    const raw = `{
  "account_id": "acc-9f2",
  "subjects": "not-an-array"
}`;
    const result = parseAccountJson(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.line_start).toBeTypeOf("number");
  });

  it("returns a structured error for malformed JSON instead of throwing", () => {
    expect(() => parseAccountJson("{ not json")).not.toThrow();
    const result = parseAccountJson("{ not json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message.length).toBeGreaterThan(0);
  });
});
