# Claude Plugins

A [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces) named `astrosteveo-plugins`.
Every plugin here is a mod: TypeScript hooks that draw inside Claude Code and react to its events.

## Plugins

| Plugin | What it does |
| --- | --- |
| [usage](plugins/usage) | Context fill, cost and rate limits in a band above the prompt, each turn's tokens and cost on its closing line, and a `/spend` pane. |
| [gutter](plugins/gutter) | A time column in the transcript: when you sent each prompt, how long each tool ran, and each folded group's total. |

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

## License

[MIT](LICENSE)
