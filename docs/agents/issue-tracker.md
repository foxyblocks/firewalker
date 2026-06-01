# Issue tracker: Linear

Issues and PRDs for this repo live in **Linear**, in the **Firewalker shoes** project.

- Workspace: `foxyblocks`
- Team: `FOX` (Foxyblocks)
- Project: `Firewalker shoes` — slug `f5f33d351705`
  (https://linear.app/foxyblocks/project/firewalker-shoes-f5f33d351705)

## How agents talk to Linear

Use the **`linear-cli` skill** for all Linear operations — it wraps the `linear`
CLI (`linear issue …`, `linear api …`). The Linear MCP plugin is disabled; do
**not** call `mcp__plugin_linear_linear__*` tools.

The CLI's *default* account is a different workspace (`endgame`), so **every
command for this repo must pass `--workspace foxyblocks`**. Firewalker work lives
on team `FOX`, project slug `f5f33d351705`.

## When a skill says "publish to the issue tracker"

Create a Linear issue on the FOX team in the Firewalker shoes project. Write the
body to a file first so markdown renders correctly:

    linear issue create \
      --workspace foxyblocks \
      --team FOX \
      --project f5f33d351705 \
      --title "<title>" \
      --description-file /tmp/issue-body.md

Add `--label "<label>"` (repeatable) and `--state "<state>"` to set triage
labels/states — see `triage-labels.md` for the role → Linear mapping. For a PRD,
create the issue the same way; implementation tickets can reference it with
`--parent <FOX-NN>`.

## When a skill says "fetch the relevant ticket"

The user will normally pass an identifier (e.g. `FOX-123`):

    linear issue view FOX-123 --workspace foxyblocks

Browse with `linear issue list --team FOX --workspace foxyblocks --sort manual`;
change state/labels with `linear issue update FOX-123 --workspace foxyblocks …`.
