# QEP Phase 9 OEM Portal Operator Guide

**Date:** 2026-04-22  
**Gap Register row:** `16`  
**Surface:** `/oem-portals`

## Goal

Complete OEM portal onboarding in the live QEP dashboard so the dealership has a usable launch board for manufacturer and dealer portals.

This is an **operator configuration task**, not an engineering task.

## What This Page Is For

The `/oem-portals` page is the internal registry for:

- manufacturer portal launch URLs
- who owns the login or relationship
- how each portal is accessed
- whether the portal is active, paused, or still waiting on setup
- any notes that operators need before launching it

## What This Page Is Not For

Do **not** use the page to store passwords or sensitive shared secrets in plain text.

Use it to record:

- who owns the credential
- where the credential is managed
- how the portal is accessed
- what caveats apply

## Before You Start

Gather this for each OEM you actively use:

- the real portal URL
- the internal owner of the credential or relationship
- the support contact, if known
- whether access is:
  - bookmark-only
  - shared login
  - individual login
  - OAuth-ready
  - API-only
- whether MFA is required
- any browser, VPN, or branch-specific caveats

## Step-By-Step

1. Sign in to QEP with an admin/manager/owner account.
2. Open `/oem-portals`.
3. Start with rows in `needs_setup`.
4. Pick one OEM that the dealership actually uses today.
5. Open the OEM detail panel.
6. Enter the verified **Launch URL**.
7. Enter the **Credential owner**.
8. Enter the **Support contact** if known.
9. Set the correct **Segment**.
10. Set the correct **Access mode**.
11. Add notes:
    - MFA required
    - VPN required
    - browser restrictions
    - division / branch exceptions
    - where credential management lives
12. Only switch **Status** to `active` after a real successful launch is confirmed.
13. Leave the row as `needs_setup` if anything is still unknown.
14. Use `paused` for OEMs that exist in the system but should not be used right now.
15. Repeat until every active OEM is configured.

## How To Choose Status

Use `active` when:

- the launch URL is real
- the access mode is known
- someone owns the credential
- a real successful portal launch has been confirmed

Use `needs_setup` when:

- the OEM matters, but any key setup detail is still missing
- the portal URL is not verified
- ownership is unclear
- access method is still uncertain

Use `paused` when:

- the OEM exists in the system but should not be used operationally right now
- the relationship is inactive
- the OEM is seasonal, retired, or intentionally held back

## How To Choose Access Mode

Use `bookmark_only` when:

- QEP only needs a known URL and no shared credential coordination happens here

Use `shared_login` when:

- one dealership-managed credential is shared by multiple people

Use `individual_login` when:

- each user signs in with their own vendor-issued account

Use `oauth_ready` when:

- the OEM supports a real OAuth pattern and future SSO or API work is plausible

Use `api_only` when:

- no human launch workflow matters here and the relationship is primarily machine-to-machine

## What To Put In Notes

Good notes:

- "MFA required via Microsoft Authenticator"
- "Use Chrome only"
- "VPN required offsite"
- "Credential managed by Parts Ops"
- "Forestry division only"
- "Portal URL redirects to regional dealer login"

Bad notes:

- raw passwords
- recovery codes
- private secrets

## How To Verify A Row

A row is verified when all of these are true:

- launch URL exists
- credential owner exists
- access mode is correct
- status is `active`
- a real launch has been tested successfully

## What Counts As Done For Row 16

Row `16` can be retired when:

- every OEM the dealership actually uses has a verified row
- all active OEM rows have:
  - launch URL
  - credential owner
  - correct access mode
  - `active` status only after successful launch verification

## Recommended Working Order

1. OEMs used daily by sales, parts, or service
2. OEMs used weekly or monthly
3. OEMs that are historical or uncertain

## Related Files

- [QEP-Phase-9-OEM-Portal-Configuration-Checklist-20260422.md](/Users/brianlewis/Projects/qep-knowledge-assistant-qb-gl/docs/IntelliDealer/_Manifests/QEP-Phase-9-OEM-Portal-Configuration-Checklist-20260422.md:1)
- [QEP-Blocked-Backlog-Readiness-Audit-20260422.md](/Users/brianlewis/Projects/qep-knowledge-assistant-qb-gl/docs/IntelliDealer/_Manifests/QEP-Blocked-Backlog-Readiness-Audit-20260422.md:1)
