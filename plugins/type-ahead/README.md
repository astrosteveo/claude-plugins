# Type-ahead

A Claude Code mod that predicts the rest of the prompt you are typing. Stop
typing for a second and the likely next words appear dim after your text,
written from the conversation so far.

Mods need Claude Code v2.1.287 or later.

## Use it

- Type at least four characters, then pause for a second. Haiku reads your
  draft and the last six messages of the conversation and proposes how the
  sentence goes on, at most one sentence. It shows dim after your text.
- **Enter** takes the prediction: the box holds the whole text, ready to edit,
  and a second Enter sends it.
- Keep typing what the prediction says and the rest of it stays. Type anything
  else and it goes, your key landing as usual; a new pause brings a new one.
- **Backspace** or an arrow key takes the prediction down and nothing more.
  To send only what you typed, press Backspace, then Enter.
- After you have typed into a prediction, **Tab**, **→** or **End** take the
  rest of it too.
- Run `/type-ahead` to turn predictions off or on. The choice is remembered
  across sessions.

Slash commands, `!` shell lines and `#` notes get no prediction, nor does a
caret anywhere but the end of the box.

## Limits

- The prediction is real text in the box, painted dim: the mod API places no
  overlay and cannot move the caret before it. That is why Enter, not Tab,
  takes it at first: Tab, → and End at the end of the box change nothing, so
  no hook hears them.
- Taking a prediction with Enter shows the line "Took the prediction: Enter
  again to send it." The mod holds the send to put the text back in the box,
  and Claude Code shows the reason of every held prompt.
- Each pause is one Haiku call of a few hundred tokens. Typing again before the
  answer arrives cancels it.

## Develop

```sh
claude plugin validate plugins/type-ahead
claude plugin test plugins/type-ahead
claude --plugin-dir ./plugins/type-ahead
```

The hooks module is `hooks/register.ts`. The tests cover the decisions the
hooks act on (what each key does to a prediction, the prompt sent to the
model, how its reply becomes the prediction) and the `/type-ahead` toggle: the
test kit raises no prompt-box edits, so the keys themselves are tried by hand.
Claude Code writes the API's type files into `.claude-plugin/types/` each time
it loads the mod, and git ignores them.
