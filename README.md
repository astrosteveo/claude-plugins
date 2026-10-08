# Claude Plugins

A [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
maintained by astrosteveo.

## Available plugins

| Plugin | What it does |
| --- | --- |
| [ask](plugins/ask) | Ask Claude a side question in a pane, and get Claude's own pick, remembered answers and a decision log when Claude asks you. |
| [usage](plugins/usage) | Context fill, cost and rate limits in a band above the prompt, each turn's tokens and cost on the line that closes it, and a `/spend` pane. |
| [gutter](plugins/gutter) | A time column at the right of the transcript: when you sent each prompt, how long each tool ran, and each folded group's total. |

The issue board that used to live here has moved to its own repository.

## Requirements

The plugins here are mods: plugins of function hooks that draw panes and hook
Claude Code's events. Each plugin's README says which Claude Code version it
needs. Mods are an early access part of Claude Code: their API may change
between releases, and a release may break a mod until it is updated.

## Install

Inside Claude Code, add the marketplace from GitHub and install a plugin:

```text
/plugin marketplace add astrosteveo/claude-plugins
/plugin install ask@astrosteveo-plugins
```

From a local checkout, register the checkout directory instead:

```text
/plugin marketplace add /path/to/claude-plugins
/plugin install ask@astrosteveo-plugins
```

The same commands work from a shell as `claude plugin marketplace add ...` and
`claude plugin install ...`. Restart Claude Code or run `/reload-plugins` after
installing.

To try a plugin without installing it, start Claude Code with the plugin
directory: `claude --plugin-dir ./plugins/my-plugin`.

## Structure

```text
.claude-plugin/
  marketplace.json            # Marketplace identity and ordered plugin catalog
plugins/                      # One directory per plugin
scripts/validate.sh           # Strict validation of the marketplace and every plugin
scripts/test.sh               # Every plugin's tests, and the userConfig check below
scripts/config-rows.test.mjs  # Every userConfig field must be one /config can show as a row
scripts/typecheck.sh          # Type-check every plugin against the installed Claude Code
scripts/mutants.sh            # Proves each regression test still catches its bug
scripts/mutants/              # One patch per fixed bug, which puts the bug back
.github/workflows/            # validate.yml (CI) and mutants.yml
CLAUDE.md                     # Guidance for Claude Code in this repository (AGENTS.md links to it)
```

Each plugin is a mod, laid out like this:

```text
plugins/my-plugin/
  .claude-plugin/
    plugin.json               # Plugin identity, metadata and settings (userConfig)
  README.md
  hooks/
    hooks.json                # Names the hooks module
    register.tsx              # The module: exports register, which hooks Claude Code's events
    parse.ts                  # Pure logic the tests call directly (optional)
  types/index.d.ts            # The plugin's state contract and shared types (optional)
  tests/                      # *.test.ts(x), run by claude plugin test
  tsconfig.json               # Extends .claude-plugin/types/tsconfig.json
```

Claude Code writes the API's typings into `.claude-plugin/types/` each time it
loads the mod, and git ignores them. There is no root plugin manifest: this
repository is a catalog of plugins, each with its own manifest.

## Add a plugin

1. Create `plugins/my-plugin/.claude-plugin/plugin.json`:

   ```json
   {
     "$schema": "https://anthropic.com/claude-code/plugin.schema.json",
     "name": "my-plugin",
     "displayName": "My Plugin",
     "version": "0.1.0",
     "description": "A word of my own under the prompt.",
     "author": {
       "name": "astrosteveo"
     },
     "keywords": ["mod"]
   }
   ```

2. Add the hooks module. `plugins/my-plugin/hooks/hooks.json` names it:

   ```json
   { "modules": ["./register.tsx"] }
   ```

   `plugins/my-plugin/hooks/register.tsx` exports `register`, which hooks
   Claude Code's events. Each hook is `($, e, next)`, and `next(e)` runs what
   is beneath it. This one ends the line under the prompt with a word:

   ```tsx
   import type { Register } from 'claude-code'

   export const register: Register = on => {
     on('ui.render', { component: 'PromptHint' }, async (_$, e, next) =>
       next({ ...e, props: { ...e.props, tail: e.props.tail ? `${e.props.tail} · hello` : 'hello' } }),
     )
   }
   ```

   Add a `tsconfig.json` that extends `./.claude-plugin/types/tsconfig.json`,
   so `scripts/typecheck.sh` checks the module. When the mod keeps state, add
   `types/index.d.ts` with its state contract and point `"types"` in
   `plugin.json` at it. Load the `plugin-authoring` skill before writing more
   hooks. A hook at a gating site, such as `tool.check` or `prompt.submit`,
   needs a `.catch`; see [CLAUDE.md](CLAUDE.md).

3. Append an entry to the `plugins` array in `.claude-plugin/marketplace.json`:

   ```json
   {
     "name": "my-plugin",
     "source": "./plugins/my-plugin",
     "description": "A word of my own under the prompt.",
     "version": "0.1.0",
     "author": {
       "name": "astrosteveo"
     },
     "category": "productivity",
     "tags": ["mod"]
   }
   ```

   Keep the entry name, plugin directory name, and manifest name identical, and
   keep the two `version` fields in sync. Array order controls display order.

4. Validate and try it:

   ```sh
   sh scripts/validate.sh
   sh scripts/typecheck.sh
   claude --plugin-dir ./plugins/my-plugin
   ```

5. If the marketplace is already registered, refresh it and install the plugin:

   ```text
   /plugin marketplace update astrosteveo-plugins
   /plugin install my-plugin@astrosteveo-plugins
   ```

## Validate

`scripts/validate.sh` runs `claude plugin validate --strict` on the marketplace
manifest and on every directory under `plugins/`. While there are no plugins it
checks the marketplace without `--strict`, because an empty marketplace always
warns that it has no plugins. It also fails when a plugin has a hook at a gating
site, such as `tool.check` or `prompt.submit`, without a `.catch`. The GitHub Actions workflow runs the same script,
then `scripts/test.sh`, which runs `claude plugin test` on every plugin that
has tests, then `scripts/typecheck.sh`, which type-checks every plugin, on
pushes to `main` and on pull requests. Run them locally before committing.

`scripts/mutants.sh` puts each fixed bug in `scripts/mutants/` back, one at a
time, and fails if the tests still pass. A second workflow, `mutants.yml`,
runs it on pull requests that touch hooks, tests, `plugin.json` or
`scripts/`, and weekly.

## Conventions

- Keep the marketplace `name` stable; install commands use it. It is
  `astrosteveo-plugins` rather than the repository name because
  `claude plugin validate` rejects marketplace names that start with
  `claude-plugins` as impersonating an official Anthropic marketplace.
- Use lowercase hyphenated plugin names and semantic versions such as
  `0.1.0`.
- Keep component paths relative to the plugin root, starting with `./`.
- Use `claude plugin tag plugins/my-plugin` to create a `my-plugin--v0.1.0`
  release tag once the manifest and marketplace entry agree.

## References

- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
- [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference)

## License

[MIT](LICENSE).
