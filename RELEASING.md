# Releasing

A plugin's version lives in one place: `version` in `plugins/<name>/.claude-plugin/plugin.json`. Entries in
`.claude-plugin/marketplace.json` carry no version. When both have one, Claude Code uses plugin.json and ignores the
entry without a word.

## Pull requests leave versions alone

Feature and fix pull requests never change `version`. Pull requests that run side by side would all take the same
next version, and each one after the first would need renumbering. The version changes once per release instead,
for a batch of merged changes.

## When to release

Release when merged changes should reach people who installed from GitHub
(`/plugin install <name> --marketplace astrosteveo/claude-plugins`). Their copy updates only when the version
changes. With the same version, `/plugin` reports the plugin as up to date and keeps the old code.

## How to release

On an up-to-date `main`, make a branch, then run:

```sh
node scripts/release.mjs <plugin> patch   # fixes only
node scripts/release.mjs <plugin> minor   # new features
```

The script runs `claude plugin validate --strict` on the marketplace and the plugin, sets the new version in its
plugin.json, and commits `Release <plugin> <version>`. Run it once per plugin you release. Then open a pull request
and merge it.

`claude plugin validate --strict .` fails when a marketplace entry declares a version that disagrees with its
plugin.json. Run it on its own any time.

## Getting a change into Claude Code

- **From this checkout.** The marketplace `astrosteveo-plugins` is registered from this folder, so plugins are read
  in place. A change applies on `/reload-plugins`, with no release needed. Run it after an edit, after switching
  branches, or after pulling `main`. A new plugin needs `/plugin install <name>@astrosteveo-plugins` first.
- **From GitHub.** After a release is merged, update the plugin from `/plugin`, or run
  `claude plugin update <name>@astrosteveo-plugins`, then `/reload-plugins`.
