# Consult

A Claude Code mod for a private side talk with Claude. Ask what Claude meant,
or have it write your next prompt, without adding anything to the main chat.

Mods need Claude Code v2.1.287 or later.

## Use it

- `/consult [question]` asks a side copy of Claude about its last message. It
  explains what it needs from you, gives its recommendation, and writes the
  reply you should send. With no question, it explains its last message.
- `/consult prompt <idea>` turns a rough idea into a scoped prompt: what to
  do, which files it touches, the limits and what "done" looks like.
- `/consult close` hides the pane.

The answer shows in a pane. The suggested reply or prompt goes into your
prompt box, so you can edit it and press Enter. If the box can't take it,
the line over the draft in the pane says why, such as "a dialog was open".
Copy the draft from the pane.

## Follow-ups

Type a follow-up in the field at the bottom of the pane and press Enter.
Click the field, or press ctrl+x tab, to type there. Each answer sees the
whole consult so far, and the pane shows the thread.

A follow-up updates the draft in your prompt box only while the box is empty
or still holds the mod's last draft. If you've edited it, the mod leaves your
text alone and shows the new draft in the pane.

## Which model answers

The mod picks the cheaper call that still sees enough of the session:

- **While the main thread's prompt cache is warm,** it forks the main thread.
  The fork reads the whole session, including the system prompt, CLAUDE.md
  and tool output, mostly from cache. In a session of about 100K tokens, that
  costs about $0.04 a call.
- **Once the cache is cold,** it asks Sonnet instead. Sonnet gets a condensed
  transcript: all chat text, one line per tool call, and tool results cut to
  500 characters, up to about 15K tokens with the newest kept. That's also
  about $0.04, where a cold fork would cost about $0.45.

The mod takes the cache as warm for 55 minutes after the main thread's last
turn ends. A fork that comes back mostly uncached shortens that window for the
rest of the session. Before Claude's first answer, Sonnet answers.

Each answer in the pane ends with the route it took and what it read, such as
`via fork · 106K cached, 2K uncached` or `via Sonnet · 12K sent`.

## How it stays out of the chat

The command returns no output, because command output is a row the model
reads. Follow-ups go through the pane's field, which starts no model turn.
Answers go only to the pane and the prompt box. The main Claude sees only
what you send.

The command runs at once, even while Claude is working.

## Limits

- You can't type a command while a question dialog is open. Pick "Other" or
  press Esc first, then run `/consult`.
- The mobile app draws no text field, so follow-ups need the terminal,
  desktop or VS Code.
- Starting a new `/consult` starts a new thread.

## Develop

```sh
claude plugin validate plugins/consult
claude plugin test plugins/consult
claude --plugin-dir ./plugins/consult
```

The hooks module is `hooks/register.tsx`. Claude Code writes the API's type
files into `.claude-plugin/types/` each time it loads the mod, and git ignores
them.
