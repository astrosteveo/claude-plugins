import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Friction, GateCheck, GeneRecord, Mutation } from '../types'
import { diagnosePrompt, GENETICIST_SYSTEM, geneticistPrompt, parsePlan } from './prompts'

const PANE = 'genome'
const AUTO_AFTER = 5
const GENETICIST = 'ouroboros:geneticist'
const GENE_PREFIX = 'ouroboros-gene-'
const BUSY = new Set(['diagnosing', 'mutating', 'gating'])
const SPARK = ' ▁▂▃▄▅▆▇█'
const CORRECTION =
  /^(no|nope|wrong|stop|wait|undo|revert)\b|\b(i said|i told you|i asked|not what i|you forgot|you didn'?t|why did you|don'?t|do not|again|instead)\b/i
const inert = (note: string) =>
  `import type { Register } from 'claude-code'\n\n// ${note}\nexport const register: Register = () => {}\n`
const PLACEHOLDER = inert('The geneticist writes this gene here.')
const INERT = inert('Excised by Ouroboros.')

const frictionRef = { plugin: 'ouroboros', key: 'friction' } as const
const genomeRef = { plugin: 'ouroboros', key: 'genome' } as const
const mutationRef = { plugin: 'ouroboros', key: 'mutation' } as const
const evolvedAtRef = { plugin: 'ouroboros', key: 'evolvedAt' } as const
const friction = atom(frictionRef, [])
const genome = atom(genomeRef, [])
const mutation = atom(mutationRef, null)

const ICON: Record<Friction['kind'], string> = {
  denied: '✗',
  error: '!',
  correction: '↩',
  interrupt: '■',
}

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const brief = (e: object): string => {
  const input = e as Record<string, unknown>
  const pick = input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.description
  return oneLine(typeof pick === 'string' ? pick : JSON.stringify(input), 100)
}

const tail = (text: string, lines: number): string => text.trimEnd().split('\n').slice(-lines).join('\n')

const parentOf = (root: string): string => root.replace(/\/+$/, '').replace(/\/[^/]+$/, '')

// A gene is a plugin of its own: these are its files, by path inside its folder.
const geneFiles = (id: string, title: string, source: string, test?: string): Record<string, string> => {
  const manifest = {
    $schema: 'https://anthropic.com/claude-code/plugin.schema.json',
    name: `${GENE_PREFIX}${id}`,
    displayName: `Ouroboros gene: ${title}`,
    version: '0.1.0',
    description: title,
    keywords: ['mod', 'ouroboros', 'gene'],
  }
  return {
    '.claude-plugin/plugin.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'hooks/hooks.json': '{ "modules": ["./register.ts"] }\n',
    'hooks/register.ts': source,
    ...(test === undefined ? {} : { [`tests/${id}.test.ts`]: test }),
  }
}

// A spliced gene type-checks against the types the engine lays beside it on load.
const SPLICED_TSCONFIG = '{\n  "extends": "./.claude-plugin/types/tsconfig.json"\n}\n'

// The marketplace Ouroboros was installed from, when it lives in one's `plugins/` folder.
type Market = { file: string; name: string }
type MarketEntry = { name?: unknown } & Record<string, unknown>
type MarketDoc = { name?: unknown; plugins?: MarketEntry[] } & Record<string, unknown>

