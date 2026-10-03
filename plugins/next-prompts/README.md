# Next Prompts

A Claude Code mod that suggests 3 next prompts after each reply. They show
in the band above the prompt, numbered 1 to 3.

Mods need Claude Code v2.1.287 or later.

## Use it

```text
1 Yes, add the expiry tests
2 Show me the diff first
3 Use Redis instead of a Map
Type 1-3 to send, 0 to dismiss, or type your own prompt
```

- Type `1`, `2` or `3` to send that suggestion as your next prompt.
- Type `0` to dismiss the list.
- Type anything else to ignore it. The list goes away, your key lands in the
  prompt box as normal, and nothing is sent.

A digit only picks when it is the first key you type into an empty prompt
box. A digit pasted, typed after other text or held with Ctrl or Alt types
as normal.

## How it works

When Claude finishes a reply, the mod sends the end of the conversation to
Haiku and asks for 3 one-line prompts. The list shows when Haiku answers,
about 1 to 3 seconds later. Nothing waits for that call: the turn ends and
you can type at once.

The mod shows no list when:

- the reply was from a subagent, was interrupted or ended on an error
- you started typing, or sent a prompt, before Haiku answered
- Haiku sent back fewer than 3 usable lines

Another mod that draws in the same band, such as Token Weather, still shows
under the list.

## Limits

- While the list shows, you can't start a prompt with `0` to `3`. Press `0`
  first, or type the digit after another character.
- Claude reads a picked suggestion as your own words, but the transcript
  marks it as a prompt from the next-prompts plugin.
- Each reply costs one Haiku call with about 3K to 5K input tokens. A setup
  that blocks the `haiku` model shows no list.
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
