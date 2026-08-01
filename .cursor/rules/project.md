# Project: Keyring

A cloud permissions analysis tool with physical approval for privileged access.
Built in one day for a hackathon. Optimise for a working demo, not production.

## What it does

1. User uploads cloud IAM policy files (JSON).
2. A deterministic engine builds a graph of who can reach what, including
   indirect privilege escalation routes.
3. User asks questions in plain English and gets answers with citations to
   exact line numbers in the uploaded file.
4. A findings list ranks real misconfigurations by severity with suggested fixes.
5. Standing admin access is replaced by time limited grants that require a
   physical NFC tap to activate and expire automatically.

## Non-negotiable architecture rule

The LLM NEVER computes permissions.

A deterministic TypeScript engine answers all permission questions. The LLM has
exactly three jobs:
- translate an English question into a call to one of the engine's fixed query
  functions (via OpenAI function calling)
- phrase the engine's structured answer in readable English
- draft a corrected policy for a finding

If the LLM is ever asked to decide whether someone has access, that is a bug.
Every answer shown to the user must trace back to engine output and cite line
numbers from the uploaded file.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind + shadcn/ui
- Supabase (Postgres, Realtime, Auth)
- OpenAI (function calling only)
- ElevenLabs conversational agent (voice approval channel)
- NTAG NFC tags encoding a URL

Do not add Overmind, Ossprey, Modal, or any other integration.

## Domain model (IBM Cloud IAM shaped)

A policy grants a SUBJECT a set of ROLES over a TARGET.

- Subject: user | serviceId | trustedProfile | accessGroup
- Roles: platform roles (Viewer, Operator, Editor, Administrator) and service
  roles (Reader, Writer, Manager)
- Target: attributes narrowing scope. Missing attributes mean broader scope.
  A policy with no resource attributes applies to the whole account.

Critical quirk to model correctly: roles do NOT inherit. Administrator does not
include what Viewer can do. Many real actions require a platform role AND a
service role together. Model roles as sets of actions and union them.

Access groups can contain users, service IDs and trusted profiles. A subject's
effective access is the union of its direct policies and the policies of every
group it belongs to.

## Input file format

```json
{
  "account_id": "acc-9f2",
  "subjects": [
    { "id": "u-priya", "type": "user", "name": "Priya Raman",
      "email": "priya@example.com", "mfa_enabled": true }
  ],
  "access_groups": [
    { "id": "ag-platform", "name": "Platform", "members": ["u-priya"] }
  ],
  "trusted_profiles": [
    { "id": "tp-ci", "name": "GitHub CI",
      "claim_rules": [ { "issuer": "https://token.actions.githubusercontent.com",
                         "conditions": [ { "claim": "repo", "operator": "equals",
                                           "value": "acme/api" } ] } ] }
  ],
  "api_keys": [
    { "id": "key-1", "subject": "si-deployer", "created": "2023-01-04",
      "last_used": "2026-07-30", "expires": null }
  ],
  "policies": [
    { "id": "pol-14", "subjects": ["ag-platform"],
      "roles": { "platform": ["Administrator"], "service": ["Manager"] },
      "resources": { "service": "cloud-object-storage",
                     "resourceGroup": "production", "instanceId": null } }
  ]
}
```

Parse with a JSON source map so every entity carries `{ line_start, line_end }`
from the raw uploaded text. Citations depend on this. Do not skip it.

## Engine query surface

These are the ONLY functions the LLM may call. Fixed signatures.

- `whoCanAccess(service, resourceGroup?, minRole?)` -> subjects + paths
- `whatCanSubjectReach(subjectId)` -> targets + paths
- `pathsBetween(subjectId, target)` -> ordered access paths with evidence
- `listFindings(minSeverity?)` -> findings
- `explainPolicy(policyId)` -> policy detail + affected subjects

Every returned path is an array of steps. Each step has a reason
("direct policy", "member of access group X", "can create service IDs") and the
policy id plus line range that justifies it.

## Findings to detect

Severity CRITICAL:
- Privilege escalation chain: subject can reach admin over the account in N
  steps. Includes: Administrator over IAM Identity Service (can mint service IDs
  and grant them anything), Editor or Administrator over IAM Access Groups (can
  add self to any group), Administrator over "All Account Management Services".
- Trusted profile claim rule with no repository or branch condition, or a
  wildcard condition. Effectively a public door.

Severity HIGH:
- Policy with no resource attributes granting Administrator or Manager
  (account wide blast radius).
- Service ID with Administrator plus an API key with no expiry.
- Human user with standing Administrator and mfa_enabled false.

Severity MEDIUM:
- Standing Administrator on production for any human user.
- API key unused for over 90 days on a privileged subject.

Severity LOW:
- Redundant or overlapping role grants on the same target.
- Account setting allowing all users to see all other users.

Each finding carries: id, severity, title, one sentence plain English
explanation, evidence (policy ids + line ranges), suggested fix (a corrected
policy JSON), and a confidence field. Never invent a finding the engine did not
derive.

## Approval model

A privileged action (applying a fix, granting elevated access) creates a
`pending_request` that expires after 60 seconds.

It is released only by a physical NFC tap. Software cannot tap a card, so this
is a channel a compromised agent or stolen session does not control.

Requests flagged `dual_control` require taps from two DISTINCT cards within the
60 second window.

Elevated grants are time limited (default 15 minutes) and expire automatically.

The voice agent explains pending requests and answers questions about them. It
must NEVER approve anything. Approval is always the tap.

## Honesty requirements

These are scored by the judges. Do not quietly drop them.

- Every claim in the UI cites a line range in the uploaded file.
- Show a confidence indicator and say plainly when the engine cannot determine
  something rather than guessing.
- Redact anything resembling a key, token or email before sending text to any
  external model. Show the user what was redacted.
- The audit log is append only and visible in the UI.

## Code style

- Small files, clear names, no clever abstractions.
- All OpenAI calls go through one function `askModel()` in `lib/ai/client.ts`.
  Nothing else calls the API directly.
- No auth walls on the demo path. Do not enable restrictive RLS during the
  hackathon; note it as a production step instead.
- Seed data lives in `/fixtures`. Never generate fake findings for the UI.
