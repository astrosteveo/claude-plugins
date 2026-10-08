# Ask

Ask Claude a side question without adding it to the chat. And when Claude
asks you something, see which option Claude would pick, and why.

Side questions go to a pane. The main conversation never sees the question or
the answer, so they don't fill up its context. When Claude asks you a
question with options, the plugin shows Claude's own pick, can answer for you
when you are away, remembers answers you mark, and keeps a log of what you
chose.

## Side questions

- `/ask` opens the Ask pane with the cursor in the question box.
- `/ask <question>` sends the question and opens the pane. You can keep
  working while Claude thinks. A toast tells you when the answer is ready.

The pane reads like a chat. The question box sits at the bottom. Questions
stack above it, oldest first, and the pane scrolls down when you ask or an
answer comes in.

Each question has buttons under it:

- **Copy** copies the answer.
- **Retry** runs a failed question again.
- **Remove** drops the question.
- **Use prompt** (or **Use 1**, **Use 2**, ... when there are several) puts a
  prompt Claude suggested into the prompt box, ready to edit or send. The
  suggested prompts are numbered in the answer to match.

Under the question box, **Suggest next prompts** asks Claude for three
prompts you could send next. **Clear answered** keeps only the questions
still running.

While questions are running, the status line says `ask: N thinking…`.

### How it answers

The answer comes from a fork of the session. The fork reads the whole
conversation, so Claude knows what you are working on. The prompt cache
serves that history, so a question costs little. If the session has no reply
yet, the question goes to a plain Sonnet call instead.

The fork can't use tools. It answers from the conversation alone.

Each question also carries the last three answered questions from the pane,
so a follow-up like "any others?" knows what Claude already said there. Those
earlier answers are cut short so this stays small.

The pane keeps the last 30 questions. If the plugin reloads while a question
is running, that question is marked as stopped and you can retry it.

A question typed in the pane leaves no trace in the chat. The `/ask` command
prints nothing, but Claude Code may still log the command line itself, as it
does for other commands.

## When Claude asks you

When Claude asks a question with options (the AskUserQuestion dialog), the
plugin adds the following.

### Claude's take

While the dialog is open, a fork of the session works out which option Claude
would pick. A box above the dialog shows the pick, a confidence meter with
"confident", "leaning" or "close call", and a short reason. With one
question, it also says in plain words what is being decided.

Each option's description gets a plain-words note, and the picked one gets
`★ Claude's pick (N%)`. The option labels never change, because the label is
the answer Claude gets back.

The box has little room. With one or two questions the reasons fit whole.
With more, each pick comes first and the reasons are cut to fit.

If the take fails, the box says why, and the dialog works as usual.

### When you are away

Claude Code can stop waiting for an answer. Its `askUserQuestionTimeout`
setting is `60s`, `5m`, `10m` or `never`, and it is `never` unless you set
it. When the time runs out, the dialog sends whatever you had selected so far.

With this plugin, Claude then goes with its own pick for each question you
left open. An answer you selected before the timeout stands. Claude is told
you did not choose the pick, and to mention it when you are back. A toast and
the band above the prompt say "You were away, so Claude went with X.", with a
**Got it** button (`g`).

While the timeout is on, the take box adds "If you're away for 5m, I'll go
with X." If Claude has no pick yet, or the take failed, the timeout works as
it would without the plugin.

### Remembered answers

After you answer, the band above the prompt asks whether to remember the
answer: **Remember** (`r`) or **Not now** (`n`). Sending your next prompt
also clears the band.

A remembered answer is given for you the next time Claude asks the same
question in the same project, with a toast saying so. If every question in
the dialog is remembered, the dialog doesn't open at all. The same question
means the same text and the same options, ignoring case and spacing.

Picks Claude took while you were away are never offered to remember.

### The decision log

`/decisions` opens a pane with the answers Claude reuses and the log of your
answers in this project. Esc closes it.

- The search box at the top filters both lists. Every word you type must
  appear in the question, the answer, the header or Claude's pick.
- **Forget** next to a remembered answer means you are asked again.
- The log shows the 50 newest answers that match. Each one says whether
  Claude agreed, what Claude would have picked instead, whether it came from
  memory, or whether Claude picked it while you were away.
- Under the log's title, a line says how often you went with Claude's pick:
  over the whole log, and over the last 20 answers once there are more. A
  second line splits it by week, for the last four weeks with answers.
  Answers from memory and picks taken while you were away don't count.
- **Copy as Markdown** puts the project's whole log on the clipboard.
- **Clear log** drops this project's log.

The log and the remembered answers live in the plugin's own store, shared by
every session. Nothing is written into the project. Two sessions open at once
don't erase each other's answers. The log keeps the last 300 answers across
all projects.

## Settings

The plugin has no settings of its own. The away pick uses Claude Code's
`askUserQuestionTimeout` setting, described above.

## Requirements

Claude Code v2.1.287 or later. Mods are an early access part of Claude Code,
so a Claude Code release can break the plugin until it is updated.

## Install

```text
/plugin marketplace add astrosteveo/claude-plugins
/plugin install ask@astrosteveo-plugins
/reload-plugins
```
