// The board's tools that change something. Each asks, then acts: it calls next(e) first, and the engine beneath runs
// the permission check. A test has no engine beneath the plugins, so it answers for it here.
export const WRITE_TOOLS = ['tick', 'issue_update', 'issue_create', 'capture', 'milestone', 'project_status', 'project_archive', 'project_adopt', 'project_plan'].map(name => `mcp__issue-board__${name}`);
// What the engine answers beneath a plugin's tool once the permission check let the call through: no hook served it.
export const approved = (tool) => {
    const text = `issue-board registered the tool ${tool.replace('mcp__issue-board__', '')} but no tool.call hook answered this call`;
    return { result: `Error: ${text}`, text, isError: true };
};
// What it answers once the person said no.
export const refused = (tool) => {
    const text = `Permission to use ${tool} was denied`;
    return { result: `Error: ${text}`, text, isError: true };
};
// The engine beneath the board's write tools, letting every call through, for tests that aren't about permissions.
export const letThrough = (on) => {
    on('tool.call', { tool: WRITE_TOOLS }, async (_$, e) => approved(e.tool));
};
// The engine's permission check beneath the board's write tools. `beneath` is its own verdict under the board's
// tool.check hooks: ask, as with no rule, or a rule's allow or deny. A test's hook can't ask tool.check itself, so the
// test asks it before each call and keeps the verdict in `verdict`. A call left at ask goes to the person, who answers
// `answer`, and each prompt is kept in `asked`.
export const permissions = (on) => {
    const state = { answer: 'yes', asked: [], beneath: 'ask', verdict: 'allow' };
    on('tool.check', { tool: WRITE_TOOLS }, async () => (state.beneath === 'deny' ? { decision: 'deny', reason: 'Denied by a rule.' } : { decision: state.beneath }));
    on('tool.call', { tool: WRITE_TOOLS }, async (_$, e) => {
        if (state.verdict === 'ask')
            state.asked.push(e.tool);
        const through = state.verdict === 'allow' || (state.verdict === 'ask' && state.answer === 'yes');
        return through ? approved(e.tool) : refused(e.tool);
    });
    return state;
};
