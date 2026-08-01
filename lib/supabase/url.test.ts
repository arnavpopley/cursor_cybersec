import { describe, expect, it } from "vitest";
import { normalizeSupabaseUrl } from "./client";

describe("normalizeSupabaseUrl", () => {
  it("keeps a clean project URL", () => {
    expect(
      normalizeSupabaseUrl("https://gonhjptdjrtfszmsqyjm.supabase.co"),
    ).toBe("https://gonhjptdjrtfszmsqyjm.supabase.co");
  });

  it("fixes glued https and multiline paste", () => {
    expect(
      normalizeSupabaseUrl("https://gonhjptdjrtfszmsqyjm.supabase.cohttps"),
    ).toBe("https://gonhjptdjrtfszmsqyjm.supabase.co");
    expect(
      normalizeSupabaseUrl("https://gonhjptdjrtfszmsqyjm.supabase.co\nhttps"),
    ).toBe("https://gonhjptdjrtfszmsqyjm.supabase.co");
    expect(
      normalizeSupabaseUrl("https://gonhjptdjrtfszmsqyjm.supabase.co/\n"),
    ).toBe("https://gonhjptdjrtfszmsqyjm.supabase.co");
  });
});
