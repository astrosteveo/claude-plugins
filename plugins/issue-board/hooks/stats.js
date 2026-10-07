// What the board costs while it runs, for /issues stats: the GitHub calls it makes, the GraphQL points they spend, and
// the characters it adds to Claude's context. The counts live in memory and start over when the plugin loads.
// Per-hour rates show only after this long. Scaled up from a few seconds, a handful of calls reads as hundreds an hour.
export const RATE_AFTER = 10 * 60000;
export const CAUSES = ['full read', 'poll', 'write', 'tool', 'setup', 'other'];
export const newStats = (startedAt) => ({ startedAt, calls: {}, points: 0, remaining: null, resetAt: null, context: {}, lastRead: null, tools: {}, prompts: 0 });
const zero = () => ({ rest: 0, rest304: 0, graphql: 0 });
// How GitHub counts one gh command. `gh api` is REST unless it calls graphql. gh's issue, pr and repo view commands,
// and `label list`, ask GraphQL; `label create`, `repo edit`, `run` and `auth` use REST. One command counts as one call,
// though gh may make more than one request for it.
export const kindOf = (args) => {
    const [command, sub] = args;
    if (command === 'api')
        return args.includes('graphql') ? 'graphql' : 'rest';
    if (command === 'auth' || command === 'run')
        return 'rest';
    if (command === 'label')
        return sub === 'list' ? 'graphql' : 'rest';
    if (command === 'repo')
        return sub === 'edit' ? 'rest' : 'graphql';
    return 'graphql';
};
export const countCall = (stats, cause, kind) => {
    const tally = (stats.calls[cause] ??= zero());
    tally[kind] += 1;
};
export const countContext = (stats, source, characters) => {
    if (characters <= 0)
        return;
    stats.context[source] = (stats.context[source] ?? 0) + characters;
};
// A tool the board registered. Its text counts as context only once it is loaded.
export const defineTool = (stats, name, characters) => {
    stats.tools[name] = { characters, loaded: stats.tools[name]?.loaded ?? false };
};
// A tool's definition went into Claude's context: listed in the prompt, found through ToolSearch, or called. It
// counts once, though a new conversation may need it loaded again.
export const loadTool = (stats, name) => {
    const tool = stats.tools[name];
    if (!tool || tool.loaded)
        return;
    tool.loaded = true;
    countContext(stats, 'tool definitions', tool.characters);
};
// The tools a ToolSearch call loaded, from its result's `matches`.
export const matchesOf = (result) => {
    const matches = result?.matches;
    return Array.isArray(matches) ? matches.filter((one) => typeof one === 'string') : [];
};
export const countPrompt = (stats) => {
    stats.prompts += 1;
};
// A page of the issues query: what its `rateLimit` cost, and what is left.
export const countPoints = (stats, limit) => {
    stats.points += limit.cost;
    stats.remaining = limit.remaining;
    stats.resetAt = limit.resetAt;
};
export const sumOf = (tallies) => tallies.reduce((sum, one) => ({ rest: sum.rest + (one?.rest ?? 0), rest304: sum.rest304 + (one?.rest304 ?? 0), graphql: sum.graphql + (one?.graphql ?? 0) }), zero());
export const totalOf = (stats) => sumOf(Object.values(stats.calls));
export const minus = (after, before) => ({ rest: after.rest - before.rest, rest304: after.rest304 - before.rest304, graphql: after.graphql - before.graphql });
const callsOf = (tally) => tally.rest + tally.rest304 + tally.graphql;
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
// A count per hour over the time since the counts began, or nothing before RATE_AFTER.
const hourly = (count, elapsed) => {
    if (elapsed < RATE_AFTER)
        return [];
    const rate = (count * 3600000) / elapsed;
    return [`${rate > 0 && rate < 10 ? rate.toFixed(1) : grouped(Math.round(rate))} an hour`];
};
const plural = (count, one) => `${grouped(count)} ${one}${count === 1 ? '' : 's'}`;
const ago = (ms) => {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1)
        return 'under a minute';
    if (minutes < 60)
        return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};
export const tallyText = (tally) => `REST ${tally.rest}, REST 304 ${tally.rest304}, GraphQL ${tally.graphql}`;
// What the board's tools take: all of them, and those loaded into Claude's context so far.
export const toolsText = (stats) => {
    const tools = Object.values(stats.tools);
    if (tools.length === 0)
        return 'Tool definitions: none registered.';
    const all = tools.reduce((sum, one) => sum + one.characters, 0);
    const loaded = tools.filter(one => one.loaded);
    const inContext = loaded.reduce((sum, one) => sum + one.characters, 0);
    const sofar = loaded.length === 0 ? 'none loaded yet' : `${loaded.length} loaded so far, ${grouped(inContext)} characters, counted in context added`;
    return `Tool definitions: ${grouped(all)} characters for ${plural(tools.length, 'tool')}, loaded when a tool is first used; ${sofar}.`;
};
// /issues stats: calls, points and context since the counts began, per hour once the board has run RATE_AFTER, and
// for the last full read. Context is also per prompt, which doesn't swell in the first minutes.
export const statsText = (stats, now) => {
    const elapsed = Math.max(0, now - stats.startedAt);
    const total = totalOf(stats);
    const calls = callsOf(total);
    const characters = Object.values(stats.context).reduce((sum, one) => sum + (one ?? 0), 0);
    const causes = CAUSES.flatMap(cause => {
        const tally = stats.calls[cause];
        return tally && callsOf(tally) > 0 ? [`- ${cause}: ${tallyText(tally)}`] : [];
    });
    const sources = Object.entries(stats.context).sort((a, b) => b[1] - a[1]).map(([source, count]) => `- ${source}: ${grouped(count)}`);
    const left = stats.remaining !== null && stats.resetAt ? ` ${grouped(stats.remaining)} left until ${new Date(stats.resetAt).toTimeString().slice(0, 5)}.` : '';
    const perPrompt = stats.prompts > 0 ? [`${grouped(Math.round(characters / stats.prompts))} a prompt over ${plural(stats.prompts, 'prompt')}`] : [];
    const last = stats.lastRead;
    return [
        `What the issue board cost since it loaded ${ago(elapsed)} ago.`,
        ...(elapsed < RATE_AFTER ? [`Per-hour rates show once it has been loaded ${RATE_AFTER / 60000} minutes.`] : []),
        '',
        `GitHub calls: ${[grouped(calls), ...hourly(calls, elapsed)].join(', ')} (${tallyText(total)})`,
        ...causes,
        `GraphQL points: ${[grouped(stats.points), ...hourly(stats.points, elapsed)].join(', ')}.${left}`,
        `Context added: ${[`${grouped(characters)} characters`, ...perPrompt, ...hourly(characters, elapsed)].join(', ')}`,
        ...sources,
        toolsText(stats),
        last ? `Last full read, ${ago(Math.max(0, now - last.at))} ago: ${tallyText(last.calls)}; ${grouped(last.points)} points.` : 'No full read has finished yet.',
    ].join('\n');
};
