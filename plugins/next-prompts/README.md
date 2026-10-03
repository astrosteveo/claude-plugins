# Next Prompts

A Claude Code mod that suggests 3 next prompts after each reply. They show
in the band above the prompt, numbered 1 to 3.

Mods need Claude Code v2.1.287 or later.

## Use it

```text
1: Yes, add the expiry tests
2: Show me the diff first
3: Use Redis instead of a Map
0: Dismiss  or type your own prompt
```

- Type `1`, `2` or `3` into the empty prompt box to send that suggestion as
  your next prompt. It sends 0.4 seconds after the key.
- Type `0` to dismiss the list.
- In fullscreen mode and in the desktop app, you can also click a line.
- Type anything else to ignore the list. It goes away, your keys type as
  normal, and nothing is sent.

Claude Code handles these keys the same way it handles a survey's. A digit
only picks when it is alone in the prompt box. A digit that you type within
0.6 seconds of the list showing up types as normal, so a key meant for your
own prompt doesn't send a suggestion.

## How it works

When Claude finishes a reply, the mod forks the session and asks for 3
prompts. A fork sends the conversation again with one more message at the
end, and denies every tool. It uses the session's own model and reads the
conversation from the prompt cache, so it sees the whole conversation,
tool results included. The list shows about 1.5 to 3 seconds after the
reply ends. Nothing waits for that call: the turn ends and you can type at
once.

The mod shows no list when:

- the reply was from a subagent, was interrupted or ended on an error
- you started typing, or sent a prompt, before the fork answered
- the fork sent back fewer than 3 usable lines, which it does when the next
  step isn't clear

Another mod that draws in the same band, such as Token Weather, still shows
under the list.

## Turn off Claude Code's own suggestion

Claude Code has its own prompt suggestion: one dim line in the prompt box
after each reply. It makes the same kind of fork call. To pay for one call
per reply, not two, turn it off in `~/.claude/settings.json`:

```json
{ "promptSuggestionEnabled": false }
```

## Limits

- Each reply costs one request on the session's model. Most of its input is
  the conversation, read from the prompt cache at the cache-read rate: about
  29K tokens in a new session, and more as the conversation grows. It adds
  about 230 new input tokens and a few lines of output.
- To start your own prompt with `0` to `3` while the list shows, keep typing
  after the digit. A digit followed by a pause of 0.4 seconds sends a
  suggestion. A digit followed by Enter within 0.4 seconds is sent as your
  own prompt.
- Claude reads a picked suggestion as your own words, but the transcript
  marks it as a prompt from the next-prompts plugin.
- The band draws in the terminal and the desktop app. Claude Code doesn't
  draw it in VS Code or the mobile app.
- When two mods draw in this band, the one that runs first decides whether
  the other still shows. Next Prompts always passes the band on. A mod that
  doesn't can hide the list.

## Develop

```sh
claude plugin validate plugins/next-prompts
claude plugin test plugins/next-prompts
claude --plugin-dir ./plugins/next-prompts
```

The hooks module is `hooks/register.tsx`. Claude Code writes the API's type
files into `.claude-plugin/types/` each time it loads the mod, and git ignores
them.
