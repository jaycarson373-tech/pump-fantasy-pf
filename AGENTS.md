## Pump Fantasy project rules

### Shared Project26 context

- At session start and before implementation, read the canonical Projects 2026
  `AI_CONTEXT.md` and `workflows/start.md`. In the normal local checkout they are
  `../AI_CONTEXT.md` and `../workflows/start.md`; otherwise locate the canonical kit
  at `~/Desktop/Crypto/projects-2026`. If unavailable, report the missing context.
- Apply its reuse-first and simplification guidance automatically, proportional to
  the change. Inspect existing owners and compatible shared components before
  adding another implementation. Do not run an unrelated whole-product audit for
  every small edit.
- Current implementation and verification history lives in the existing
  `.claude/tasks/single-wallet-backend.md`; read it before resuming this work.

### LARP / public-claim verification

- Automatically apply the relevant checks from the kit's `workflows/launch.md`
  and `~/Desktop/Crypto/docs/launch-credibility/LARP-CHECK-RULES.md` when changing
  product capabilities, public claims, configuration or release behavior. Review
  the full applicable checklist before launch or a release-readiness claim.
- Compare what the deployed site says with public API responses, actual runtime
  switches and available transaction evidence. Verify public, wallet-free proof
  where applicable. Distinguish implemented, tested, deployed, enabled and proven
  with funds; report missing evidence and unsupported claims honestly.
- Record the scope, evidence and unresolved items in the existing task record.
  Do not claim an external checker ran or awarded a score unless it actually did.
- This is an engineering review, not a background monitoring service or permission
  to spend, sign, deploy, change live switches, publish private data or alter copy.
  Never hide a disabled feature or fabricate proof to improve a checker result.
  Proposed frontend corrections follow the approval rule below.

### Frontend changes require operator approval

- Before making any frontend change, obtain the operator's explicit approval for
  the proposed change. This includes layout, styling, components, visible behavior,
  labels, wording, links, disclosures, which information is shown or hidden, and
  backend response changes that alter what users see.
- Present exact proposed wording for copy changes and a concrete description or
  preview for visual/interaction changes. Preserve the operator's intended language
  and presentation; do not substitute your own explanation or extra caveats.
- A direct operator request for a specific frontend change is approval for that
  stated scope. Do not ask again for an already approved change. A general backend
  fix, optimization, audit, LARP check or deployment request is not frontend approval.
- If backend work makes existing text inaccurate, flag it and propose the exact
  replacement first. Continue independent backend work while awaiting the answer;
  do not silently rewrite or remove the frontend content.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
