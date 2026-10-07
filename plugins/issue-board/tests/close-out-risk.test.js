import { expect, test } from 'claude-code/testing';
import { closeOutRisk, parsePrs, workerOfPr } from '../hooks/parse';
// A pull request's row shows a ⚙ while a background agent owns its branch, and its Finish & merge asks first, naming
// why, while that agent works or its CI is running or failing. A clean pull request goes straight to Claude (#264).
const REPO = 'astrosteveo/void-sector';
const pr = (number, title, conclusion, body) => ({
    number,
    title,
    url: `https://github.com/${REPO}/pull/${number}`,
    headRefName: `fix/${number}-branch`,
    isDraft: false,
    statusCheckRollup: conclusion ? [{ name: 'test', status: 'COMPLETED', conclusion }] : [{ name: 'test', status: 'IN_PROGRESS' }],
    reviewDecision: null,
    additions: 1,
    deletions: 1,
    author: { login: 'astrosteveo' },
    updatedAt: '2026-10-03T20:00:00Z',
    body,
});
// #401 is for #50, which a background agent is on; #402's CI is still running; #403 is clean.
const PRS = [pr(401, 'Show the worker on the card', 'SUCCESS', 'Refs #50'), pr(402, 'Tune the docking lane', null, 'Refs #51'), pr(403, 'Glide in to a planet', 'SUCCESS', 'Closes #52')];
const WORKER = { number: 50, title: 'Show the worker on the card', agentId: 'agent-1', status: 'running', startedAt: Date.now(), answer: null };
const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } };
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } };
test('the risk of closing out names a working agent and CI that has not passed, and nothing for a clean pull request', () => {
    const [owned, pending, clean] = parsePrs(JSON.stringify(PRS));
    expect(workerOfPr(owned, [WORKER])).toEqual(WORKER);
    // An agent that ended no longer owns the branch.
    expect(workerOfPr(owned, [{ ...WORKER, status: 'completed' }])).toBeUndefined();
    expect(workerOfPr(clean, [WORKER])).toBeUndefined();
    expect(closeOutRisk(owned, WORKER)).toBe('A background agent is still on #50 and may push to its branch.');
    expect(closeOutRisk(pending)).toBe('Its CI is still running.');
    expect(closeOutRisk({ ...owned, ci: 'fail' }, WORKER)).toBe('A background agent is still on #50 and may push to its branch, and its CI is failing.');
    expect(closeOutRisk(clean)).toBeNull();
});
test('Finish & merge asks first on a worker-owned or pending pull request, and sends a clean one at once', async ($, on) => {
    on('process.run', async (_$, e) => {
        const argv = [...e.argv];
        const answer = (stdout) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } });
        if (argv[0] === 'git')
            return answer('main\n');
        if (argv[1] === 'repo')
            return answer(JSON.stringify({ nameWithOwner: REPO, hasIssuesEnabled: true }));
        if (argv[1] === 'pr' && argv[2] === 'list')
            return answer(argv.includes('merged') ? '[]' : JSON.stringify(PRS));
        return answer('[]');
    });
    on('ui.toast', async () => ({ value: undefined }));
    on('ui.log', async () => ({ value: undefined }));
    const sent = [];
    on('prompt.submit', async (_$, e) => {
        sent.push(e.text);
        return { text: e.text };
    });
    // The board's state, held here so the test can put a background agent on it. A drawing isn't drawn again when the
    // state changes, so each look mounts the pane afresh.
    const held = new Map();
    on('state.get', async (_$, e) => ({ value: held.get(`${e.plugin}/${e.key}`) ?? { value: undefined, version: 0 } }));
    on('state.set', async (_$, e) => {
        const version = (held.get(`${e.plugin}/${e.key}`)?.version ?? 0) + 1;
        held.set(`${e.plugin}/${e.key}`, { value: e.value, version });
        return { value: { isSet: true, version } };
    });
    await $.command.run(REFRESH);
    held.set('issue-board/workers', { value: [WORKER], version: 1 });
    const mount = () => $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    const look = async (then) => {
        const ui = await mount();
        await then(ui);
        await ui.unmount();
    };
    // Only the worker-owned row shows the ⚙.
    await look(async (ui) => {
        const marked = async (number) => JSON.stringify((await ui.find({ key: `pr-row-${number}` })) ?? null).includes('⚙');
        expect([await marked(401), await marked(402), await marked(403)]).toEqual([true, false, false]);
    });
    // The worker-owned pull request asks, names the agent, and Cancel sends nothing.
    await look(ui => ui.press({ key: 'close-out-401' }));
    expect(sent).toEqual([]);
    await look(async (ui) => {
        expect(await ui.find({ text: 'Close out PR #401 anyway? A background agent is still on #50 and may push to its branch.' })).toBeDefined();
        await ui.press({ key: 'close-out-no-401' });
    });
    await look(async (ui) => expect(await ui.find({ key: 'close-out-ask-401' })).toBeUndefined());
    expect(sent).toEqual([]);
    // The pull request whose CI is running asks too, and Close out anyway sends it.
    await look(ui => ui.press({ key: 'close-out-402' }));
    expect(sent).toEqual([]);
    await look(async (ui) => {
        expect(await ui.find({ text: 'Close out PR #402 anyway? Its CI is still running.' })).toBeDefined();
        await ui.press({ key: 'close-out-yes-402' });
    });
    expect(sent).toEqual([expect.stringMatching(/^Close out PR #402: /)]);
    await look(async (ui) => expect(await ui.find({ key: 'close-out-ask-402' })).toBeUndefined());
    // A clean pull request goes at once.
    await look(ui => ui.press({ key: 'close-out-403' }));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/^Close out PR #403: /);
});
