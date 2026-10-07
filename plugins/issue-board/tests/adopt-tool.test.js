import { expect, mock, test } from 'claude-code/testing';
import { adoptReason, adoptTarget, approvedOf, linkedOf, releaseReason } from '../hooks/project';
import { approved, refused } from './engine';
import { PROJECT, graphPage, isIssuesQuery, settingsLog } from './graph';
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } };
const REPO = { root: '/work/void-sector', remote: null, internal: false, name: null };
// The board's project, as the writeProjects setting lists it.
const WRITES_8 = { options: { writeProjects: 'astrosteveo/8' } };
const TOOL = 'mcp__issue-board__project_adopt';
const ROADMAP = { id: 'PVT_9', number: 9, title: 'Roadmap', url: 'https://github.com/orgs/acme/projects/9', closed: false };
const OLD = { id: 'PVT_7', number: 7, title: 'Old plans', url: 'https://github.com/users/astrosteveo/projects/7', closed: true };
// What the engine answers beneath a plugin's tool once the permission check let the call through, and once the person
// said no. The test's own tool.call hook stands for the engine there.
const APPROVED = approved(TOOL);
const REFUSED = refused(TOOL);
const WARNING = [
    'Let the board write to Void Sector, owned by astrosteveo?',
    'Until you say yes, the board only reads it.',
    'Once you do, it sets Status and Priority, adds issues as items, archives items when asked, and posts status updates, as your settings and presses call for.',
    'Each write is a GitHub API call made with your gh token. The board reads GitHub every 5 minutes (the refresh setting).',
].join('\n');
const ok = (stdout) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } });
const ISSUES = [
    {
        number: 43,
        title: 'Edit issues',
        url: 'https://github.com/astrosteveo/void-sector/issues/43',
        labels: [],
        assignees: [],
        body: '## Acceptance\n- [ ] Edit issues works',
        updatedAt: '2026-10-05T10:00:00Z',
        status: 'Ready',
        priority: 'P1',
    },
];
// GitHub with project 8 as the board's, and projects 9 (open) and 7 (closed) also linked to the repo; the store held
// where the test can read it; the setting as the board last set it; and the engine's answer beneath the tool, approved
// unless the test says otherwise.
const world = (on, saved = {}) => {
    const state = { linkedReads: 0, mutations: 0, answer: APPROVED, kept: new Map(Object.entries(saved)) };
    on('process.run', async (_$, e) => {
        const argv = [...e.argv];
        const stdin = e.init?.stdin ?? '';
        if (argv[0] === 'git')
            return ok('main\n');
        if (isIssuesQuery(argv))
            return ok(graphPage(ISSUES, argv, true));
        if (argv[1] === 'repo')
            return ok(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }));
        if (argv[1] === 'api' && argv[2] === 'graphql') {
            if (/\bmutation\b/.test(`${argv.join(' ')} ${stdin}`))
                state.mutations += 1;
            if (stdin.includes('projectsV2(first: 20)')) {
                state.linkedReads += 1;
                return ok(JSON.stringify({ data: { repository: { projectsV2: { nodes: [PROJECT, ROADMAP, OLD] } } } }));
            }
            return ok(JSON.stringify({ data: {} }));
        }
        if (argv[1] === 'pr')
            return ok('[]');
        if (argv[1] === 'api' && argv[2]?.includes('/milestones'))
            return ok('[]');
        if (argv[1] === 'api')
            return ok('astrosteveo\n');
        return ok('[]');
    });
    on('store.get', async (_$, e) => ({ value: state.kept.get(e.key) }));
    on('store.set', async (_$, e) => {
        state.kept.set(e.key, e.value);
        return { value: undefined };
    });
    on('session.id', async () => ({ value: 'session-1' }));
    on('session.repo', async () => ({ value: REPO }));
    on('session.root', async () => ({ value: REPO.root }));
    on('ui.toast', async () => ({ value: undefined }));
    on('ui.log', async () => ({ value: undefined }));
    on('tool.call', { tool: TOOL }, async () => state.answer);
    on('tool.call', { tool: 'mcp__issue-board__issue_update' }, async (_$, e) => approved(e.tool));
    const set = settingsLog(on);
    const adopted = () => set.filter(one => one.key === 'issue-board.writeProjects').at(-1)?.value;
    return { state, adopted };
};
test('project_adopt asks with the full warning even when a rule allows it, and adopts the board project on yes', async ($, on) => {
    const { state, adopted } = world(on);
    // A settings rule that allows the tool.
    on('tool.check', async () => ({ decision: 'allow', rule: 'mcp__issue-board__project_adopt' }));
    await $.command.run(REFRESH);
    expect(await $.tool.check({ tool: TOOL, input: {} })).toEqual({ decision: 'ask', reason: WARNING });
    // Checking changed nothing.
    expect(adopted()).toBeUndefined();
    const called = await $.tool.call({ tool: TOOL });
    expect(called.result).toBe('The board may write to Void Sector now. Release it with project_adopt and release: true, or in /issues setup.');
    expect(adopted()).toEqual('astrosteveo/8');
    // The board's own project needed no read of the linked ones, and adopting writes nothing to GitHub.
    expect(state.linkedReads).toBe(0);
    expect(state.mutations).toBe(0);
});
test('a no to the prompt changes nothing and passes the refusal back', async ($, on) => {
    const { state, adopted } = world(on);
    await $.command.run(REFRESH);
    state.answer = REFUSED;
    const called = await $.tool.call({ tool: TOOL });
    expect(called).toMatchObject({ isError: true, text: REFUSED.text });
    expect(adopted()).toBeUndefined();
});
test('a no to the release prompt leaves the setting as it was', WRITES_8, async ($, on) => {
    const { state, adopted } = world(on);
    on('tool.check', async () => ({ decision: 'ask' }));
    await $.command.run(REFRESH);
    state.answer = REFUSED;
    expect(await $.tool.call({ tool: TOOL, release: true })).toMatchObject({ isError: true, text: REFUSED.text });
    expect(adopted()).toBeUndefined();
    expect((await $.tool.check({ tool: TOOL, input: { release: true } })).decision).toBe('ask');
});
test('project_adopt adopts a linked project by number beside the adopted one, and refuses one not linked', WRITES_8, async ($, on) => {
    const { state, adopted } = world(on);
    on('tool.check', async () => ({ decision: 'ask' }));
    await $.command.run(REFRESH);
    const check = await $.tool.check({ tool: TOOL, input: { number: 9 } });
    expect(check.decision).toBe('ask');
    expect(check.reason).toMatch(/^Let the board write to Roadmap, owned by acme\?\n/);
    expect(check.reason).not.toMatch(/Void Sector/);
    const called = await $.tool.call({ tool: TOOL, number: 9 });
    expect(called.result).toBe('The board may write to Roadmap now. Release it with project_adopt and release: true, or in /issues setup.');
    // Roadmap joins the list; Void Sector stays on it, and the board still writes there.
    expect(adopted()).toEqual('astrosteveo/8, acme/9');
    expect((await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, priority: 'P0' })).deny).toBeUndefined();
    expect(state.mutations).toBe(1);
    expect((await $.tool.call({ tool: TOOL, number: 9 })).deny).toBe('The board already writes to Roadmap; nothing changed.');
    // A number linked to nothing, and a closed project, are refused at the check and at the call, and nothing changes.
    for (const number of [12, 7]) {
        const refused = await $.tool.check({ tool: TOOL, input: { number } });
        expect(refused).toEqual({ decision: 'deny', reason: `Project ${number} isn't linked to astrosteveo/void-sector, so the board won't write to it. Link it to the repo on GitHub first, or run /issues setup.` });
        expect((await $.tool.call({ tool: TOOL, number })).deny).toBe(refused.reason);
    }
    expect(adopted()).toEqual('astrosteveo/8, acme/9');
    expect(state.mutations).toBe(1);
});
test('project_adopt with release releases the adopted project after asking, and has nothing to release after', WRITES_8, async ($, on) => {
    const { adopted } = world(on);
    on('tool.check', async () => ({ decision: 'allow' }));
    await $.command.run(REFRESH);
    expect(await $.tool.check({ tool: TOOL, input: { release: true } })).toEqual({
        decision: 'ask',
        reason: 'Stop the board writing to Void Sector, owned by astrosteveo?\nIt only reads the project again until someone lets it write.',
    });
    expect((await $.tool.call({ tool: TOOL, release: true })).result).toBe('Released Void Sector: the board only reads it now.');
    expect(adopted()).toEqual('');
    // Writes are refused again, at once.
    expect((await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, priority: 'P0' })).deny).toMatch(/only reads Void Sector/);
    expect((await $.tool.check({ tool: TOOL, input: { release: true } })).decision).toBe('deny');
    expect((await $.tool.call({ tool: TOOL, release: true })).deny).toBe("The board writes to no project for this repo, so there's nothing to release.");
});
test('a rule that denies stands, a subagent is refused, and so are auto and bypass mode, where nobody would see the prompt', async ($, on) => {
    const { adopted } = world(on);
    let beneath = 'deny';
    on('tool.check', async () => ({ decision: beneath, reason: 'beneath' }));
    on('classic.UserPromptSubmit', async () => ({}));
    await $.command.run(REFRESH);
    expect(await $.tool.check({ tool: TOOL, input: {} })).toEqual({ decision: 'deny', reason: 'beneath' });
    beneath = 'allow';
    const sub = await $.tool.check({ tool: TOOL, input: {}, agentId: 'a-1' });
    expect(sub.decision).toBe('deny');
    expect(sub.reason).toMatch(/nobody watches a subagent's permission prompts/);
    await $.classic.UserPromptSubmit({ prompt: 'let the board write to the project', permission_mode: 'auto' });
    const auto = await $.tool.check({ tool: TOOL, input: {} });
    expect(auto.decision).toBe('deny');
    expect(auto.reason).toMatch(/^The auto permission mode settles prompts without showing them/);
    await $.classic.UserPromptSubmit({ prompt: 'and now?', permission_mode: 'default' });
    expect((await $.tool.check({ tool: TOOL, input: {} })).decision).toBe('ask');
    // Bypass mode lets every call through without a prompt, so the warning would go unseen.
    await $.classic.UserPromptSubmit({ prompt: 'let it write', permission_mode: 'bypassPermissions' });
    const bypass = await $.tool.check({ tool: TOOL, input: {} });
    expect(bypass).toEqual({
        decision: 'deny',
        reason: 'The bypassPermissions permission mode settles prompts without showing them, and this one needs the person to read it. ' +
            'Ask the person to press Let it write in /issues, or to run /issues setup. Or switch to a mode that asks, and try again.',
    });
    expect((await $.tool.check({ tool: TOOL, input: { release: true } })).decision).toBe('deny');
    await $.classic.UserPromptSubmit({ prompt: 'and now?', permission_mode: 'default' });
    expect((await $.tool.check({ tool: TOOL, input: {} })).decision).toBe('ask');
    expect(adopted()).toBeUndefined();
});
test('the tool says to use it only when the person asks, and /issues help lists it', async ($, on) => {
    world(on);
    const clock = mock.clock(on, { now: Date.parse('2026-10-06T10:00:00Z') });
    const registered = [];
    on('session.start', async (_$, e) => ({ cwd: e.cwd }));
    on('command.register', async (_$, e) => ({ value: { command: e.name } }));
    on('agent.register', async (_$, e) => ({ value: { agent: `issue-board:${e.name}` } }));
    on('tool.register', async (_$, e) => {
        registered.push({ name: e.name, description: e.description });
        return { value: { tool: `mcp__issue-board__${e.name}` } };
    });
    await $.session.start({ cwd: REPO.root, surface: 'terminal', isInteractive: true });
    await clock.settle();
    const tool = registered.find(one => one.name === 'project_adopt');
    expect(tool?.description).toMatch(/Call it only when the person asks you to let the board write to a project, or to release one; never on your own/);
    expect((await $.command.run({ ...REFRESH, args: 'help' })).text).toMatch(/project_adopt/);
});
test('the target is the board project or a linked one by number; the prompt and the approval read as they should', () => {
    const reads = { id: 'PVT_8', number: 8, title: 'Void Sector', url: PROJECT.url };
    const roadmap = { id: 'PVT_9', number: 9, title: 'Roadmap', url: ROADMAP.url };
    expect(adoptTarget(reads, [], undefined, 'a/b')).toBe(reads);
    expect(adoptTarget(reads, [], 8, 'a/b')).toBe(reads);
    expect(adoptTarget(reads, [roadmap], 9, 'a/b')).toBe(roadmap);
    expect(adoptTarget(null, [], undefined, 'a/b')).toBe('The board reads no project for a/b. Name a project linked to the repo by its number, or run /issues setup.');
    expect(linkedOf({ repository: { projectsV2: { nodes: [PROJECT, ROADMAP, OLD, null] } } }).map(one => one.number)).toEqual([8, 9]);
    expect(linkedOf(null)).toEqual([]);
    expect(adoptReason(reads, 5)).toBe(WARNING);
    expect(releaseReason({ key: 'acme/9', number: 9, id: 'PVT_9', title: 'Roadmap', owner: 'acme' })).toBe('Stop the board writing to Roadmap, owned by acme?\nIt only reads the project again until someone lets it write.');
    expect(approvedOf(APPROVED)).toBe(true);
    expect(approvedOf(REFUSED)).toBe(false);
    expect(approvedOf({ deny: 'no' })).toBe(false);
    expect(approvedOf({ result: 'served by someone else' })).toBe(false);
});
