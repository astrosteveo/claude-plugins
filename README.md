# Claude Plugins

A [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
maintained by astrosteveo.

## Available plugins

| Plugin | Purpose |
| --- | --- |
| [File Tree](plugins/file-tree/README.md) | A mod: a pane with the project's file tree that marks the files Claude creates or changes and shows their diffs, without leaving the terminal. |
| [Consult](plugins/consult/README.md) | A mod: `/consult` asks a side copy of Claude how to answer it, or writes your next prompt, without adding to the main chat. |
| [Memsync](plugins/memsync/README.md) | A mod: syncs auto memory, `CLAUDE.md` and user skills across machines through your own private git repo, with a `/memsync` pane that shows the sync state. |
| [Plain English](plugins/plain-english/README.md) | A mod: makes Claude write plain, literal English, flags figurative phrases under a reply, and replaces the Plain Language output style. |
| [Token Weather](plugins/token-weather/README.md) | A mod: a live forecast of the context window in the band above the prompt, with how full it is, the last 12 turns and what the last turn added. |
| [Next Prompts](plugins/next-prompts/README.md) | A mod: 3 suggested next prompts above the prompt after each reply. Type 1, 2 or 3 to send one, or 0 to dismiss the list. |

## Install

Inside Claude Code, add the marketplace from GitHub and install a plugin:

```text
/plugin marketplace add astrosteveo/claude-plugins
/plugin install file-tree@astrosteveo-plugins
```

From a local checkout, register the checkout directory instead:

```text
/plugin marketplace add /path/to/claude-plugins
/plugin install file-tree@astrosteveo-plugins
```

The same commands work from a shell as `claude plugin marketplace add ...` and
`claude plugin install ...`. Restart Claude Code or run `/reload-plugins` after
installing. Plugin skills are namespaced as `/<plugin>:<skill>`.

To try a plugin without installing it, start Claude Code with the plugin
directory: `claude --plugin-dir ./plugins/file-tree`.

## Structure

```text
.claude-plugin/
  marketplace.json            # Marketplace identity and ordered plugin catalog
plugins/                      # One directory per plugin
scripts/validate.sh           # Strict validation of the marketplace and every plugin
.github/workflows/validate.yml
docs/prompts/                 # Reusable prompts for maintaining this repository
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
   /plugin install my-plugin@astrosteveo-plugins
   ```

## Validate

`scripts/validate.sh` runs `claude plugin validate --strict` on the marketplace
manifest and on every directory under `plugins/`. The GitHub Actions workflow
runs the same script on pushes to `main` and on pull requests. Run it locally
before committing.

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
