# Plain English

A Claude Code mod that makes Claude write in short, plain English sentences. It
also refuses commit messages, PRs, Markdown files and replies that show the
usual signs of AI-written text.

Mods need Claude Code v2.1.289 or later.

## What it does

- **Writing rules.** The mod adds writing rules to Claude's system prompt. They
  tell Claude to start with the result, keep sentences short, say things
  literally, give headings plain names and explain project terms. They also
  list habits to drop, such as em dashes, stock words like `delve` and filler
  like `Hope this helps`.
- **Commit and PR check.** Before Claude runs `git commit`, or a `gh` command
  that creates or edits a PR, issue, comment or release, the mod checks the
  text. If it finds a sign of AI-written text, it refuses the command and lists
  what it found. Claude fixes the text and runs the command again. Markdown
  files that Claude writes or edits get the same check.
- **Reply check.** When Claude finishes a reply, the mod checks it the same
  way. If it finds something, Claude writes the reply again. This happens at
  most once per reply.

## What the checks look for

The checks skip code blocks, inline code, text in double quotes and quoted
lines. They flag:

- em dashes
- stock words: `genuinely`, `honestly`, `truly`, `delve`, `robust`,
  `seamless`, `crucial`, `nuanced`, `leverage`, `load-bearing`,
  `worth noting`, `notably`, `under the hood`, `at its core`,
  `boils down to`, `in essence` and `a testament to`
- reveal labels at the start of a sentence, like `The catch:` and
  `Bottom line:`
- filler, like `Great question` and `Hope this helps`
- short sentences that only announce what comes next, like
  `There were two problems.` and `Here's what happened:`
- sentences over 40 words

The system prompt rules cover more than the checks do. The checks only flag
patterns that are almost never right, so they rarely block good text. For
example, they don't flag `X, not Y` phrasing, because a pattern match can't
tell a slogan from a literal correction.

## Commands

- `/plain-english` shows whether the mod and the reply check are on.
- `/plain-english on` and `/plain-english off` turn the whole mod on or off.
- `/plain-english rewrite on` and `/plain-english rewrite off` turn only the
  reply check on or off.

Both are on by default. The settings are kept across sessions.

## Cost

The rules add about 1,500 tokens to every request. Once they're cached, that
costs about $0.0003 per request on Opus 5.5.

The commit check costs nothing unless it refuses a command. The reply check
costs nothing unless it finds a problem. When it does, Claude writes the reply
again, which costs about as much as the first version.

## Eval results

The suite in `evals/` runs five prompts with and without the mod. Sonnet grades
each answer on six writing rules, and the score is the share of rules passed.
These are from two runs per prompt, so expect some variation.

| Prompt | Without the mod | With the mod |
| --- | --- | --- |
| Give advice on SQLite or Postgres | 0.75 | 0.92 |
| Write a commit message from notes | 0.42 | 0.83 |
| Rewrite a dense wiki section | 0.42 | 0.58 |
| Explain a dense commit | 0.25 | 0.67 |

The fifth prompt asks Claude to commit a message that contains an em dash and
`genuinely`. Without the mod, Claude commits it as written. With the mod, the
commit check refuses it, and Claude committed a clean version in 3 of 3 runs.

## Limits

- The rules are instructions, so Claude can still slip. The checks only catch
  the patterns listed above.
- When the reply check fires, you see both versions of the reply.
- The commit check reads messages given with `-m`, `--title`, `--body`,
  `--notes` or a heredoc. It can't see a message read from a file, such as
  `--body-file notes.md`.
- When Claude writes a whole Markdown file, the check reads all of it. So
  rewriting an existing document means fixing its old text too.

## Develop

```sh
claude plugin validate plugins/plain-english
claude plugin test plugins/plain-english
claude plugin eval plugins/plain-english --scaffold --allow-tools Bash
claude --plugin-dir ./plugins/plain-english
```

The hooks are in `hooks/register.ts`, and the checker is in `hooks/checker.ts`.
The commit-gate eval uses a stand-in `./git` script, because the eval sandbox
can't run git. Eval results go to `evals/results/`, which git ignores. Claude
Code writes the API's type files into `.claude-plugin/types/` each time it
loads the mod, and git ignores those too.