const asDiff = (path: string, source: string): string => {
  const lines = source.replace(/\n$/, '').split('\n')
  return [`--- /dev/null`, `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map(l => `+${l}`)].join('\n')
}

const sparkline = (list: readonly Friction[], width: number): string => {
  const last = list.reduce((top, f) => Math.max(top, f.turn), 0)
  const counts = Array.from({ length: width }, (_, i) =>
    list.filter(f => f.turn === last - width + 1 + i).length,
  )
  const top = Math.max(1, ...counts)
  return counts.map(n => SPARK[Math.round((n / top) * (SPARK.length - 1))]).join('')
}

async function getMutation($: EngineInterface): Promise<Mutation | null> {
  return (await $.state.get(mutationRef)).value ?? null
}

async function refreshStatus($: EngineInterface): Promise<void> {
  const list = (await $.state.get(frictionRef)).value ?? []
  const genes = (await $.state.get(genomeRef)).value ?? []
  const m = await getMutation($)
  const phase = m && BUSY.has(m.status) ? ` · ${m.status}…` : m?.status === 'ready' ? ' · gene ready' : ''
  $.ui.status(`⟲ ${genes.length} genes · ${list.length} friction${phase}`)
}

async function record($: EngineInterface, f: Omit<Friction, 'at' | 'turn'>): Promise<void> {
  const entry: Friction = { ...f, at: await $.clock.now(), turn: await $.session.turns().catch(() => 0) }
  await update($, friction, list => [...(list ?? []), entry].slice(-200))
  const kept = ((await $.store.get('friction')) as Friction[] | undefined) ?? []
  await $.store.set('friction', [...kept, entry].slice(-200))
  await refreshStatus($)
}

async function fail($: EngineInterface, m: Mutation, note: string): Promise<void> {
  await $.state.set(mutationRef, { ...m, status: m.status === 'diagnosing' ? 'barren' : 'failed', note })
  $.ui.toast(`Ouroboros: ${note}`)
  await refreshStatus($)
}

async function check($: EngineInterface, name: string, argv: string[], timeoutMs = 120000): Promise<GateCheck> {
  try {
    const out = await $.process.run(argv, { timeoutMs })
    return { name, isPassed: out.exitCode === 0, tail: tail(`${out.stdout}\n${out.stderr}`, 12) }
  } catch (error) {
    return { name, isPassed: false, tail: String(error) }
  }
}

async function writeAll($: EngineInterface, dir: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) await $.fs.write(`${dir}/${path}`, text)
}

async function marketOf($: EngineInterface): Promise<Market | undefined> {
  const plugins = parentOf($.plugin.root)
  if (!plugins.endsWith('/plugins')) return undefined
  const file = `${parentOf(plugins)}/.claude-plugin/marketplace.json`
  if (!(await $.fs.exists(file))) return undefined
  try {
    const doc = JSON.parse(String(await $.fs.read(file))) as MarketDoc
    return typeof doc.name === 'string' ? { file, name: doc.name } : undefined
  } catch {
    return undefined
  }
}

async function editMarket($: EngineInterface, market: Market, edit: (entries: MarketEntry[]) => MarketEntry[]): Promise<void> {
  const doc = JSON.parse(String(await $.fs.read(market.file))) as MarketDoc
  await $.fs.write(market.file, `${JSON.stringify({ ...doc, plugins: edit(doc.plugins ?? []) }, null, 2)}\n`)
}

// Reloading picks up an installed or removed gene; the person can always run it by hand.
async function reloadPlugins($: EngineInterface): Promise<void> {
  try {
    await $.command.run({ command: 'reload-plugins' })
  } catch {
    $.ui.toast('Run /reload-plugins to load the change.')
  }
}

// List the gene in the marketplace and install it; answers what went wrong, if anything.
async function enlist($: EngineInterface, market: Market, gene: GeneRecord): Promise<string | undefined> {
  const name = `${GENE_PREFIX}${gene.id}`
  const own = JSON.parse(String(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))) as Record<string, unknown>
  const entry: MarketEntry = {
    name,
    source: `./plugins/${name}`,
    description: gene.title,
    version: '0.1.0',
    ...(own.author === undefined ? {} : { author: own.author }),
    category: 'productivity',
    tags: ['mod', 'ouroboros', 'gene'],
  }
  await editMarket($, market, entries => [...entries.filter(e => e.name !== name), entry])
  await $.process.run(['claude', 'plugin', 'marketplace', 'update', market.name], { timeoutMs: 60000 }).catch(() => undefined)
  const installed = await $.process.run(['claude', 'plugin', 'install', `${name}@${market.name}`], { timeoutMs: 60000 })
  if (installed.exitCode !== 0) return oneLine(installed.stderr || installed.stdout, 160)
  void reloadPlugins($)
  return undefined
}

async function delist($: EngineInterface, market: Market, id: string): Promise<void> {
  const name = `${GENE_PREFIX}${id}`
  await $.process.run(['claude', 'plugin', 'uninstall', `${name}@${market.name}`], { timeoutMs: 60000 }).catch(() => undefined)
  await editMarket($, market, entries => entries.filter(e => e.name !== name))
}

// The store is kept per install: carry the genome over from a copy of Ouroboros run before.
// Keys this store already has win, and the two friction logs are merged.
async function adoptStore($: EngineInterface): Promise<void> {
  if ((await $.store.get('genome')) !== undefined) return
  const dir = `${await $.env.get('HOME')}/.claude/plugins/store`
  const own = new RegExp(`^${$.plugin.name}_`)
  const files = (await $.fs.list(dir).catch(() => [])).filter(f => own.test(f.name)).sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const file of files) {
    try {
      const kept = JSON.parse(String(await $.fs.read(`${dir}/${file.name}`))) as Record<string, unknown>
      if (kept.genome === undefined) continue
      for (const [key, value] of Object.entries(kept)) {
        const mine = await $.store.get(key)
        if (key === 'friction' && Array.isArray(mine) && Array.isArray(value)) {
          const merged = [...(value as Friction[]), ...(mine as Friction[])].sort((a, b) => a.at - b.at)
          await $.store.set(key, merged.slice(-200))
        } else if (mine === undefined) {
          await $.store.set(key, value)
        }
      }
      $.ui.log(`Ouroboros adopted its genome from ${file.name}.`)
      return
    } catch {
      // Not a store this copy can read; try the next.
    }
  }
}

// Diagnose the friction, then hand the cure to a geneticist subagent working in a lab.
async function evolve($: EngineInterface): Promise<void> {
  const current = await getMutation($)
  if (current && BUSY.has(current.status)) {
    $.ui.toast('Ouroboros is already mutating.')
    return
  }
  const startedAt = await $.clock.now()
  const diagnosing: Mutation = { status: 'diagnosing', startedAt }
  await $.state.set(evolvedAtRef, startedAt)
  await $.state.set(mutationRef, diagnosing)
  await refreshStatus($)
  void $.ui.open({ id: PANE, title: 'Genome' })

  const log = (await $.state.get(frictionRef)).value ?? []
  const genes = (await $.state.get(genomeRef)).value ?? []
  const rejected = ((await $.store.get('rejected')) as string[] | undefined) ?? []
  const prompt = diagnosePrompt(log.slice(-60), genes, rejected)
  let reply = await $.model.fork({ prompt })
  if (!reply.isAnswered && reply.reason === 'nothing-to-fork') {
    reply = await $.model.complete({ model: 'opus', prompt, maxTokens: 2048 })
  }
  if (!reply.isAnswered) return fail($, diagnosing, `diagnosis failed (${reply.reason}).`)

  const plan = parsePlan(reply.text)
  if (plan === undefined) return fail($, diagnosing, 'the diagnosis was not a plan.')
  if ('none' in plan) return fail($, diagnosing, `nothing to evolve: ${plan.none}`)

  const base = plan.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'gene'
  const taken = new Set(genes.map(g => g.id))
  let id = base
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`

  const home = await $.env.get('HOME')
  const lab = `${home}/.claude/ouroboros/lab/${id}-${startedAt}`
  const planned: Mutation = { status: 'mutating', startedAt, id, title: plan.title, why: plan.why, spec: plan.spec, lab }
  await $.state.set(mutationRef, planned)
  await refreshStatus($)

  // The lab holds the gene's manifest and, where the engine laid the API types, a tsconfig.
  const api = `${$.plugin.root}/.claude-plugin/types`
  const hasTypes = await $.fs.exists(`${api}/claude-code/index.d.ts`)
  await writeAll($, lab, geneFiles(id, plan.title, PLACEHOLDER))
  if (hasTypes) {
    const tsconfig = {
      compilerOptions: {
        target: 'es2023',
        lib: ['es2023'],
        types: [],
        module: 'esnext',
        moduleResolution: 'bundler',
        strict: true,
        noUncheckedIndexedAccess: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: [`${api}/claude-code`, `${api}/claude-code-tools`, 'hooks', 'tests'],
    }
    await $.fs.write(`${lab}/tsconfig.json`, `${JSON.stringify(tsconfig, null, 2)}\n`)
  }

  const spawned = await $.agent.spawn({
    subagentType: GENETICIST,
    description: `Evolve gene ${id}`,
    prompt: geneticistPrompt({ ...plan, id }, lab, hasTypes ? `${api}/claude-code/index.d.ts` : `the .d.ts files under ${api}`),
  })
  if (spawned.deny !== undefined || spawned.agentId === undefined) {
    return fail($, planned, `the geneticist did not start${spawned.deny ? `: ${spawned.deny}` : '.'}`)
  }
  await $.state.set(mutationRef, { ...planned, agentId: spawned.agentId })
  $.ui.toast(`Mutating: ${plan.title}`)
}

// Put the gene's own manifest back as written and run every check on the lab.
async function gate($: EngineInterface): Promise<void> {
  const m = await getMutation($)
  if (!m || m.lab === undefined || m.id === undefined) return
  await $.state.set(mutationRef, { ...m, status: 'gating' })
  await refreshStatus($)

  const source = await $.fs.read(`${m.lab}/hooks/register.ts`).catch(() => undefined)
  const test = await $.fs.read(`${m.lab}/tests/${m.id}.test.ts`).catch(() => undefined)
  if (typeof source !== 'string' || source === PLACEHOLDER) return fail($, m, `the geneticist wrote no gene ${m.id}.`)
  const { 'hooks/register.ts': _written, ...manifest } = geneFiles(m.id, m.title ?? m.id, source)
  await writeAll($, m.lab, manifest)

  const checks = [
    await check($, 'validate', ['claude', 'plugin', 'validate', m.lab]),
    typeof test === 'string'
      ? await check($, 'tests', ['claude', 'plugin', 'test', m.lab], 300000)
      : { name: 'tests', isPassed: false, tail: 'no test was written' },
  ]
  if (await $.fs.exists(`${m.lab}/tsconfig.json`)) checks.push(await check($, 'types', ['tsc', '-p', m.lab]))

  const isPassed = checks.every(c => c.isPassed)
  const gated: Mutation = { ...m, status: isPassed ? 'ready' : 'failed', source, gate: checks }
  await $.state.set(mutationRef, typeof test === 'string' ? { ...gated, test } : gated)
  $.ui.toast(isPassed ? `Gene ready: ${m.title}. Review it with /ouroboros.` : `Gene ${m.id} failed its gate.`)
  await refreshStatus($)
}

// Splice: the gene becomes a plugin beside Ouroboros, which the engine loads as it lands.
async function accept($: EngineInterface): Promise<void> {
  const m = await getMutation($)
  if (m?.status !== 'ready' || !m.id || !m.source) return
  const title = m.title ?? m.id
  const files = geneFiles(m.id, title, m.source, m.test)
  const genes = (await $.state.get(genomeRef)).value ?? []
  const gene: GeneRecord = { id: m.id, title, why: m.why ?? '', acceptedAt: await $.clock.now() }
  const next = [...genes.filter(g => g.id !== m.id), gene]
  await $.store.set(`gene:${m.id}`, files)
  await $.store.set('genome', next)
  await $.state.set(genomeRef, next)
  await $.state.set(mutationRef, null)
  await writeAll($, `${parentOf($.plugin.root)}/${GENE_PREFIX}${m.id}`, { ...files, 'tsconfig.json': SPLICED_TSCONFIG })
  // In a mods folder the engine loads the new folder by itself; a marketplace installs it.
  const market = await marketOf($)
  const problem = market ? await enlist($, market, gene) : undefined
  $.ui.toast(problem ? `Spliced ${title}, but the install failed: ${problem}` : `Spliced: ${title}.`)
  await refreshStatus($)
}

async function reject($: EngineInterface): Promise<void> {
  const m = await getMutation($)
  if (m?.id) {
    const rejected = ((await $.store.get('rejected')) as string[] | undefined) ?? []
    await $.store.set('rejected', [...new Set([...rejected, m.id])])
  }
  await $.state.set(mutationRef, null)
  await refreshStatus($)
}

// Excise: silence the gene's hooks at once, then move its folder out of the mods.
async function excise($: EngineInterface, id: string): Promise<void> {
  const dir = `${parentOf($.plugin.root)}/${GENE_PREFIX}${id}`
  const next = ((await $.state.get(genomeRef)).value ?? []).filter(g => g.id !== id)
  await $.store.set('genome', next)
  await $.store.delete(`gene:${id}`)
  await $.state.set(genomeRef, next)
  const market = await marketOf($)
  if (await $.fs.exists(dir)) {
    await $.fs.write(`${dir}/hooks/register.ts`, INERT)
    if (market) await delist($, market, id)
    const home = await $.env.get('HOME')
    await $.process.run(['mkdir', '-p', `${home}/.claude/ouroboros/excised`])
    await $.process.run(['mv', dir, `${home}/.claude/ouroboros/excised/${id}-${await $.clock.now()}`])
  }
  if (market) void reloadPlugins($)
  $.ui.toast(`Excised: ${id}.`)
  await refreshStatus($)
}

// Bring the genome back from the store: a new session, or Ouroboros in a fresh mods folder.
// A marketplace keeps its genes in its own folder, so nothing is written there.
async function rehydrate($: EngineInterface): Promise<void> {
  if ((await $.state.get(genomeRef)).version !== 0) return
  const genes = ((await $.store.get('genome')) as GeneRecord[] | undefined) ?? []
  const kept = ((await $.store.get('friction')) as Friction[] | undefined) ?? []
  await $.state.set(genomeRef, genes)
  if (kept.length > 0) await $.state.set(frictionRef, kept)
  if (await marketOf($)) return
  for (const gene of genes) {
    const dir = `${parentOf($.plugin.root)}/${GENE_PREFIX}${gene.id}`
    if (await $.fs.exists(`${dir}/hooks/register.ts`)) continue
    const files = (await $.store.get(`gene:${gene.id}`)) as Record<string, string> | undefined
    if (files) await writeAll($, dir, files)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ouroboros',
      description: 'The Genome pane; `evolve` to mutate now, `auto on|off` for automatic evolution',
      argumentHint: '[evolve | auto on|off]',
    })
    await $.agent.register({
      name: 'geneticist',
      description: 'Writes one Ouroboros gene (a Claude Code hooks plugin) in a lab folder.',
      prompt: GENETICIST_SYSTEM,
      tools: ['Read', 'Write', 'Edit', 'Bash'],
      model: 'inherit',
      maxTurns: 60,
      omitClaudeMd: true,
    })
    await adoptStore($)
    await rehydrate($)
    await refreshStatus($)
    return next(e)
  })

  on('agent.offer', { agent: GENETICIST }, () => ({ isOffered: false }))

  on('command.run', { command: 'ouroboros' }, async ($, e) => {
    const [verb, arg] = e.args.trim().toLowerCase().split(/\s+/)
    if (verb === 'evolve') {
      void evolve($)
      return { text: 'Ouroboros is diagnosing the friction.' }
    }
    if (verb === 'auto') {
      await $.store.set('auto', arg !== 'off')
      return { text: `Automatic evolution ${arg === 'off' ? 'off' : `on (every ${AUTO_AFTER} friction)`}.` }
    }
    const opened = await $.ui.open({ id: PANE, title: 'Genome' })
    return { text: opened.isPlaced ? 'Genome pane opened.' : 'Widen the terminal to see the Genome pane.' }
  })

  // Sense: tool calls that were denied or failed.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined) return ran
    const tool = String(e.tool)
    if (ran.deny !== undefined) {
      await record($, { kind: 'denied', tool, detail: `${oneLine(ran.deny, 100)} ← ${brief(e)}` })
    } else if (ran.isError === true) {
      await record($, { kind: 'error', tool, detail: `${oneLine(ran.text ?? '', 140)} ← ${brief(e)}` })
    }
    return ran
  })

  // Sense: the person correcting course.
  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (isPerson && !e.text.startsWith('/') && CORRECTION.test(e.text)) {
      await record($, { kind: 'correction', detail: oneLine(e.text, 200) })
    }
    return next(e)
  })

  // Sense interrupts, notice the geneticist finishing, and evolve on enough friction.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const m = await getMutation($)
    if (e.agentId !== undefined) {
      if (m?.status === 'mutating' && m.agentId === e.agentId) void gate($)
      return done
    }
    if (e.isAborted) await record($, { kind: 'interrupt', detail: oneLine(e.answer || 'turn interrupted', 120) })
    const isAuto = (await $.store.get('auto')) !== false
    const since = (await $.state.get(evolvedAtRef)).value ?? 0
    const fresh = ((await $.state.get(frictionRef)).value ?? []).filter(f => f.at > since)
    if (isAuto && m === null && fresh.length >= AUTO_AFTER) void evolve($)
    return done
  })

  // Tell the model which evolved behaviours it is running under.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const genes = (await $.state.get(genomeRef)).value ?? []
    if (genes.length === 0) return composed
    const text = [
      '# Evolved harness behaviours (Ouroboros)',
      'This session runs hooks that evolved from earlier friction with this user. Expect them:',
      ...genes.map(g => `- ${g.title}: ${g.why}`),
    ].join('\n')
    return { ...composed, sections: [...composed.sections, { id: 'ouroboros:genome', text, scope: 'session' }] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const list = (await read($, friction)) ?? []
    const genes = (await read($, genome)) ?? []
    const m = await read($, mutation)
    const width = Math.max(10, Math.min(48, e.props.bodyColumns - 12))
    const shown = m?.id ? `${GENE_PREFIX}${m.id}/hooks/register.ts` : ''

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>
            ⟲ GENOME · {String(genes.length)} active · {String(list.length)} friction
          </Text>
          <Text>
            <Text dimColor>friction </Text>
            <Text color="red">{sparkline(list, width)}</Text>
          </Text>
          {list.length === 0 && <Text dimColor>Nothing has gone wrong yet. Ouroboros is watching.</Text>}
          {list.slice(-6).map(f => (
            <Text wrap="truncate-end">
              <Text color={f.kind === 'correction' ? 'yellow' : 'red'}>{ICON[f.kind]} </Text>
              <Text dimColor>
                {f.kind}
                {f.tool ? ` ${f.tool}` : ''}{' '}
              </Text>
              {f.detail}
            </Text>
          ))}
        </Box>

        {m !== null && (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={m.status === 'ready' ? 'green' : m.status === 'failed' ? 'red' : 'magenta'}
            paddingX={1}
          >
            <Text bold>
              Mutation · {m.status}
              {m.title ? `: ${m.title}` : ''}
            </Text>
            {m.why && <Text dimColor>{m.why}</Text>}
            {m.status === 'diagnosing' && <Text dimColor>Asking the session what keeps going wrong…</Text>}
            {m.status === 'mutating' && <Text dimColor>The geneticist is writing the gene in {m.lab ?? 'the lab'}…</Text>}
            {m.status === 'gating' && <Text dimColor>Validating, testing and type-checking the gene…</Text>}
            {m.note && <Text color="yellow">{m.note}</Text>}
            {(m.gate ?? []).map(c => (
              <Text>
                <Text color={c.isPassed ? 'green' : 'red'}>{c.isPassed ? '✓' : '✗'} </Text>
                {c.name}
                {!c.isPassed && <Text dimColor> {oneLine(c.tail, 200)}</Text>}
              </Text>
            ))}
            {m.source && <Code format="diff" path={shown} source={asDiff(shown, m.source)} />}
            <Box gap={1}>
              {m.status === 'ready' && (
                <Button key="accept" label="Accept" hotkey="a" variant="primary" onPress={() => void accept($)} />
              )}
              {m.status === 'mutating' && <Button key="gate" label="Gate now" hotkey="g" onPress={() => void gate($)} />}
              <Button key="reject" label={BUSY.has(m.status) ? 'Abandon' : 'Reject'} hotkey="r" onPress={() => void reject($)} />
            </Box>
          </Box>
        )}

        <Box flexDirection="column">
          <Text bold>Active genes</Text>
          {genes.length === 0 && <Text dimColor>None yet.</Text>}
          {genes.slice(0, 9).map((g, i) => (
            <Box gap={1}>
              <Button key={`excise:${g.id}`} label="Excise" hotkey={String(i + 1)} onPress={() => void excise($, g.id)} />
              <Text wrap="truncate-end">
                <Text color="green">{g.title}</Text>
                <Text dimColor> {g.why}</Text>
              </Text>
            </Box>
          ))}
        </Box>

        {(m === null || !BUSY.has(m.status)) && (
          <Button key="evolve" label="Evolve now" hotkey="e" onPress={() => void evolve($)} />
        )}
      </Box>
    )
  })
}
