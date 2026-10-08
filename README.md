# Claude Plugins

A [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces) named `astrosteveo-plugins`.
Every plugin here is a mod: TypeScript hooks that draw inside Claude Code and react to its events.

## Plugins

| Plugin | What it does |
| --- | --- |
| [ask](plugins/ask) | Ask Claude a side question in a pane. When Claude asks you something, see which option it would pick and why. |
| [usage](plugins/usage) | Context fill, cost and rate limits in a band above the prompt, each turn's tokens and cost on its closing line, and a `/spend` pane. |
| [gutter](plugins/gutter) | A time column in the transcript: when you sent each prompt, how long each tool ran, and each folded group's total. |
| [minimap](plugins/minimap) | The session as a strip of colored cells above the prompt: what each turn did, what it cost, and where it failed. |
| [backlog](https://github.com/astrosteveo/backlog) | A project tracker stored outside your repo, with a board pane, tools for Claude and a local web app. |

backlog lives in its own repository. This marketplace points at a pinned commit of it.

Mods are an early access part of Claude Code. Their API can change between releases, so a new release can break a
mod until it is updated. Each plugin's README says which Claude Code version it needs.

## Install

Add the marketplace, then install the plugins you want:

```text
/plugin marketplace add astrosteveo/claude-plugins
/plugin install usage@astrosteveo-plugins
```

To use a local checkout instead, pass its path to `/plugin marketplace add`. Run `/reload-plugins` after installing
or updating.

## Develop

You need the latest Claude Code and Node 22 or later.

```sh
sh scripts/validate.sh                # validate the marketplace and every plugin
sh scripts/test.sh                    # run every plugin's tests
sh scripts/typecheck.sh               # type-check every plugin
claude --plugin-dir ./plugins/usage   # try one plugin without installing it
```

CI runs the same three scripts on every pull request, on pushes to `main`, and weekly. It always uses the latest
Claude Code.

[CLAUDE.md](CLAUDE.md) explains how a mod is laid out, the design rules, and how work moves through the repo.

## License

[MIT](LICENSE)
