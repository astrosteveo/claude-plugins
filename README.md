# Claude Plugins

A [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
maintained by astrosteveo.

## Available plugins

| Plugin | What it does |
| --- | --- |
| [issue-board](plugins/issue-board) | Open GitHub issues and pull requests in a pane and under the prompt, with acceptance progress and CI, and a button that hands an issue to Claude. |
| [ask](plugins/ask) | Ask Claude a side question or for prompt ideas; it answers in a pane, in the background, and nothing lands in the chat. |

## Requirements

The plugins here are mods: plugins of function hooks that draw panes and hook
Claude Code's events. They need Claude Code v2.1.287 or later. Mods are an
early access part of Claude Code: their API may change between releases, and
a release may break a mod until it is updated.

The issue board changes some things by itself and adds to Claude's prompts.
Its README lists each, with its setting and default:
[What the board changes, and how to turn it off](plugins/issue-board/README.md#what-the-board-changes-and-how-to-turn-it-off).

## Install

Inside Claude Code, add the marketplace from GitHub and install a plugin:

```text
/plugin marketplace add astrosteveo/claude-plugins
/plugin install issue-board@astrosteveo-plugins
```

From a local checkout, register the checkout directory instead:

```text
/plugin marketplace add /path/to/claude-plugins
/plugin install issue-board@astrosteveo-plugins
```

The same commands work from a shell as `claude plugin marketplace add ...` and
`claude plugin install ...`. Restart Claude Code or run `/reload-plugins` after
installing. Plugin skills are namespaced as `/<plugin>:<skill>`.

To try a plugin without installing it, start Claude Code with the plugin
directory: `claude --plugin-dir ./plugins/my-plugin`.

## Structure

```text
.claude-plugin/
  marketplace.json            # Marketplace identity and ordered plugin catalog
plugins/                      # One directory per plugin
scripts/validate.sh           # Strict validation of the marketplace and every plugin
scripts/test.sh               # Every plugin's tests
scripts/typecheck.sh          # Type-check every plugin against the installed Claude Code
.github/workflows/validate.yml
CLAUDE.md                     # Guidance for Claude Code in this repository (AGENTS.md links to it)
```

Each plugin uses this layout:

```text
plugins/my-plugin/
  .claude-plugin/
    plugin.json               # Plugin identity and metadata
  README.md
  skills/                     # Optional skills, one directory each
    my-skill/
      SKILL.md
  agents/                     # Optional subagents, one Markdown file each
    my-agent.md
  hooks/hooks.json            # Optional hook configuration
  .mcp.json                   # Optional MCP server configuration
  scripts/                    # Optional supporting scripts
```

Only create the optional components a plugin uses. Claude Code discovers the
default component directories automatically; `plugin.json` only needs component
paths when the layout is non-standard. There is no root plugin manifest: this
repository is a catalog of plugins, each with its own manifest.

## Add a plugin

1. Create `plugins/my-plugin/.claude-plugin/plugin.json`:

   ```json
   {
     "$schema": "https://anthropic.com/claude-code/plugin.schema.json",
     "name": "my-plugin",
     "displayName": "My Plugin",
     "version": "0.1.0",
     "description": "Reusable workflows for my projects.",
     "author": {
       "name": "astrosteveo"
     },
     "keywords": ["workflow"]
   }
   ```

2. Add components. A skill lives at `plugins/my-plugin/skills/my-skill/SKILL.md`
   with YAML frontmatter (`name`, `description`) followed by its instructions.
   The description tells Claude when to use the skill, so make it specific. An
   agent lives at `plugins/my-plugin/agents/my-agent.md` with frontmatter
   (`name`, `description`, optional `tools`, `disallowedTools`, `skills`,
   `model`) followed by its system prompt.

3. Append an entry to the `plugins` array in `.claude-plugin/marketplace.json`:

   ```json
   {
     "name": "my-plugin",
     "source": "./plugins/my-plugin",
     "description": "Reusable workflows for my projects.",
     "version": "0.1.0",
     "author": {
       "name": "astrosteveo"
     },
     "category": "productivity",
     "tags": ["workflow"]
   }
   ```

   Keep the entry name, plugin directory name, and manifest name identical, and
   keep the two `version` fields in sync. Array order controls display order.

4. Validate and try it:

   ```sh
   sh scripts/validate.sh
   claude --plugin-dir ./plugins/my-plugin
   ```

5. If the marketplace is already registered, refresh it and install the plugin:

   ```text
   /plugin marketplace update astrosteveo-plugins
   /plugin install issue-board@astrosteveo-plugins
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

## Conventions

- Keep the marketplace `name` stable; install commands use it. It is
  `astrosteveo-plugins` rather than the repository name because
  `claude plugin validate` rejects marketplace names that start with
  `claude-plugins` as impersonating an official Anthropic marketplace.
- Use lowercase hyphenated plugin, skill, and agent names and semantic versions
  such as `0.1.0`.
- Keep component paths relative to the plugin root, starting with `./`.
- Reference bundled files from skill and agent text with `${CLAUDE_PLUGIN_ROOT}`
  so paths resolve wherever the plugin is installed.
- Use `claude plugin tag plugins/my-plugin` to create a `my-plugin--v0.1.0`
  release tag once the manifest and marketplace entry agree.

## References

- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
- [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [Skills](https://code.claude.com/docs/en/skills)
- [Subagents](https://code.claude.com/docs/en/sub-agents)

## License

[MIT](LICENSE).
