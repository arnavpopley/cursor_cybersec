import type { PlatformRole, ServiceRole } from "./schema";

/**
 * Roles do NOT inherit. Administrator does not include Viewer.
 * Each role is an explicit action set; multiple roles are unioned.
 */
export const PLATFORM_ACTIONS: Record<PlatformRole, readonly string[]> = {
  Viewer: ["platform.view"],
  Operator: ["platform.operate"],
  Editor: ["platform.edit"],
  Administrator: ["platform.administer"],
};

export const SERVICE_ACTIONS: Record<ServiceRole, readonly string[]> = {
  Reader: ["service.read"],
  Writer: ["service.write"],
  Manager: ["service.manage"],
};

export function unionPlatformActions(roles: PlatformRole[]): string[] {
  const actions = new Set<string>();
  for (const role of roles) {
    for (const action of PLATFORM_ACTIONS[role]) actions.add(action);
  }
  return [...actions].sort();
}

export function unionServiceActions(roles: ServiceRole[]): string[] {
  const actions = new Set<string>();
  for (const role of roles) {
    for (const action of SERVICE_ACTIONS[role]) actions.add(action);
  }
  return [...actions].sort();
}

export function hasPlatformRole(
  roles: PlatformRole[],
  role: PlatformRole,
): boolean {
  return roles.includes(role);
}

export function hasServiceRole(
  roles: ServiceRole[],
  role: ServiceRole,
): boolean {
  return roles.includes(role);
}

/** True if minRole appears in either platform or service role lists. */
export function grantMeetsMinRole(
  platform: PlatformRole[],
  service: ServiceRole[],
  minRole?: string,
): boolean {
  if (!minRole) return true;
  return (
    platform.includes(minRole as PlatformRole) ||
    service.includes(minRole as ServiceRole)
  );
}
