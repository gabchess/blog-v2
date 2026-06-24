# 2. Design system first

Status: Accepted

## Context

A blog has a small number of page types (index, post, list) but those pages can be styled in many directions. Hand-rolling markup per page leads to inconsistent spacing, one-off color values, and pages that drift apart as they grow. It also makes a redesign expensive, because every page is its own snowflake.

## Decision

Build pages by composing a shared component library (`@workspace/ui`, a shadcn component set on Tailwind v4) rather than writing raw markup. Color, type, and spacing live as tokens in the library. Pages assemble components; they do not redefine the system.

## Consequences

- Layout and hierarchy can change a lot while colors, fonts, and components stay fixed. One system can drive very different page designs.
- A redesign becomes a composition exercise, not a rewrite.
- Visual consistency is the default, not something enforced by review.
- The constraint is real: when a page needs something the system does not have, the right move is to extend the library, not to bypass it on the page.

## Alternatives considered

- **Per-page CSS or inline styles.** Rejected: drift and inconsistency at scale.
- **A heavier component framework with built-in opinions.** Rejected: shadcn keeps the components in the repo and fully editable, which suits a design that needs to move.
