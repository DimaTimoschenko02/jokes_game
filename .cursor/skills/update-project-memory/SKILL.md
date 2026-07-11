---
name: update-project-memory
description: >-
  Updates the project memory file (.cursor/rules/project-memory.mdc) with new
  facts, architectural changes, design decisions, or status updates. Use when
  a significant change is made to the project — adding modules, changing
  architecture, fixing critical bugs, updating plans, or making design decisions.
---

# Update Project Memory

## When to Use

Call this skill when any of the following happens during a chat:

- A new module, service, or major component is added or removed.
- An architectural or design decision is made (e.g. changing how prompts are distributed).
- A critical bug is fixed that changes how the system behaves.
- A known limitation is resolved or a new one is discovered.
- A future plan is completed, added, or changed.
- The tech stack changes (new dependency, removed library, infra change).

Do NOT update for trivial changes like CSS tweaks, variable renames, or minor refactors.

## How to Update

1. Read the current memory file at `.cursor/rules/project-memory.mdc`.
2. Identify which section needs updating based on the change:
   - **Goal** — only if the project's purpose changes.
   - **How the Game Works** — if game rules or flow change.
   - **Tech Stack** — if dependencies or tools change.
   - **Architecture** — if modules are added/removed or the dependency graph changes.
   - **Key Implementation Details** — if important technical behavior changes.
   - **Known Limitations and Weak Points** — if a limitation is fixed (remove it) or a new one is found (add it).
   - **Future Plans** — if a plan is completed (remove it) or a new plan is agreed upon (add it).
3. Make a minimal, targeted edit to the relevant section. Do not rewrite sections that haven't changed.
4. Keep the file concise — it should remain a quick-reference document, not exhaustive documentation.

## Rules

- Keep each bullet point to one sentence.
- Use the same tone and style as the existing content.
- Do not add timestamps or chat references — the file should read as a timeless snapshot.
- Do not duplicate information that already exists in `codewriting.mdc`.
- If removing a "Known Limitation" because it was fixed, also remove it from "Future Plans" if it was listed there.
