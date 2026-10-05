# Ouroboros

A Claude Code harness that rewrites itself.

Ouroboros watches for the places a session goes wrong. When the same thing keeps
going wrong, it has a subagent write a hook that fixes it, tests that hook, and
shows it to you. If you accept it, the hook becomes a plugin of its own and
starts working in the same session. Each of these hooks is a "gene".

## How it works

1. **Sense.** Ouroboros records friction: tool calls that were denied or
   failed, prompts where you correct Claude ("no, I said…", "again",
   "instead"), and turns you interrupt.
2. **Diagnose.** After five new friction events, or when you run
   `/ouroboros evolve`, it asks a fork of the session which recurring problem
   a hook could fix. The fork reads the whole conversation from the prompt
   cache, so this costs little.
3. **Mutate.** A hidden `ouroboros:geneticist` subagent writes the gene and a
   test for it, in a lab folder under `~/.claude/ouroboros/lab/`.
4. **Gate.** Ouroboros runs `claude plugin validate`, `claude plugin test` and
   `tsc` on the gene. A gene that fails is never offered as ready.
5. **Approve.** The Genome pane shows the gene's code as a diff, with the
   result of each check. Nothing is installed until you accept it.
6. **Splice.** The gene is written next to Ouroboros as a plugin named
   `ouroboros-gene-<id>`. In a marketplace like this one, Ouroboros also adds
   it to `marketplace.json`, installs it and reloads plugins. In a mods
   folder, the engine loads the new folder by itself.

The system prompt lists the active genes, so Claude knows which behaviours it
is running under.

## Use it

- `/ouroboros` opens the Genome pane: a sparkline of friction per turn, the
  latest friction, the mutation in progress and the active genes.
- `/ouroboros evolve` starts a mutation now.
- `/ouroboros auto off` stops automatic evolution; `/ouroboros auto on`
  turns it back on.

In the pane, **a** accepts a ready gene, **r** rejects it (Ouroboros won't
propose it again), **g** runs the checks early if the geneticist seems stuck,
**e** starts a mutation, and **1**–**9** excise an active gene.

The status line shows the number of genes, the friction so far, and what a
mutation is doing.

## Notes

- Excising a gene uninstalls it, removes it from the marketplace and moves its
  folder to `~/.claude/ouroboros/excised/`.
- Spliced genes are new folders in the repository. Commit the ones you want
  to keep.
- Automatic evolution starts a subagent without asking, which costs tokens.
  Accepting a gene is always your call.
- Each install of a plugin has its own store. A new install of Ouroboros
  takes over the genome and friction history of the one it replaces.
