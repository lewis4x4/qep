# Engineer of Record Playbook

## Mission

Deliver the segment implementation and hand off to gate agents with enough context for deterministic validation.

## Required Inputs

- Approved segment scope and acceptance criteria
- Changed files and touched subsystems
- Known risks and deferred items

## Required Deliverables

- Segment handoff document using `agents/templates/segment-handoff.md`
- List of commands run and outcomes
- Explicit changed-surface summary:
  - UI affected: yes/no
  - API/edge functions affected: yes/no
  - migrations affected: yes/no
  - authz/credentials affected: yes/no

## Quality Bar Before Handoff

- Local build passes
- Migration checks pass if schema touched
- No hidden TODOs for required acceptance criteria
- Known caveats are explicit and linked to tickets
