# Type-ahead

A Claude Code mod that predicts the rest of the prompt you are typing. Stop
typing for a second and three likely ways your sentence goes on are listed
above the prompt, written from the conversation so far. The selected one shows
dim after your text in the box.

Mods need Claude Code v2.1.287 or later.

## Use it

- Type at least four characters, then pause for a second. Haiku reads your
  draft and the last six messages of the conversation and proposes three
  continuations, each at most one sentence, the likeliest first.
- They are listed in a band above the prompt. The selected one is marked `▸`
  and shows dim after your text in the box; the others are dim in the band.
- **alt+↓ / alt+↑** (or ctrl+↓/↑) cycle through them from the prompt, wrapping
  at either end; the marker and the preview follow.
- **Enter** takes the selected prediction: the box holds the whole text, ready
  to edit, and a second Enter sends it.
- Keep typing what the prediction says and the rest of it stays, the list
  narrowed to the predictions that still fit. Type anything else and they go,
  your key landing as usual; a new pause brings new ones.
- **Backspace** or a cursor move takes the predictions down and nothing more.
  To send only what you typed, press Backspace, then Enter.
- Click a row, or move into the band with **ctrl+x tab**, to pick one there:
  the arrows move between rows (the preview follows) and Enter takes the one
  under the ring.
- Run `/type-ahead` to turn predictions off or on. The choice is remembered
  across sessions.

Slash commands, `!` shell lines and `#` notes get no prediction, nor does a
caret anywhere but the end of the box.

### Tab into the list (optional)

Two keybindings make Tab jump from the prompt into the list, and Tab or → take
the row under the ring there. Add them to `~/.claude/keybindings.json`:

```json
{
  "bindings": [
    { "context": "Chat", "bindings": { "tab": "abovePrompt:focus" } },
    { "context": "AbovePrompt", "bindings": { "tab": "abovePrompt:press", "right": "abovePrompt:press" } }
  ]
}
```

They apply to every band above the prompt, not only this one: Tab in the
prompt enters any band that is showing, and in a band Tab and → press the
focused button instead of moving to the next.

## Limits

- No mod hears Tab, →, Esc or the plain arrows in the prompt box while the
  caret is at its end: they change nothing there, and ↑/↓ belong to the
  prompt history. That is why the keys are alt+↑/↓ and Enter.
- alt+↑/↓ and ctrl+↑/↓ are Claude Code's keys for its diff panel's file list.
  While that panel is open they move its list, not the predictions.
- Some terminals keep alt+arrows for themselves; ctrl+↑/↓ then does the same.
- The preview is real text in the box, painted dim: the mod API places no
  overlay. Taking a prediction with Enter shows the line "Took the prediction:
  Enter again to send it.", since the mod holds the send to put the text back
  in the box, and Claude Code shows the reason of every held prompt.
- Each pause is one Haiku call of a few hundred tokens. Typing again before the
  answer arrives cancels it.

## Develop

```sh
claude plugin validate plugins/type-ahead
claude plugin test plugins/type-ahead
claude --plugin-dir ./plugins/type-ahead
```

The hooks module is `hooks/register.tsx`, and `types/index.d.ts` declares the
state it keeps (the predictions on offer). The tests cover the decisions the
hooks act on (what each key does to a prediction, the prompt sent to the
model, how its reply becomes the predictions, narrowing, cycling, the band's
rows) and the `/type-ahead` toggle: the test kit raises no prompt-box edits, so
the keys themselves are tried by hand. Claude Code writes the API's type files
into `.claude-plugin/types/` each time it loads the mod, and git ignores them.
