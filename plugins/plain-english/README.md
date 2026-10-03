# Plain English

A Claude Code mod that makes Claude write plain, literal English. Claude
states status as facts, such as "PR #223 is complete and merged. PR #227 is
next highest priority.", in place of lines like "Once PR #223 lands, that's
our cue to transition to preparing #227 for flight."

Mods need Claude Code v2.1.287 or later.

## What it does

- **Sets the rules.** It adds a "Plain English" section to Claude's system
  prompt: plain language as defined by ISO 24495-1, plus rules for status
  updates with before and after examples.
- **Checks each reply.** When a turn ends, it scans everything Claude wrote in
  that turn, including the text between tool calls. It looks for figurative
  phrases such as "our cue", "on deck", "once X lands" and "for flight". If it
  finds any, it shows a line under the reply, such as
  `Flagged phrases: "our cue", "for flight"`.
- **Reminds Claude.** Each prompt you send carries a short reminder that only
  Claude sees. After a flagged reply, the reminder also names the phrases
  Claude used.

The check skips code, links, block quotes and text in double quotes, because
those are someone else's words. It checks the main conversation only, not
subagents.

## Replace the Plain Language output style

This mod holds the same rules as the "Plain Language" output style, so turn
the style off to avoid loading the rules twice. While both are on, the mod
says so once per session.

1. Install the mod and run `/reload-plugins`.
2. Run `/config` and set **Output style** to **Default**.

## Options

Both options are rows in `/config`.

| Option | Default | What it does |
| --- | --- | --- |
| Show flagged phrases (`showFlags`) | on | Shows the line under a flagged reply. Off still names the phrases in the next reminder. |
| More phrases to flag (`extraPhrases`) | empty | More phrases to catch, separated by commas, such as `ship it, all hands`. |

## Limits

- The check uses a fixed list of phrases. It misses new figures of speech,
  so add the ones you see often to `extraPhrases`.
- The flag line comes after the reply. The mod doesn't rewrite what Claude
  already wrote.

## Develop

```sh
claude plugin validate plugins/plain-english
claude plugin test plugins/plain-english
claude --plugin-dir ./plugins/plain-english
```

The rules are in `hooks/rules.ts` and the phrase list is in `hooks/phrases.ts`.
Keep the rules text fixed: it sits after the prompt cache boundary, so text
that changes per turn makes every request miss the cache. Claude Code writes
the API's type files into `.claude-plugin/types/` each time it loads the mod,
and git ignores them.
