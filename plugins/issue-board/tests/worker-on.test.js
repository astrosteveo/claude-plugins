import { expect, mock, test } from 'claude-code/testing';
import { workerOnLine } from '../hooks/parse';
import { adoptedStore, graphPage, isIssuesQuery } from './graph';
// While a background agent is on an issue, its card shows the agent in place of every start button, whoever started
// the agent, and the buttons come back once it ends (#269).
const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } };
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 }, command: 'issues' };
const EPIC = { number: 35, title: 'Make the issue board a full issue tracker', total: 2, completed: 1 };
// Epic #35, whose card starts its ready sub-issue #43, and a plain ready issue, #50.
const ISSUES = [
    { number: 35, title: EPIC.title, labels: [], body: 'The whole.', updatedAt: '2026-10-05T00:00:00Z', subIssues: { total: 2, completed: 1 }, status: 'Ready', priority: 'P1' },
    { number: 43, title: 'Edit issues from the board', labels: [], body: '- [ ] Edit\n- [ ] Save', updatedAt: '2026-10-05T00:00:00Z', parent: EPIC, status: 'Ready', priority: 'P1' },
    { number: 50, title: 'Show the worker on the card', labels: [], body: '- [ ] Show it', updatedAt: '2026-10-05T00:00:00Z', status: 'Ready', priority: 'P1' },
];
// Claude's own Agent tool call for the board's worker, which the board follows by the issue its description names.
const dispatched = (number) => ({
    tool_use_id: 'toolu_1',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
    subagentType: 'issue-board:worker',
    description: `#${number} ${ISSUES.find(one => one.number === number)?.title}`,
    prompt: `Let's start on #${number}.`,
});
const BUTTONS = (number) => [`start-${number}`, `background-${number}`, `draft-${number}`, `draft-background-${number}`];
// GitHub with the project, and one agent whose status the test moves.
const world = async ($, on, open) => {
    adoptedStore(on);
    const clock = mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') });
    const agent = { status: 'running', description: '' };
    on('session.root', async () => ({ value: '/work/void-sector' }));
    on('process.run', async (_$, e) => {
        const answer = (stdout) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } });
        const argv = [...e.argv];
        if (argv[0] === 'git')
            return answer('main\n');
        if (isIssuesQuery(argv))
            return answer(graphPage(ISSUES, argv, true));
        if (argv[1] === 'repo')
            return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/claude-plugins', hasIssuesEnabled: true }));
        if (argv[1] === 'api' && argv[2] === 'graphql' && argv.some(arg => arg.includes('updateProjectV2ItemFieldValue'))) {
            const item = argv.find(arg => arg.startsWith('item='))?.slice('item=PVTI_'.length) ?? '';
            return answer(JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: item } } } }));
        }
        if (argv[1] === 'api' && argv[2] === 'user')
            return answer('astrosteveo\n');
        return answer('[]');
    });
    on('session.id', async () => ({ value: 'session-1' }));
    on('ui.open', async () => ({ value: { isPlaced: true } }));
    on('ui.toast', async () => ({ value: undefined }));
    on('ui.log', async () => ({ value: undefined }));
    on('prompt.submit', async (_$, e) => ({ text: e.text }));
    on('agent.spawn', async (_$, e) => {
        agent.description = e.description;
        return { model: 'claude-sonnet-5-5', agentId: 'agent-1' };
    });
    on('agent.list', async () => ({ value: [{ id: 'agent-1', description: agent.description, type: 'issue-board:worker', status: agent.status }] }));
    await $.command.run({ ...RUN, args: 'refresh' });
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    await ui.press({ key: 'filter-all' });
    await ui.press({ key: `issue-${open}` });
    // The agent ends: the board sees it on its next look at the agents.
    const end = async () => {
        agent.status = 'completed';
        await clock.advance(10000);
    };
    return { ui, clock, end };
};
const buttonsShown = async (ui, number) => (await Promise.all(BUTTONS(number).map(key => ui.find({ key })))).map(Boolean);
test('the line names the agent, its status and its age, and an epic names the sub-issue', () => {
    expect(workerOnLine('running', '4m')).toBe('⚙ Worker on it · working 4m');
    expect(workerOnLine('waiting', 'now', 43)).toBe('⚙ Worker on #43 · waiting now');
    expect(workerOnLine('pending', '')).toBe('⚙ Worker on it · working');
});
test('Start in background: the card shows the agent instead of the start buttons, and they come back when it ends', async ($, on) => {
    const { ui, clock, end } = await world($, on, 50);
    expect(await buttonsShown(ui, 50)).toEqual([true, true, true, true]);
    await ui.press({ key: 'background-50' });
    await clock.settle();
    expect(await buttonsShown(ui, 50)).toEqual([false, false, false, false]);
    expect(await ui.find({ text: '⚙ Worker on it · working now' })).toBeDefined();
    await end();
    expect(await ui.find({ text: /^⚙ Worker on / })).toBeUndefined();
    expect(await buttonsShown(ui, 50)).toEqual([true, true, true, true]);
    await ui.unmount();
});
test('a worker Claude dispatched: the card shows it instead of the start buttons, and they come back when it ends', async ($, on) => {
    const { ui, clock, end } = await world($, on, 50);
    await $.agent.spawn(dispatched(50));
    await clock.settle();
    expect(await buttonsShown(ui, 50)).toEqual([false, false, false, false]);
    expect(await ui.find({ text: '⚙ Worker on it · working now' })).toBeDefined();
    await end();
    expect(await ui.find({ text: /^⚙ Worker on / })).toBeUndefined();
    expect(await buttonsShown(ui, 50)).toEqual([true, true, true, true]);
    await ui.unmount();
});
test("an epic's card follows the sub-issue its Start starts, from either kind of start", async ($, on) => {
    const { ui, clock, end } = await world($, on, 35);
    expect(await ui.find({ key: 'start-35' })).toMatchObject({ text: '▶ Start #43' });
    // Claude dispatches a worker on #43: the epic's card names it in place of its buttons.
    await $.agent.spawn(dispatched(43));
    await clock.settle();
    expect(await buttonsShown(ui, 35)).toEqual([false, false, false, false]);
    expect(await ui.find({ text: '⚙ Worker on #43 · working now' })).toBeDefined();
    await end();
    expect(await buttonsShown(ui, 35)).toEqual([true, true, true, true]);
    await ui.unmount();
});
test("an epic's Start in background hides its buttons until the sub-issue's agent ends", async ($, on) => {
    const { ui, clock, end } = await world($, on, 35);
    await ui.press({ key: 'background-35' });
    await clock.settle();
    expect(await buttonsShown(ui, 35)).toEqual([false, false, false, false]);
    expect(await ui.find({ text: '⚙ Worker on #43 · working now' })).toBeDefined();
    await end();
    expect(await buttonsShown(ui, 35)).toEqual([true, true, true, true]);
    await ui.unmount();
});
