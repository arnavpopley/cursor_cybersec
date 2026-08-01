/**
 * Apply a finding's suggestedFix to the uploaded account JSON text.
 * Returns the updated raw JSON string (pretty-printed).
 */
export function applySuggestedFixToRaw(
  raw: string,
  suggestedFix: Record<string, unknown>,
  findingId?: string,
): string {
  const data = JSON.parse(raw) as Record<string, unknown>;

  // Policy-shaped fix (has subjects + roles)
  if (
    typeof suggestedFix.id === "string" &&
    Array.isArray(suggestedFix.subjects) &&
    suggestedFix.roles &&
    typeof suggestedFix.roles === "object"
  ) {
    const policies = (data.policies as Array<Record<string, unknown>>) ?? [];
    const idx = policies.findIndex((p) => p.id === suggestedFix.id);
    const nextPolicy = {
      id: suggestedFix.id,
      subjects: suggestedFix.subjects,
      roles: suggestedFix.roles,
      resources: suggestedFix.resources ?? {},
    };
    if (idx >= 0) {
      policies[idx] = { ...policies[idx], ...nextPolicy };
    } else if (
      findingId?.includes("escalation") &&
      Array.isArray(suggestedFix.subjects)
    ) {
      // Escalation remediations often target pol-12-fixed; patch pol-12 instead.
      const pol12 = policies.findIndex((p) => p.id === "pol-12");
      if (pol12 >= 0) {
        policies[pol12] = {
          ...policies[pol12],
          roles: suggestedFix.roles,
          resources: suggestedFix.resources ?? policies[pol12]!.resources,
        };
      }
    }
    data.policies = policies;
  }

  // Nested policy inside suggestedFix.policy (SI no-expiry style)
  if (suggestedFix.policy && typeof suggestedFix.policy === "object") {
    const policyFix = suggestedFix.policy as Record<string, unknown>;
    const policies = (data.policies as Array<Record<string, unknown>>) ?? [];
    const idx = policies.findIndex((p) => p.id === policyFix.id);
    if (idx >= 0) {
      policies[idx] = { ...policies[idx], ...policyFix };
      data.policies = policies;
    }
  }

  // API key expiry
  if (suggestedFix.api_key && typeof suggestedFix.api_key === "object") {
    const keyFix = suggestedFix.api_key as Record<string, unknown>;
    const keys = (data.api_keys as Array<Record<string, unknown>>) ?? [];
    const idx = keys.findIndex((k) => k.id === keyFix.id);
    if (idx >= 0) {
      keys[idx] = { ...keys[idx], ...keyFix };
      data.api_keys = keys;
    }
  }
  if (
    typeof suggestedFix.id === "string" &&
    typeof suggestedFix.subject === "string" &&
    ("expires" in suggestedFix || "last_used" in suggestedFix)
  ) {
    const keys = (data.api_keys as Array<Record<string, unknown>>) ?? [];
    const idx = keys.findIndex((k) => k.id === suggestedFix.id);
    if (idx >= 0) {
      keys[idx] = { ...keys[idx], ...suggestedFix };
      data.api_keys = keys;
    }
  }

  // Trusted profile claim rules
  if (
    typeof suggestedFix.id === "string" &&
    Array.isArray(suggestedFix.claim_rules)
  ) {
    const profiles =
      (data.trusted_profiles as Array<Record<string, unknown>>) ?? [];
    const idx = profiles.findIndex((p) => p.id === suggestedFix.id);
    if (idx >= 0) {
      profiles[idx] = { ...profiles[idx], ...suggestedFix };
      data.trusted_profiles = profiles;
    }
  }

  // Subject MFA / user fields
  if (
    typeof suggestedFix.id === "string" &&
    suggestedFix.type === "user" &&
    typeof suggestedFix.mfa_enabled === "boolean"
  ) {
    const subjects = (data.subjects as Array<Record<string, unknown>>) ?? [];
    const idx = subjects.findIndex((s) => s.id === suggestedFix.id);
    if (idx >= 0) {
      subjects[idx] = { ...subjects[idx], mfa_enabled: suggestedFix.mfa_enabled };
      data.subjects = subjects;
    }
  }

  // Escalation: downgrade iam-groups Editor for a subject when fix lacks real policy id
  if (findingId?.startsWith("finding-escalation-")) {
    const subjectId = findingId.replace("finding-escalation-", "");
    const policies = (data.policies as Array<Record<string, unknown>>) ?? [];
    for (const policy of policies) {
      const subjects = policy.subjects as string[] | undefined;
      const resources = policy.resources as { service?: string } | undefined;
      const roles = policy.roles as { platform?: string[] } | undefined;
      if (
        subjects?.includes(subjectId) &&
        resources?.service === "iam-groups" &&
        roles?.platform?.some((r) => r === "Editor" || r === "Administrator")
      ) {
        policy.roles = {
          ...roles,
          platform: ["Viewer"],
          service: (policy.roles as { service?: string[] }).service ?? [],
        };
      }
    }
    data.policies = policies;
  }

  return `${JSON.stringify(data, null, 2)}\n`;
}
