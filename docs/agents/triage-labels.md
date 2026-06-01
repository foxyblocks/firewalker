# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those
roles to the actual Linear states/labels used in this repo's tracker (team `FOX`,
workspace `foxyblocks`).

In Linear a role is applied as either a **workflow state** (exclusive — set with
`--state`) or a **label** (stackable — set with `--label`). The mapping uses
whichever is Linear-native.

| Canonical role    | Linear mapping    | Kind  | Meaning                                  |
| ----------------- | ----------------- | ----- | ---------------------------------------- |
| `needs-triage`    | `Triage`          | state | Maintainer needs to evaluate this issue  |
| `needs-info`      | `Needs input`     | label | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent` | label | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `ready-for-human` | label | Requires human implementation            |
| `wontfix`         | `Canceled`        | state | Will not be actioned                     |

Apply a role with the corresponding Linear state or label:

    # state change
    linear issue update FOX-123 --state "Triage" --workspace foxyblocks
    # label change
    linear issue update FOX-123 --label "ready-for-agent" --workspace foxyblocks

Notes:

- `needs-info` reuses the pre-existing **"Needs input"** label.
- `wontfix` uses the built-in **Canceled** state (Linear convention), not a label.
- New issues land in **Triage** automatically (Triage is enabled on FOX), so
  `needs-triage` is usually the default rather than something you set.

Edit this file if the vocabulary changes (e.g. you rename a label or adopt a new
workflow state).
