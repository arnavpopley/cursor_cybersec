import { z } from "zod";

export const platformRoleSchema = z.enum([
  "Viewer",
  "Operator",
  "Editor",
  "Administrator",
]);

export const serviceRoleSchema = z.enum(["Reader", "Writer", "Manager"]);

export const subjectSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("user"),
    name: z.string().min(1),
    email: z.string().min(1),
    mfa_enabled: z.boolean(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("serviceId"),
    name: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("trustedProfile"),
    name: z.string().min(1),
  }),
]);

export const accessGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  members: z.array(z.string().min(1)),
});

export const claimConditionSchema = z.object({
  claim: z.string().min(1),
  operator: z.string().min(1),
  value: z.string(),
});

export const claimRuleSchema = z.object({
  issuer: z.string().min(1),
  conditions: z.array(claimConditionSchema),
});

export const trustedProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  claim_rules: z.array(claimRuleSchema),
});

export const apiKeySchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  created: z.string().min(1),
  last_used: z.string().nullable(),
  expires: z.string().nullable(),
});

export const rolesSchema = z.object({
  platform: z.array(platformRoleSchema),
  service: z.array(serviceRoleSchema),
});

export const resourcesSchema = z.object({
  service: z.string().min(1).optional(),
  resourceGroup: z.string().min(1).nullable().optional(),
  instanceId: z.string().min(1).nullable().optional(),
});

export const policySchema = z.object({
  id: z.string().min(1),
  subjects: z.array(z.string().min(1)).min(1),
  roles: rolesSchema,
  resources: resourcesSchema,
});

export const accountFileSchema = z.object({
  account_id: z.string().min(1),
  subjects: z.array(subjectSchema),
  access_groups: z.array(accessGroupSchema),
  trusted_profiles: z.array(trustedProfileSchema),
  api_keys: z.array(apiKeySchema),
  policies: z.array(policySchema),
});

export type AccountFileInput = z.infer<typeof accountFileSchema>;
export type PlatformRole = z.infer<typeof platformRoleSchema>;
export type ServiceRole = z.infer<typeof serviceRoleSchema>;
