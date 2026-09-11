# Claude Plugins

A [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
maintained by astrosteveo.

## Available plugins

| Plugin | Purpose |
| --- | --- |
| [Workflow](plugins/workflow/README.md) | A small software team for one request: an orchestrator routes work through discovery, planning, implementation, and independent review of both the plan and the code. Includes the planner, implementer, and reviewer agents. |
| [Claudex](plugins/claudex/README.md) | Pair Claude Code with the OpenAI Codex CLI. Claude drives; Codex consults, plans, implements in isolated git worktrees, and reviews. Includes the codex-liaison agent. |

## Install

Inside Claude Code, add the marketplace from GitHub and install a plugin:

```text
/plugin marketplace add astrosteveo/claude-plugins
/plugin install workflow@astrosteveo-plugins
```

From a local checkout, register the checkout directory instead:

```text
/plugin marketplace add /path/to/claude-plugins
/plugin install workflow@astrosteveo-plugins
```

The same commands work from a shell as `claude plugin marketplace add ...` and
`claude plugin install ...`. Restart Claude Code or run `/reload-plugins` after
installing. Plugin skills are namespaced as `/<plugin>:<skill>`, for example
`/workflow:orchestrate`.

To try a plugin without installing it, start Claude Code with the plugin
directory: `claude --plugin-dir ./plugins/workflow`.

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
