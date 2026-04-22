# QEP Phase 9 OEM Portal Configuration Checklist

**Date:** 2026-04-22  
**Gap Register row:** `16`  
**Surface:** `/oem-portals`

## Current Live State

Remote production data currently shows:

- `31` OEM portal profiles seeded
- `0` launch URLs configured
- `0` credential owners configured

So the software surface is built, but the launch board is still empty of real operator values.

## Required Per-OEM Fields

For each active manufacturer portal, capture:

- launch URL
- credential owner
- support contact
- access mode:
  - bookmark-only
  - shared login
  - individual login
  - OAuth-ready
  - API-only
- status:
  - active
  - needs setup
  - paused
- notes:
  - MFA requirement
  - division / branch caveats
  - browser or VPN caveats

## Completion Steps

1. Open `/oem-portals`.
2. Filter to `needs_setup`.
3. For each OEM the dealership actively uses, enter the verified launch URL.
4. Assign a credential owner.
5. Record the access mode truthfully.
6. Mark the row `active` only after a real successful launch is confirmed.
7. Leave unused or unknown OEMs in `needs_setup` or `paused`.

## Closure Rule

Row `16` can be retired only after:

- all OEMs that matter operationally have verified launch URLs
- credential ownership is assigned
- access mode is confirmed
- at least one live launch has been verified for each active OEM row
