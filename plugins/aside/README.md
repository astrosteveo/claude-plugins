# Aside

Aside lets you ask Claude for advice in the middle of a session without touching the session's context. The question
and the answer stay in a pane of their own. The session's model never sees either unless you hand the answer over.

It does what `/btw` does, plus four things:

- **Any model.** The answer can come from the session's own model, or from Fable, Opus, Sonnet or Haiku at any effort.
- **Read-only tools.** An aside can read files, search, and run read-only commands before it answers.
- **A side thread.** Each question carries the earlier answered ones, so you can go back and forth.
- **A hand-off.** One key sends an answer into the session, or puts it in the prompt for you to edit first.

It also keeps an eye on the prompt cache, and tells you when another model would cost more than the session's own.

## Asking

- `/aside <question>`: asks with the pane's current settings and opens the pane. It works while Claude is busy.
- `/aside`: opens the pane. Type a question in its field and press Enter.
- Flags in front of a question override the pane's settings for that question:
  - `-m <model>`: `session`, `fable`, `opus`, `sonnet` or `haiku`.
  - `-e <effort>`: `low`, `medium`, `high`, `xhigh` or `max`.
  - `-t` turns tools on, and `-T` turns them off.

  For example: `/aside -m fable -e high -t is this migration safe to run twice?`
- `/aside model <m>`, `/aside effort <e>` and `/aside tools on|off` change the pane's settings.
- `/aside clear` empties the side thread.

## Handing an answer over

Only the newest answer has buttons, with keys: `s` sends it to the session as a prompt, `e` puts it in the prompt box,
and `c` copies it. Each older answer shows its number. To hand over answer `n`, run `/aside send n` or `/aside edit n`.
Without a number, they act on the newest answer.

## How each aside is asked, and what it costs

| Settings | How it runs | Cache |
| --- | --- | --- |
| Session model, default effort, no tools | It forks the session's own last request and puts the question after it. | It reads the session's cache, so it is usually the cheapest. |
| Session model, default effort, tools | It forks a subagent from the session. | It reads the session's cache, plus whatever its tool calls cost. |
| Another model or effort, no tools | It makes a request of its own, with the conversation as a transcript. | It writes its own cache, and later asides on that model read it. |
| Another model or effort, tools | It starts a fresh subagent and hands it the transcript. | It caches nothing across asides. |

A transcript holds up to `transcriptTokens` of the conversation, newest first, and cuts tool results short. A
model that reads one sees less than the session's own model does.

The model picker shows an estimated cost next to each choice. Switching to a cheaper model is not always cheaper. On a
long conversation with a warm cache, the session's model reads the whole context at the cache-read price. Another model
has to write that context to its own cache first. When the model you pick would cost more than the session's own,
Aside holds the question and shows why, for example:

> Fable 5.1 costs about $0.70: a request of its own reads 49k tokens of this conversation cold. Opus 5.5, the
> session's model, reads its whole 320k-token context from cache for about $0.11.

You can then press `y` to ask the session's model, `a` to ask anyway, or `x` to drop the question. Set
`confirmSwitch` to `false` to skip this.

The estimates use Claude API list prices. Each one starts as a rough guess and gets more accurate as Aside learns
from real answers:
- **Tokens:** a transcript's token count starts as an estimate from its length. Each answer from another model reports
  the real count, and later estimates scale to match it.
- **Answer length:** each model's answer length is learned from its answers, starting from 1,500 tokens.
- **Subagents:** a subagent run with tools first counts only its first request. After that, each run is scaled by what
  earlier runs on the same model cost against their estimates.

What Aside learns is kept across sessions. Once an aside is answered, its line in the pane shows what it actually cost and how much it read
from the cache.

## The read-only guard

An aside's subagent can call Read, Grep, Glob, WebSearch, WebFetch, and Bash for read-only commands: `git status`,
`git log`, `git diff`, `rg`, `ls`, `cat`, `sed -n`, and the like. It refuses any other tool and any command it does
not recognize. It also refuses redirection, chaining, substitution, and flags that write, such as `sort -o`,
`find -delete` or `git log --output`. An aside never stops to ask you for permission: anything that would ask is
refused.

## Settings

Change them in `/config`, or under `pluginConfigs.aside` in your settings.

| Setting | Default | What it does |
| --- | --- | --- |
| `model` | `session` | The model the pane starts on. |
| `tools` | `false` | Whether the pane starts with read-only tools on. |
| `confirmSwitch` | `true` | Hold a question when the model you picked would cost more than the session's own. |
| `cacheTtl` | `auto` | How long the session's cache lives. `auto` reads it from the session transcript's last cache write at the end of a turn. If the transcript is over 4 MiB, it starts at 5 minutes and switches to 1 hour once a fork finds the cache still held after more than 5 minutes. |
| `transcriptTokens` | `100000` | The most of the conversation a transcript holds. |
| `threadTurns` | `10` | How many earlier answered asides each question carries. |

## Requirements

Claude Code v2.1.296 or later. Mods are an early access part of Claude Code, so a Claude Code release can break the
plugin until it is updated.

## Install

```
/plugin install aside --marketplace astrosteveo/claude-plugins
```
