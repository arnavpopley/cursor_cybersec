# Fixtures

Seed IAM policy files for the Keyring hackathon demo. Never invent findings in
the UI — every finding must come from the engine reading one of these files.

| File | Purpose |
|------|---------|
| `acme-account.json` | Broken account — before state |
| `acme-account-fixed.json` | Same account with problems 1–4 remediated — after state |

## Account shape

- **12 subjects:** 7 users, 4 service IDs, 1 trusted profile
- **5 access groups:** Platform, Developers, Contractors, SRE, Engineering
- **Nested membership:** `ag-engineering` contains `ag-developers`, `ag-contractors`, and `ag-sre`
- **Resource groups:** `production`, `staging`
- **Services:** `cloud-object-storage`, `cloudantnosqldb`, `databases-for-postgresql`, `iam-identity`, `iam-groups`, `containers-kubernetes`
- **30 policies**

## Planted problems (`acme-account.json`)

### 1. CRITICAL — Privilege escalation via iam-groups Editor (headline)

**Surface look:** Contractor `u-dev-marco` only has staging Cloudant Writer, staging Kubernetes Reader, and nested Engineering Viewer on staging COS. No production policies name him.

**Hidden path:**
1. `pol-12` grants `u-dev-marco` platform **Editor** on `iam-groups`
2. Editor on IAM Access Groups can add himself to any group
3. He adds himself to `ag-platform`
4. `pol-01` grants `ag-platform` **Manager** on production `databases-for-postgresql`

**Expected finding:** Privilege escalation chain — subject can reach Manager/Administrator over production Postgres in N steps via iam-groups membership edit. Evidence: `pol-12`, `pol-01`, Platform group membership.

**Remediation in fixed file:** `pol-12` downgraded to platform **Viewer** on `iam-groups` (cannot mutate group membership).

---

### 2. CRITICAL — Trusted profile with issuer-only claim rule

**Surface look:** `tp-github-ci` is a normal GitHub Actions CI profile used for staging deploys (`pol-24`, `pol-25`).

**Hidden path:** Claim rule checks only
`issuer: https://token.actions.githubusercontent.com` with **empty conditions**.
Any GitHub repo can assume the profile.

**Expected finding:** Trusted profile claim rule with no repository or branch condition — effectively a public door. Evidence: `tp-github-ci` claim rule.

**Remediation in fixed file:** Condition added — `repo` equals `acme/api`.

---

### 3. HIGH — Account-wide Administrator service ID + immortal API key

**Surface look:** `si-legacy-admin` looks like leftover automation.

**Hidden path:**
- `pol-17` grants platform **Administrator** + service **Manager** with **no resource attributes** (account-wide blast radius)
- `key-legacy-admin` has `expires: null` and `last_used: 2023-04-17`

**Expected findings:**
- Policy with no resource attributes granting Administrator/Manager
- Service ID with Administrator plus an API key with no expiry
- (Also unused privileged key >90 days — MEDIUM)

Evidence: `pol-17`, `key-legacy-admin`.

**Remediation in fixed file:** `pol-17` scoped to staging COS with Operator/Writer; key gets `expires: 2026-12-31` and a recent `last_used`.

---

### 4. HIGH — Standing Administrator without MFA

**Surface look:** `u-jordan` (Jordan Blake) is an internal admin.

**Hidden path:**
- `mfa_enabled: false`
- `pol-15` / `pol-16` grant standing **Administrator** (production COS + iam-identity)

**Expected findings:**
- Human user with standing Administrator and `mfa_enabled` false (HIGH)
- Standing Administrator on production for a human user (MEDIUM)

Evidence: subject `u-jordan`, `pol-15`, `pol-16`.

**Remediation in fixed file:** `mfa_enabled: true`; roles reduced to Editor/Writer on production COS and Viewer on iam-identity.

---

### 5. LOW — Redundant / overlapping grants (kept in both files)

Two deliberate duplicates so the LOW bucket is not empty:

| Overlap | Policies | Same grant |
|---------|----------|------------|
| Staging COS Viewer/Reader for Developers | `pol-08` and `pol-29` | identical roles + target on `ag-developers` |
| Staging Cloudant Viewer/Reader for Nina | `pol-27` and `pol-30` | identical roles + target on `u-nina` |

**Expected finding:** Redundant or overlapping role grants on the same target (LOW). Present in both before and after fixtures.

## Fixed file summary

| Problem | Change in `acme-account-fixed.json` |
|---------|-------------------------------------|
| 1 | `pol-12`: Editor → Viewer on `iam-groups` |
| 2 | `tp-github-ci`: add `repo` equals `acme/api` condition |
| 3 | `pol-17`: scoped + demoted; `key-legacy-admin` expires set |
| 4 | `u-jordan` MFA on; Administrator grants reduced |
| 5 | Unchanged (still expected LOW findings) |
