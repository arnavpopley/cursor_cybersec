import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAccountJson } from "./parse";
import { buildGraph } from "./graph";
import { createQueryEngine, pathsBetween } from "./queries";

const fixturePath = resolve(__dirname, "../fixtures/acme-account.json");

function loadAcme() {
  const raw = readFileSync(fixturePath, "utf8");
  const parsed = parseAccountJson(raw);
  if (!parsed.ok) throw new Error("fixture failed to parse");
  return parsed.data;
}

describe("pathsBetween marco escalation", () => {
  it("returns a 3-step path through iam-groups and the Platform group", () => {
    const account = loadAcme();
    const graph = buildGraph(account);
    const paths = pathsBetween(
      graph,
      "u-dev-marco",
      "databases-for-postgresql/production",
    );

    expect(paths.length).toBeGreaterThan(0);

    const escalationPath = paths.find(
      (path) =>
        path.length === 3 &&
        path.some((s) => s.reason.toLowerCase().includes("iam-groups")) &&
        path.some((s) => s.reason.toLowerCase().includes("platform")) &&
        path.some((s) =>
          s.reason.toLowerCase().includes("databases-for-postgresql"),
        ),
    );

    expect(escalationPath).toBeDefined();
    if (!escalationPath) return;

    expect(escalationPath).toHaveLength(3);

    // Step 1: Editor on iam-groups (pol-12)
    expect(escalationPath[0]!.policy_id).toBe("pol-12");
    expect(escalationPath[0]!.reason.toLowerCase()).toContain("iam-groups");
    expect(escalationPath[0]!.line_start).toBeGreaterThan(0);
    expect(escalationPath[0]!.line_end).toBeGreaterThanOrEqual(
      escalationPath[0]!.line_start,
    );

    // Step 2: can add self to Platform
    expect(escalationPath[1]!.policy_id).toBe("pol-12");
    expect(escalationPath[1]!.reason.toLowerCase()).toMatch(
      /can add self.*platform/i,
    );

    // Step 3: Platform grant on production Postgres (pol-01)
    expect(escalationPath[2]!.policy_id).toBe("pol-01");
    expect(escalationPath[2]!.reason.toLowerCase()).toContain(
      "databases-for-postgresql",
    );
    expect(escalationPath[2]!.to).toBe(
      "target:databases-for-postgresql/production",
    );
  });

  it("exposes the same path via createQueryEngine", () => {
    const engine = createQueryEngine(loadAcme());
    const paths = engine.pathsBetween(
      "u-dev-marco",
      "databases-for-postgresql/production",
    );
    const hit = paths.find((p) => p.length === 3);
    expect(hit).toBeDefined();
  });
});
