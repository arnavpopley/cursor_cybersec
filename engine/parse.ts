import jsonMap from "json-source-map";
import { accountFileSchema, type AccountFileInput } from "./schema";

export type LineRange = {
  line_start: number;
  line_end: number;
};

export type ParseError = {
  message: string;
  path?: string;
  line_start?: number;
  line_end?: number;
};

export type Subject = AccountFileInput["subjects"][number] & LineRange;
export type AccessGroup = AccountFileInput["access_groups"][number] & LineRange;
export type TrustedProfile =
  AccountFileInput["trusted_profiles"][number] & LineRange;
export type Policy = AccountFileInput["policies"][number] & LineRange;
export type ApiKey = AccountFileInput["api_keys"][number];

export type ParsedAccount = {
  account_id: string;
  subjects: Subject[];
  access_groups: AccessGroup[];
  trusted_profiles: TrustedProfile[];
  api_keys: ApiKey[];
  policies: Policy[];
};

export type ParseResult =
  | { ok: true; data: ParsedAccount }
  | { ok: false; errors: ParseError[] };

type PointerMap = ReturnType<typeof jsonMap.parse>["pointers"];

function toLineRange(
  pointers: PointerMap,
  pointer: string,
): LineRange | undefined {
  const loc = pointers[pointer];
  if (!loc?.value || !loc?.valueEnd) return undefined;
  return {
    line_start: loc.value.line + 1,
    line_end: loc.valueEnd.line + 1,
  };
}

function requireLineRange(
  pointers: PointerMap,
  pointer: string,
): LineRange {
  const range = toLineRange(pointers, pointer);
  if (!range) {
    return { line_start: 1, line_end: 1 };
  }
  return range;
}

function lineFromOffset(raw: string, offset: number): number {
  if (offset <= 0) return 1;
  let line = 1;
  const end = Math.min(offset, raw.length);
  for (let i = 0; i < end; i++) {
    if (raw[i] === "\n") line++;
  }
  return line;
}

function syntaxErrorToParseError(raw: string, err: unknown): ParseError {
  const message = err instanceof Error ? err.message : "Invalid JSON";
  const positionMatch = message.match(/position\s+(\d+)/i);
  if (positionMatch) {
    const line = lineFromOffset(raw, Number(positionMatch[1]));
    return { message, line_start: line, line_end: line };
  }
  const lineMatch = message.match(/line\s+(\d+)/i);
  if (lineMatch) {
    const line = Number(lineMatch[1]);
    return { message, line_start: line, line_end: line };
  }
  return { message };
}

function pathToPointer(path: PropertyKey[]): string {
  if (path.length === 0) return "";
  return (
    "/" +
    path
      .map((segment) =>
        String(segment).replace(/~/g, "~0").replace(/\//g, "~1"),
      )
      .join("/")
  );
}

function zodIssuesToErrors(
  issues: { message: string; path: PropertyKey[] }[],
  pointers: PointerMap,
): ParseError[] {
  return issues.map((issue) => {
    const pointer = pathToPointer(issue.path);
    const range =
      toLineRange(pointers, pointer) ??
      (issue.path.length > 0
        ? toLineRange(pointers, pathToPointer(issue.path.slice(0, -1)))
        : undefined);

    return {
      message: issue.message,
      path: pointer || "/",
      line_start: range?.line_start,
      line_end: range?.line_end,
    };
  });
}

function attachLineRanges(
  data: AccountFileInput,
  pointers: PointerMap,
): ParsedAccount {
  return {
    account_id: data.account_id,
    subjects: data.subjects.map((subject, index) => ({
      ...subject,
      ...requireLineRange(pointers, `/subjects/${index}`),
    })),
    access_groups: data.access_groups.map((group, index) => ({
      ...group,
      ...requireLineRange(pointers, `/access_groups/${index}`),
    })),
    trusted_profiles: data.trusted_profiles.map((profile, index) => ({
      ...profile,
      ...requireLineRange(pointers, `/trusted_profiles/${index}`),
    })),
    api_keys: data.api_keys,
    policies: data.policies.map((policy, index) => ({
      ...policy,
      ...requireLineRange(pointers, `/policies/${index}`),
    })),
  };
}

/**
 * Parse an uploaded IAM account JSON string.
 * Never throws — invalid input returns structured errors with line numbers.
 */
export function parseAccountJson(raw: string): ParseResult {
  try {
    let parsed: ReturnType<typeof jsonMap.parse>;
    try {
      parsed = jsonMap.parse(raw);
    } catch (err) {
      return { ok: false, errors: [syntaxErrorToParseError(raw, err)] };
    }

    const validation = accountFileSchema.safeParse(parsed.data);
    if (!validation.success) {
      return {
        ok: false,
        errors: zodIssuesToErrors(validation.error.issues, parsed.pointers),
      };
    }

    return {
      ok: true,
      data: attachLineRanges(validation.data, parsed.pointers),
    };
  } catch (err) {
    return {
      ok: false,
      errors: [
        {
          message:
            err instanceof Error
              ? err.message
              : "Unexpected error while parsing account JSON",
        },
      ],
    };
  }
}
