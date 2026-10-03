# Memsync

A Claude Code mod that keeps your auto memory, your `CLAUDE.md` and your user
skills the same on every machine. It stores them in a private git repo that
you own, and shows the sync state in a `/memsync` pane.

```text
 ● on   [ Turn off ]

 Last sync    10:42  pushed 2, pulled 0 [ Sync now ]
 Repo         ~/claude-memory → origin/main (clean)
 This project claude-plugins → projects/claude-plugins ✓

 Projects     18 linked · 1 unlinked · 2 dead [ Link all ] [ Prune ]
   ! ~/Projects/agent-marketplaces/codex-plugins not linked
   ✗ ~/Projects/racing-manager folder gone

 Conflicts    1
   projects/void-sector/notes.laptop.md [ Merge ]

 Shared       CLAUDE.md ✓  reflect ✓  issue ✓

 Log
   10:42 change: pushed 2, pulled 0
```

Mods need Claude Code v2.1.287 or later, and Linux or another system with
`flock` and `setsid` from util-linux.

## Set up

Bring your own private repo. Memory can hold details of your work, so never
use a public one.

1. Create an empty private repo, such as `claude-memory` on GitHub.
2. Clone it where the mod looks by default:

   ```sh
   git clone git@github.com:<you>/claude-memory.git ~/claude-memory
   ```

3. Install the mod and reload:

   ```text
   /plugin install memsync@astrosteveo-plugins
   /reload-plugins
   ```

4. Run `/memsync`. The pane should show `● on`, a last sync time and this
   project as linked.

On each new machine, repeat steps 2 to 4.

To share your `CLAUDE.md`, put it at `claude/CLAUDE.md` in the repo. To share
a skill, put its folder in `skills/`. The mod links both into your Claude
config folder. A file already in that place moves to
`~/.claude/backups/memsync/` first.

## Settings

Change these in the `/config` menu.

| Setting | Default | What it does |
| --- | --- | --- |
| Memory repo | `~/claude-memory` | Your clone of the private repo. |
| Projects folder | `~/Projects` | Only projects inside it sync. The rest keep their memory on this machine. |

`/memsync off` stops all syncing on this machine until `/memsync on`. The
choice lasts across sessions.

## How it works

- **Linking:** Each project's memory folder becomes a link to
  `projects/<name>/` in the repo. `<name>` is the project's origin repo name,
  or its folder name when it has no remote. Git submodules link under their
  own name. The mod reads the memory folder's path from Claude Code instead
  of working it out. An existing memory folder merges into the repo first,
  then moves to `~/.claude/backups/memory/`.
- **Syncing:** At the start of a session the mod pulls, links and pushes,
  without making your first prompt wait. After that, git runs only when a
  turn changed this project's memory, `CLAUDE.md` or a skill. When the
  session ends, it commits what is left and pushes in the background.
- **New memory mid-session:** When a pull changes this project's memory or
  your `CLAUDE.md`, the mod reloads them into the session.
- **Merging:** Two `MEMORY.md` indexes merge line by line. Any other file
  that differs is kept twice, the second copy named after the machine, such
  as `notes.laptop.md`. The pane lists these copies. Press **Merge** to put a
  prompt asking Claude to merge one into your prompt box.
- **Secrets:** A change that looks like a secret value, such as a GitHub
  token or a private key, doesn't sync. The pane names the file. Remove the
  value and sync again. Names of secrets are fine.
- **Locking:** Sessions take turns through `flock` on `.memsync.lock` in the
  repo. A rebase left stuck by an interrupted sync is aborted at the next
  start. A rebase that conflicts is aborted and reported, so you can fix it by
  hand in the repo.

The mod runs only `git`, `ln`, `mv`, `flock` and `setsid`. It uses `mv` only
to move an existing folder or file aside before it links that place.

A line pinned under the prompt appears only when something needs you: a
failed sync, a conflict copy to merge, or syncing turned off. Claude Code
draws every pinned line with a warning sign, so a healthy sync shows none.

**Prune** clears projects whose folder is gone from this machine. Their
memory files merge into the repo first, then the old memory folder moves to
`~/.claude/backups/memory/`. Their transcripts stay where they are.

## Commands

`/memsync` opens the pane as a dialog, like Claude Code's own menus. It takes
the keyboard, Tab and the arrow keys move between its buttons, and Esc closes
it.

```text
/memsync            open the pane
/memsync sync       commit, pull and push now
/memsync link       link this project's memory
/memsync link all   link every project in the projects folder
/memsync prune      clear projects whose folder is gone (memory is kept)
/memsync status     show the state as text
/memsync on | off   turn syncing on or off
/memsync close      close the pane
```

## Develop

```sh
claude plugin validate plugins/memsync
claude plugin test plugins/memsync
sh plugins/memsync/tests/real-git.sh
claude --plugin-dir ./plugins/memsync
```

`claude plugin test` runs in a sandbox with no processes or files, so it
covers the logic and the pane. `tests/real-git.sh` covers the rest. It drives
the mod through headless sessions against a bare remote and two fake
machines, all under `/tmp`, each with its own `CLAUDE_CONFIG_DIR`. It makes
no model calls.

The hooks module is `hooks/register.tsx`, and its pure helpers are in
`hooks/core.ts`. Claude Code writes the API's type files into
`.claude-plugin/types/` each time it loads the mod, and git ignores them.
