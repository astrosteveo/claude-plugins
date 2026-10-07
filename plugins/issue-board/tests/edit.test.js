import { expect, test } from 'claude-code/testing';
import { addBoxes, changesText, commandsOf, leftForDone, leftForVerification, movedText, rewordBoxes, statusOnly, unmovedText } from '../hooks/parse';
import { asksProject, graphPage, isIssuesQuery, optionId, adoptedStore } from './graph';
import { letThrough } from './engine';
const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } };
const RUN = { command: 'issues', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } };
test('a change becomes gh commands in order: the edit, then the comment, then the close', () => {
    expect(commandsOf(43, { addLabels: ['bug'], removeLabels: ['future'], assign: ['@me'], parent: 35, milestone: null, comment: ' Done here. ', close: 'not planned' })).toEqual([
        { argv: ['issue', 'edit', '43', '--add-label', 'bug', '--remove-label', 'future', '--add-assignee', '@me', '--parent', '35', '--remove-milestone'] },
        { argv: ['issue', 'comment', '43', '--body-file', '-'], stdin: 'Done here.' },
        { argv: ['issue', 'close', '43', '--reason', 'not planned'] },
    ]);
    expect(commandsOf(43, { parent: null, milestone: 'Launch', reopen: true })).toEqual([
        { argv: ['issue', 'edit', '43', '--remove-parent', '--milestone', 'Launch'] },
        { argv: ['issue', 'reopen', '43'] },
    ]);
    // Status and Priority are the project's, not gh issue edit's.
    expect(commandsOf(43, { status: 'Verification', priority: 'P1' })).toEqual([]);
    expect(changesText(43, { status: 'Verification', addLabels: ['bug'], close: 'completed' })).toBe('#43 moved to Verification, labelled bug, closed as completed.');
    expect(changesText(43, {})).toBe('Nothing to change on #43.');
    expect([statusOnly({ status: 'Done' }), statusOnly({ status: 'Done', comment: 'x' }), statusOnly({ priority: 'P0' }), statusOnly({}), statusOnly({ status: 'Done', addBlockedBy: [35] })]).toEqual([
        true,
        false,
        false,
        false,
        false,
    ]);
    expect(changesText(43, { addBlockedBy: [35, 44], removeBlockedBy: [12] })).toBe('#43 blocked by #35, #44, no longer blocked by #12.');
});
const EPIC = { number: 35, title: 'Make the issue board a full issue tracker', total: 12, completed: 6 };
// GitHub for claude-plugins with its project: every gh command asked for, its stdin, and how often the issues were read.
const github = (on, prs = [], extra = []) => {
    // These tests have the board write to the project, which the person let it do.
    adoptedStore(on);
    on('session.root', async () => ({ value: '/work/void-sector' }));
    // `blocked`: what #43 is blocked by on GitHub, as the links made leave it.
    // `closed`: how an issue closed on GitHub, which takes it off the board's next read.
    // `title` and `body`: #43's on GitHub, which a PATCH changes; `patched`, what each PATCH sent.
    const state = {
        calls: [],
        reads: 0,
        links: [],
        blocked: [],
        closed: {},
        title: 'Edit issues from the board',
        body: '- [ ] Edit',
        patched: [],
        // Labels made, as `name color`; and which pull requests merged, by number.
        madeLabels: [],
        merged: {},
        // Comments posted and closes made over REST; `noDuplicate` has GitHub refuse the duplicate reason.
        posted: [],
        closes: [],
        noDuplicate: false,
        // #35's sub-issues in GitHub's order, and each move made, as `<sub-issue id> <before_id|after_id>=<id>`.
        order: [43],
        moves: [],
        // When set, GitHub refuses to set a project field.
        refuseFields: false,
        // Every command run, answered or not, as one line each.
        ran: [],
    };
    on('process.run', async (_$, e) => {
        const answer = (stdout) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } });
        const argv = [...e.argv];
        state.ran.push(argv.join(' '));
        if (argv[0] === 'git')
            return answer('main\n');
        if (isIssuesQuery(argv)) {
            state.reads += 1;
            return answer(graphPage([
                { number: 35, title: EPIC.title, labels: [], body: 'The whole.', updatedAt: '2026-10-05T00:00:00Z', subIssues: { total: 12, completed: 6 }, status: 'In progress', priority: 'P1' },
                {
                    number: 43,
                    title: state.title,
                    labels: [{ name: 'enhancement' }],
                    body: state.body,
                    updatedAt: '2026-10-05T00:00:00Z',
                    parent: EPIC,
                    status: 'Ready',
                    priority: 'P1',
                    blockedBy: state.blocked.map(number => ({ number, state: 'OPEN' })),
                },
                ...extra,
            ].filter(raw => !state.closed[raw.number]), argv, asksProject(argv)));
        }
        if (argv[1] === 'pr' && argv[2] === 'list' && !argv.includes('merged'))
            return answer(JSON.stringify(prs));
        state.calls.push({ argv: argv.slice(1), ...(e.init?.stdin !== undefined ? { stdin: e.init.stdin } : {}) });
        // A moved issue is no longer this repo's.
        if (argv[1] === 'issue' && argv[2] === 'transfer')
            state.closed = { ...state.closed, [Number(argv[3])]: 'transferred' };
        if (argv[1] === 'repo')
            return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/claude-plugins', hasIssuesEnabled: true }));
        if (argv[1] === 'label' && argv[2] === 'list')
            return answer(JSON.stringify([{ name: 'bug' }, { name: 'enhancement' }, { name: 'area:issue-board' }]));
        if (argv[1] === 'api' && argv[2]?.endsWith('/issues/35/sub_issues?per_page=100'))
            return answer(JSON.stringify(state.order.map(number => ({ number }))));
        if (argv[1] === 'api' && argv[3] === 'PATCH' && argv[4]?.endsWith('/sub_issues/priority')) {
            const id = argv[6]?.split('=')[1] ?? '';
            const [side, other] = argv[8]?.split('=') ?? [];
            state.moves.push(`${id} ${side}=${other}`);
            const number = Number(id.slice(2));
            const beside = Number(other?.slice(2));
            const rest = state.order.filter(one => one !== number);
            const at = rest.indexOf(beside) + (side === 'after_id' ? 1 : 0);
            state.order = [...rest.slice(0, at), number, ...rest.slice(at)];
            return answer('{}');
        }
        if (argv[1] === 'api' && argv[3] === 'POST' && argv[4]?.endsWith('/comments')) {
            state.posted.push(`${/issues\/(\d+)\//.exec(argv[4])?.[1]} ${argv[6]?.slice(5)}`);
            return answer('{}');
        }
        if (argv[1] === 'api' && argv[3] === 'PATCH' && argv.includes('state=closed')) {
            const reason = argv.find(arg => arg.startsWith('state_reason='))?.slice(13) ?? '';
            if (reason === 'duplicate' && state.noDuplicate)
                return { value: { exitCode: 1, stdout: '', stderr: 'gh: Validation Failed (HTTP 422)', isStdoutTruncated: false, isStderrTruncated: false } };
            const number = Number(/issues\/(\d+)$/.exec(argv[4] ?? '')?.[1]);
            state.closes.push(`${number} ${reason}`);
            state.closed = { ...state.closed, [number]: reason };
            return answer('{}');
        }
        // Which repos are private: void-sector is, this one isn't.
        if (argv[1] === 'api' && argv.includes('.private'))
            return answer(argv[2] === 'repos/astrosteveo/void-sector' ? 'true\n' : 'false\n');
        const pull = /\/pulls\/(\d+)$/.exec(argv[2] ?? '');
        if (argv[1] === 'api' && pull)
            return answer(state.merged[Number(pull[1])] ? '2026-10-05T12:00:00Z\n' : 'null\n');
        if (argv[1] === 'api' && argv[2]?.endsWith('/labels?per_page=100'))
            return answer(JSON.stringify([{ name: 'bug', color: 'd73a4a' }, { name: 'enhancement', color: 'a2eeef' }, { name: 'area:issue-board', color: '1d76db' }]));
        if (argv[1] === 'api' && argv[3] === 'POST' && argv[4]?.endsWith('/labels')) {
            state.madeLabels.push(`${argv[6]?.slice(5)} ${argv[8]?.slice(6)}`);
            return answer('{}');
        }
        if (argv[1] === 'api' && argv.includes('{body, updated_at}'))
            return answer(JSON.stringify({ body: state.body, updated_at: '2026-10-05T00:00:00Z' }));
        if (argv[1] === 'api' && argv[2] === '-X' && argv[3] === 'PATCH') {
            const fields = JSON.parse(e.init?.stdin ?? '{}');
            state.patched.push(fields);
            state.title = fields.title ?? state.title;
            state.body = fields.body ?? state.body;
            return answer(JSON.stringify({ title: state.title, body: state.body, updated_at: '2026-10-05T00:00:00Z' }));
        }
        if (argv[1] === 'api' && argv.includes('{state, state_reason}')) {
            const how = state.closed[Number(/issues\/(\d+)$/.exec(argv[2] ?? '')?.[1])];
            return answer(JSON.stringify(how ? { state: 'closed', state_reason: how } : { state: 'open', state_reason: null }));
        }
        // An issue's REST id, by number: #35 and #43 exist, nothing else does.
        const one = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(argv[2] ?? '');
        if (argv[1] === 'api' && one) {
            if (!['35', '43', '44', '45'].includes(one[1] ?? ''))
                return { value: { exitCode: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)', isStdoutTruncated: false, isStderrTruncated: false } };
            return answer(`90${one[1]}\n`);
        }
        if (argv[1] === 'api' && argv[2] === '-X' && argv[4]?.includes('/dependencies/blocked_by')) {
            state.links.push(`${argv[3]} ${argv[4].replace('repos/astrosteveo/claude-plugins/issues/', '')}${argv[6] ? ` ${argv[6]}` : ''}`);
            const blocker = Number((argv[6] ?? argv[4]).match(/90(\d+)$/)?.[1]);
            state.blocked = argv[3] === 'POST' ? [...state.blocked, blocker] : state.blocked.filter(one => one !== blocker);
            return answer('{}');
        }
        if (argv[1] === 'api' && argv[2]?.startsWith('repos/'))
            return answer(JSON.stringify([{ title: 'Launch' }]));
        if (argv[1] === 'issue' && argv[2] === 'view' && argv[3] !== '43') {
            return { value: { exitCode: 1, stdout: '', stderr: `GraphQL: Could not resolve to an issue or pull request with the number of ${argv[3]}. (repository.issue)`, isStdoutTruncated: false, isStderrTruncated: false } };
        }
        if (argv[1] === 'issue' && argv[2] === 'view')
            return answer(JSON.stringify({ number: 43, title: 'Edit issues from the board', labels: [], body: '- [ ] Edit', updatedAt: '2026-10-05T00:00:00Z' }));
        if (argv[1] === 'api' && argv[2] === 'graphql' && state.refuseFields && argv.some(arg => arg.includes('updateProjectV2ItemFieldValue')))
            return { value: { exitCode: 1, stdout: '', stderr: 'gh: Resource not accessible by integration', isStdoutTruncated: false, isStderrTruncated: false } };
        if (argv[1] === 'api' && argv[2] === 'graphql')
            return answer(JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'x' } } } }));
        return answer(argv[1] === 'api' ? 'astrosteveo\n' : '[]');
    });
    on('session.id', async () => ({ value: 'session-1' }));
    letThrough(on);
    on('ui.open', async () => ({ value: { isPlaced: true } }));
    return state;
};
// The gh commands that change an issue, without the board's reads.
const writes = (calls) => calls.filter(call => ['edit', 'comment', 'close', 'reopen'].includes(call.argv[1] ?? '') || (call.argv[0] === 'api' && call.argv.some(arg => arg.startsWith('query=mutation'))));
test("Claude's issue_update tool makes the changes in order and the board reads GitHub straight after", async ($, on) => {
    adoptedStore(on);
    const gh = github(on);
    await $.command.run({ ...RUN, args: 'refresh' });
    const before = gh.reads;
    const done = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, status: 'Verification', addLabels: ['bug'], assign: ['@me'], comment: 'Built; checking it live.', close: 'completed' });
    expect(String(done.result)).toBe('#43 moved to Verification, labelled bug, assigned @me, commented on, closed as completed.');
    expect(writes(gh.calls).map(call => (call.argv[0] === 'api' ? `project ${call.argv.find(arg => arg.startsWith('option='))}` : call.argv.join(' ')))).toEqual([
        `project option=${optionId('Verification')}`,
        'issue edit 43 --add-label bug --add-assignee @me',
        'issue comment 43 --body-file -',
        'issue close 43 --reason completed',
    ]);
    expect(writes(gh.calls)[2]?.stdin).toBe('Built; checking it live.');
    expect(gh.reads).toBeGreaterThan(before);
    // An issue the board doesn't hold is looked up on GitHub; one GitHub hasn't got says so, in GitHub's words.
    const missing = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 99, status: 'Done' });
    expect(missing.deny).toMatch(/^Couldn't change #99: GraphQL: Could not resolve to an issue or pull request with the number of 99/);
    const empty = await $.tool.call({ tool: 'mcp__issue-board__issue_update', status: 'Done' });
    expect(empty.deny).toBe('Give the issue number, and what to change on it.');
});
test('Claude starting on an issue in the conversation marks it as Start does, and a pull request starts the issue it is for', async ($, on) => {
    adoptedStore(on);
    const pr = {
        number: 50,
        title: 'Let the board edit issues',
        url: 'https://github.com/astrosteveo/claude-plugins/pull/50',
        headRefName: 'feat/edit',
        isDraft: false,
        body: 'Refs #43',
        statusCheckRollup: [],
        reviewDecision: null,
        additions: 1,
        deletions: 1,
        author: { login: 'astrosteveo' },
        updatedAt: '2026-10-05T00:00:00Z',
    };
    const gh = github(on, [pr]);
    // Beneath the board, Claude Code asks before a tool that changes something.
    on('tool.check', async () => ({ decision: 'ask' }));
    on('ui.toast', async () => ({ value: undefined }));
    await $.command.run({ ...RUN, args: 'refresh' });
    // Starting, alone, needs no permission, as pressing Start doesn't; with another change it asks as before.
    const check = (input) => $.tool.check({ tool: 'mcp__issue-board__issue_update', input });
    expect((await check({ number: 43, start: true })).decision).toBe('allow');
    expect((await check({ number: 43, start: true, comment: 'On it.' })).decision).toBe('ask');
    const started = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, start: true });
    expect(String(started.result)).toBe('Started #43: it is the issue this session is on, In progress and assigned.');
    expect(writes(gh.calls).map(call => (call.argv[0] === 'api' ? `project ${call.argv.find(arg => arg.startsWith('option='))}` : call.argv.join(' ')))).toEqual([
        `project option=${optionId('In progress')}`,
        'issue edit 43 --add-assignee @me',
    ]);
    // The row has the ▶ of the issue this session is on, and the card says Started, with no Start in background.
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    await ui.press({ key: 'filter-all' });
    await ui.press({ key: 'issue-43' });
    expect(await ui.find({ text: /^▶ $/ })).toBeDefined();
    expect(await ui.find({ text: /^▶ Started$/ })).toBeDefined();
    expect(await ui.find({ key: 'start-43' })).toBeUndefined();
    expect(await ui.find({ key: 'background-43' })).toBeUndefined();
    await ui.unmount();
    // A pull request's number starts the issue it is for; one that names no open issue says so.
    const viaPr = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 50, start: true });
    expect(String(viaPr.result)).toBe('Started #43, the issue pull request #50 is for: it is the issue this session is on, In progress and assigned.');
    const missing = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 77, start: true });
    expect(missing.deny).toMatch(/^Couldn't change #77: #77 isn't open on the board/);
});
test("issue_update links and unlinks blocked-by issues over REST, the row shows it at once, and an unknown blocker fails by number", async ($, on) => {
    adoptedStore(on);
    const gh = github(on);
    on('tool.check', async () => ({ decision: 'ask' }));
    await $.command.run({ ...RUN, args: 'refresh' });
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    await ui.press({ key: 'filter-all' });
    const linked = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, addBlockedBy: [35] });
    expect(String(linked.result)).toBe('#43 blocked by #35.');
    expect(gh.links).toEqual(['POST 43/dependencies/blocked_by issue_id=9035']);
    expect(await ui.find({ text: /⛔ #35/ })).toBeDefined();
    const unlinked = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, removeBlockedBy: [35] });
    expect(String(unlinked.result)).toBe('#43 no longer blocked by #35.');
    expect(gh.links.at(-1)).toBe('DELETE 43/dependencies/blocked_by/9035');
    expect(await ui.find({ text: /⛔/ })).toBeUndefined();
    await ui.unmount();
    // A blocker that doesn't exist fails by its number, and no link is made.
    const made = gh.links.length;
    const missing = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, addBlockedBy: [35, 999] });
    expect(missing.deny).toBe("Couldn't change #43: #999 doesn't exist in astrosteveo/claude-plugins");
    expect(gh.links).toHaveLength(made);
    // A Status move with a blocked-by change still asks.
    expect((await $.tool.check({ tool: 'mcp__issue-board__issue_update', input: { number: 43, status: 'Done', addBlockedBy: [35] } })).decision).toBe('ask');
});
test('an issue that closes as completed moves to Done in the project; one closed as not planned stays', { options: { moveToDone: true } }, async ($, on) => {
    adoptedStore(on);
    const gh = github(on);
    const toasts = [];
    on('ui.toast', async (_$, e) => {
        toasts.push(e.text);
        return { value: undefined };
    });
    await $.command.run({ ...RUN, args: 'refresh' });
    const before = writes(gh.calls).length;
    // On GitHub, #43 closes as completed and #35 as not planned; both leave the board at its next read.
    gh.closed = { 43: 'completed', 35: 'not planned' };
    await $.command.run({ ...RUN, args: 'refresh' });
    await $.command.run({ ...RUN, args: 'refresh' });
    const moved = writes(gh.calls).slice(before);
    expect(moved.map(call => [call.argv.find(arg => arg.startsWith('item=')), call.argv.find(arg => arg.startsWith('option='))])).toEqual([[expect.stringMatching(/43/), `option=${optionId('Done')}`]]);
    // The person sees it once: what moved, and why.
    expect(toasts.filter(text => text.startsWith('Moved'))).toEqual(['Moved #43 to Done: it closed as completed.']);
});
test("a move the board makes on its own that GitHub refuses says so once, with where to look", { options: { moveToDone: true } }, async ($, on) => {
    adoptedStore(on);
    const gh = github(on);
    const toasts = [];
    on('ui.toast', async (_$, e) => {
        toasts.push(e.text);
        return { value: undefined };
    });
    await $.command.run({ ...RUN, args: 'refresh' });
    gh.refuseFields = true;
    gh.closed = { 43: 'completed', 35: 'completed' };
    await $.command.run({ ...RUN, args: 'refresh' });
    await $.command.run({ ...RUN, args: 'refresh' });
    expect(toasts.filter(text => text.startsWith("Couldn't move"))).toEqual([
        "Couldn't move 2 issues (#35, #43) to Done: gh: Resource not accessible by integration. /issues check may say why.",
    ]);
});
test('by default the board moves nothing on its own, and asks GitHub nothing for it', async ($, on) => {
    adoptedStore(on);
    const gh = github(on, [
        {
            number: 50,
            title: 'Part of the work',
            url: 'https://github.com/astrosteveo/claude-plugins/pull/50',
            headRefName: 'feat/50',
            isDraft: false,
            body: 'Refs #35',
            statusCheckRollup: [],
            reviewDecision: null,
            additions: 1,
            deletions: 1,
            author: { login: 'astrosteveo' },
            updatedAt: '2026-10-05T00:00:00Z',
        },
    ]);
    const toasts = [];
    on('ui.toast', async (_$, e) => {
        toasts.push(e.text);
        return { value: undefined };
    });
    await $.command.run({ ...RUN, args: 'refresh' });
    const before = gh.ran.length;
    // #43 closes as completed and pull request #50, which refers to #35, merges and leaves.
    gh.closed = { 43: 'completed' };
    gh.merged = { 50: true };
    await $.command.run({ ...RUN, args: 'refresh' });
    await $.command.run({ ...RUN, args: 'refresh' });
    const asked = gh.ran.slice(before);
    expect(asked.filter(line => line.includes('state_reason') || line.includes('/pulls/') || line.includes('updateProjectV2ItemFieldValue'))).toEqual([]);
    expect(toasts.filter(text => text.startsWith('Moved'))).toEqual([]);
});
test("with Start's own changes turned off, Claude starting on an issue leaves its assignees and Status alone", { options: { claimOnStart: false } }, async ($, on) => {
    adoptedStore(on);
    const gh = github(on);
    on('ui.toast', async () => ({ value: undefined }));
    await $.command.run({ ...RUN, args: 'refresh' });
    const started = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, start: true });
    expect(String(started.result)).toBe('Started #43: it is the issue this session is on.');
    expect(writes(gh.calls)).toEqual([]);
});
test('many moves at once read as one line', () => {
    expect(movedText('Done', [41, 42, 43], 'it closed as completed', 'they closed as completed')).toBe('Moved 3 issues to Done (#41, #42, #43): they closed as completed.');
    expect(unmovedText('Verification', [{ number: 7, message: 'nope' }])).toBe("Couldn't move #7 to Verification: nope. /issues check may say why.");
});
test("only an issue that had an item and wasn't at Done yet is looked at, and nothing without a Done", () => {
    const issue = (number, status, item) => ({ number, title: '', url: '', labels: [], assignees: [], checks: [], updatedAt: '', body: '', item, status });
    const field = (names) => ({ id: 'F', options: names.map(name => ({ id: name, name })) });
    const board = (issues, statuses) => ({
        repo: 'o/r',
        issues,
        prs: [],
        velocity: { closed: [], merged: [] },
        fetchedAt: 0,
        project: { id: 'P', number: 1, title: 'P', url: '', status: field(statuses), priority: null },
    });
    const before = board([issue(1, 'Ready', 'I1'), issue(2, 'Done', 'I2'), issue(3, 'Ready', null), issue(4, 'Ready', 'I4')], ['Ready', 'Done']);
    expect(leftForDone(before, board([issue(4, 'Ready', 'I4')], ['Ready', 'Done']))).toEqual([{ number: 1, item: 'I1' }]);
    expect(leftForDone(before, board([], ['Ready', 'Finished']))).toEqual([]);
    // Shipped is a common name for Done, so a project that says it moves closed issues there without setup.
    expect(leftForDone(before, board([], ['Ready', 'Shipped'])).map(one => one.number)).toEqual([1, 2, 4]);
    expect(leftForDone(null, board([], ['Ready', 'Done']))).toEqual([]);
    // A pull request that left: the open issues it refers to, unless at Verification or Done, or without Verification.
    const pr = { number: 9, title: '', url: '', author: '', branch: '', ci: 'none', review: null, isDraft: false, additions: 0, deletions: 0, updatedAt: '', sha: '', failing: [], issues: [1, 2, 4, 7] };
    const open = [issue(1, 'In progress', 'I1'), issue(2, 'Verification', 'I2'), issue(4, 'Done', 'I4')];
    const had = { ...board(open, ['In progress', 'Verification', 'Done']), prs: [pr] };
    expect(leftForVerification(had, board(open, ['In progress', 'Verification', 'Done']))).toEqual([{ pr: 9, number: 1, item: 'I1' }]);
    expect(leftForVerification(had, board(open, ['In progress', 'Done']))).toEqual([]);
});
test('boxes are added after the last one, or under a new Acceptance heading, and reworded by number', () => {
    expect(addBoxes('Intro.\n\n## Acceptance\n- [x] One\n- [ ] Two\n\nNotes.', ['Three'])).toBe('Intro.\n\n## Acceptance\n- [x] One\n- [ ] Two\n- [ ] Three\n\nNotes.');
    expect(addBoxes('- [ ] One', ['Two', 'Three'])).toBe('- [ ] One\n- [ ] Two\n- [ ] Three');
    expect(addBoxes('Intro.\n', ['One'])).toBe('Intro.\n\n## Acceptance\n- [ ] One\n');
    expect(addBoxes('', ['One'])).toBe('## Acceptance\n- [ ] One\n');
    // A body the web editor saved with \r\n keeps them.
    expect(addBoxes('- [ ] One\r\nNotes.\r\n', ['Two'])).toBe('- [ ] One\r\n- [ ] Two\r\nNotes.\r\n');
    expect(rewordBoxes('- [x] One\n- [ ] Two\r\n', [{ box: 1, text: 'First' }, { box: 2, text: 'Second' }])).toEqual({ body: '- [x] First\n- [ ] Second\r\n', missing: [] });
    expect(rewordBoxes('- [ ] One', [{ box: 3, text: 'x' }]).missing).toEqual([3]);
});
test("issue_update changes the title and body over REST, adds and rewords boxes, and won't overwrite a body changed meanwhile", async ($, on) => {
    adoptedStore(on);
    const gh = github(on);
    on('ui.toast', async () => ({ value: undefined }));
    await $.command.run({ ...RUN, args: 'refresh' });
    const call = (fields) => $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, ...fields });
    expect(String((await call({ title: 'Edit issues in place' })).result)).toBe('#43 retitled “Edit issues in place”.');
    expect(String((await call({ addBoxes: ['Undo a change'] })).result)).toBe('#43 1 box added.');
    expect(gh.body).toBe('- [ ] Edit\n- [ ] Undo a change');
    expect(String((await call({ rewordBoxes: [{ box: 1, text: 'Edit any field' }] })).result)).toBe('#43 box 1 reworded.');
    expect(gh.body).toBe('- [ ] Edit any field\n- [ ] Undo a change');
    expect((await call({ rewordBoxes: [{ box: 5, text: 'x' }] })).deny).toBe("Couldn't change #43: #43 has 2 boxes, so there is no box 5");
    // A whole new body goes in while GitHub's is the one the board read.
    expect(String((await call({ body: 'Rewritten.\n- [ ] Edit' })).result)).toBe('#43 its body rewritten.');
    // Someone edits the body on GitHub: a whole new body is refused, and nothing is sent.
    gh.body = 'Changed on GitHub.';
    const sent = gh.patched.length;
    expect((await call({ body: 'Mine.' })).deny).toBe("Couldn't change #43: #43's body changed on GitHub since the board read it, so it wasn't overwritten. Read it again with the issues tool, then change it");
    expect(gh.patched).toHaveLength(sent);
    // The board shows the new title and boxes at once.
    gh.body = '- [ ] Edit\n- [ ] Undo a change';
    await call({ addBoxes: ['Redo'] });
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    await ui.press({ key: 'filter-all' });
    expect(await ui.find({ text: /Edit issues in place/ })).toBeDefined();
    await ui.unmount();
});
test("the card's editor renames an issue, adds a box, and hands a body edit to Claude", async ($, on) => {
    adoptedStore(on);
    const gh = github(on);
    on('ui.toast', async () => ({ value: undefined }));
    const filled = [];
    on('prompt.fill', async (_$, e) => {
        filled.push(e.text);
        return { isFilled: true };
    });
    await $.command.run({ ...RUN, args: 'refresh' });
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    await ui.press({ key: 'filter-all' });
    await ui.press({ key: 'issue-43' });
    await ui.press({ key: 'edit-43' });
    await ui.press({ key: 'more-43' });
    await ui.input({ key: 'title-43', text: 'Edit issues in place' });
    await ui.input({ key: 'box-43', text: 'Undo a change' });
    expect(gh.patched).toEqual([{ title: 'Edit issues in place' }, { body: '- [ ] Edit\n- [ ] Undo a change' }]);
    await ui.press({ key: 'body-43' });
    expect(filled).toEqual(['Edit the body of #43: ']);
    await ui.unmount();
});
test('an issue a merged pull request refers to with Refs moves to Verification, and the next prompt says so', { options: { moveToVerification: true } }, async ($, on) => {
    adoptedStore(on);
    const pr = (number, body) => ({
        number,
        title: `Part of the work, ${number}`,
        url: `https://github.com/astrosteveo/claude-plugins/pull/${number}`,
        headRefName: `feat/${number}`,
        isDraft: false,
        body,
        statusCheckRollup: [],
        reviewDecision: null,
        additions: 1,
        deletions: 1,
        author: { login: 'astrosteveo' },
        updatedAt: '2026-10-05T00:00:00Z',
    });
    const prs = [pr(50, 'Refs #43'), pr(51, 'Refs #35')];
    const gh = github(on, prs);
    const prompts = [];
    on('prompt.submit', async (_$, e) => {
        prompts.push(e.context ?? []);
        return { text: e.text };
    });
    await $.command.run({ ...RUN, args: 'refresh' });
    const before = writes(gh.calls).length;
    // #50 merges; #51 is closed without merging. Both leave the board.
    gh.merged = { 50: true };
    prs.length = 0;
    await $.command.run({ ...RUN, args: 'refresh' });
    await $.command.run({ ...RUN, args: 'refresh' });
    const moved = writes(gh.calls).slice(before);
    expect(moved.map(call => [call.argv.find(arg => arg.startsWith('item=')), call.argv.find(arg => arg.startsWith('option='))])).toEqual([[expect.stringMatching(/43/), `option=${optionId('Verification')}`]]);
    await $.prompt.submit({ text: 'What next?', wait: false, origin: { kind: 'composer' } });
    expect(prompts.at(-1)).toContain('#43 moved to Verification: pull request #50, which refers to it without closing it, merged.');
    await $.prompt.submit({ text: 'And then?', wait: false, origin: { kind: 'composer' } });
    expect(prompts.at(-1)?.join('\n') ?? '').not.toMatch(/Verification/);
});
test('an issue closes as a duplicate of another, from the tool or the card, and leaves the board', async ($, on) => {
    adoptedStore(on);
    const gh = github(on);
    on('ui.toast', async () => ({ value: undefined }));
    await $.command.run({ ...RUN, args: 'refresh' });
    // An issue that doesn't exist can't be the original: nothing is posted or closed.
    expect((await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, duplicateOf: 999 })).deny).toBe("Couldn't change #43: #999 doesn't exist in astrosteveo/claude-plugins");
    expect([gh.posted, gh.closes]).toEqual([[], []]);
    const closed = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, duplicateOf: 35 });
    expect(String(closed.result)).toBe('#43 closed as a duplicate of #35.');
    expect(gh.posted).toEqual(['43 Duplicate of #35']);
    expect(gh.closes).toEqual(['43 duplicate']);
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    await ui.press({ key: 'filter-all' });
    expect(await ui.find({ key: 'issue-43' })).toBeUndefined();
    await ui.unmount();
});
test("the card closes an issue as a duplicate, as not planned where GitHub refuses the duplicate reason", async ($, on) => {
    adoptedStore(on);
    const gh = github(on);
    gh.noDuplicate = true;
    on('ui.toast', async () => ({ value: undefined }));
    await $.command.run({ ...RUN, args: 'refresh' });
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    await ui.press({ key: 'filter-all' });
    await ui.press({ key: 'issue-43' });
    await ui.press({ key: 'edit-43' });
    await ui.press({ key: 'more-43' });
    await ui.input({ key: 'duplicate-43', text: '#35' });
    expect(gh.posted).toEqual(['43 Duplicate of #35']);
    expect(gh.closes).toEqual(['43 not_planned']);
    await ui.unmount();
});
test("an epic's sub-issues follow GitHub's order where the board has no reason to change it, and move before or after a sibling", async ($, on) => {
    adoptedStore(on);
    const sub = (number) => ({ number, title: `Part ${number}`, labels: [], body: '', updatedAt: '2026-10-05T00:00:00Z', parent: EPIC, status: 'Ready', priority: 'P1' });
    const gh = github(on, [], [sub(44), sub(45)]);
    gh.order = [45, 43, 44];
    on('ui.toast', async () => ({ value: undefined }));
    await $.command.run({ ...RUN, args: 'refresh' });
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    await ui.press({ key: 'filter-all' });
    await ui.press({ key: 'group-epic' });
    const rows = async () => (await ui.findAll({ type: 'Button' })).map(one => one.key ?? '').filter(key => /^issue-4[345]$/.test(key));
    expect(await rows()).toEqual(['issue-45', 'issue-43', 'issue-44']);
    const moved = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 44, moveBefore: 45 });
    expect(String(moved.result)).toBe('#44 moved before #45.');
    expect(gh.moves).toEqual(['9044 before_id=9045']);
    expect(await rows()).toEqual(['issue-44', 'issue-45', 'issue-43']);
    await ui.unmount();
    // A sibling outside the epic can't be the place.
    expect((await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, moveAfter: 35 })).deny).toBe("Couldn't change #43: #35 isn't a sub-issue of #35, as #43 is");
});
test('an issue is pinned, locked and moved to another of the owner\'s repos, each as a gh command, and leaves the board when moved', async ($, on) => {
    adoptedStore(on);
    const gh = github(on);
    on('tool.check', async () => ({ decision: 'ask' }));
    on('ui.toast', async () => ({ value: undefined }));
    await $.command.run({ ...RUN, args: 'refresh' });
    const update = (fields) => $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, ...fields });
    const ran = () => gh.calls.filter(call => ['pin', 'unpin', 'lock', 'unlock', 'transfer'].includes(call.argv[1] ?? '')).map(call => call.argv.join(' '));
    expect(String((await update({ pin: true, lock: 'too_heated' })).result)).toBe('#43 pinned, locked as too heated.');
    expect(String((await update({ pin: false, lock: false })).result)).toBe('#43 unpinned, unlocked.');
    // Sent as a string, as a caller may for a field that also takes GitHub's reasons, it reads the same.
    expect(String((await update({ lock: 'false' })).result)).toBe('#43 unlocked.');
    expect((await update({ lock: 'maybe' })).deny).toBe("lock takes true, false, or one of GitHub's reasons: off_topic, resolved, spam, too_heated.");
    expect((await $.tool.check({ tool: 'mcp__issue-board__issue_update', input: { number: 43, pin: true } })).decision).toBe('ask');
    // Another owner's repo, or the same repo, is refused before anything runs.
    expect((await update({ transferTo: 'someone/else' })).deny).toBe("Couldn't change #43: an issue moves only to another of astrosteveo's repos, not to someone/else");
    expect((await update({ transferTo: 'claude-plugins' })).deny).toBe("Couldn't change #43: the issue is in astrosteveo/claude-plugins already");
    // void-sector is private: GitHub won't move the issue back, so the move waits for a confirmed call.
    expect((await update({ transferTo: 'void-sector' })).deny).toBe("Couldn't change #43: astrosteveo/void-sector is private and astrosteveo/claude-plugins is public, so GitHub won't move #43 back once it's there. Call again with confirmTransfer: true to move it anyway");
    expect(String((await update({ transferTo: 'void-sector', confirmTransfer: true })).result)).toBe('#43 moved to astrosteveo/void-sector.');
    expect(ran()).toEqual(['issue pin 43', 'issue lock 43 --reason too_heated', 'issue unpin 43', 'issue unlock 43', 'issue unlock 43', 'issue transfer 43 astrosteveo/void-sector']);
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    await ui.press({ key: 'filter-all' });
    expect(await ui.find({ key: 'issue-43' })).toBeUndefined();
    await ui.unmount();
});
test("the card's editor shows its rows by what they're for, the common ones first, and the rest under More, in place", async ($, on) => {
    adoptedStore(on);
    github(on);
    on('ui.toast', async () => ({ value: undefined }));
    await $.command.run({ ...RUN, args: 'refresh' });
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    await ui.press({ key: 'filter-all' });
    await ui.press({ key: 'issue-43' });
    await ui.press({ key: 'edit-43' });
    // The editor's buttons in the order they show, without the labels' own.
    const order = async () => (await ui.findAll({ type: 'Button' })).map(one => one.key ?? '').filter(key => /^(unparent|milestone|assign|close-completed|more)-43/.test(key)).map(key => key.replace(/-43.*$/, ''));
    expect(await order()).toEqual(['unparent', 'assign', 'close-completed', 'more']);
    expect(await ui.find({ key: 'duplicate-43' })).toBeUndefined();
    expect(await ui.find({ text: '▾ More: milestone, fields, duplicate' })).toBeDefined();
    // More opens the rare rows where they belong: the milestone with the epic, before who has it.
    await ui.press({ key: 'more-43' });
    expect(await order()).toEqual(['unparent', 'milestone', 'assign', 'close-completed', 'more']);
    expect(await ui.find({ key: 'duplicate-43' })).toBeDefined();
    expect(await ui.find({ text: '▴ Less' })).toBeDefined();
    await ui.unmount();
});
test("a label the repo hasn't got is made first, an area one in the areas' color, and the answer says so", async ($, on) => {
    adoptedStore(on);
    const gh = github(on);
    on('ui.toast', async () => ({ value: undefined }));
    await $.command.run({ ...RUN, args: 'refresh' });
    const added = await $.tool.call({ tool: 'mcp__issue-board__issue_update', number: 43, addLabels: ['area:ask', 'Bug', 'needs design'] });
    expect(String(added.result)).toBe('#43 labelled area:ask, Bug, needs design. Created the labels area:ask, needs design, new to the repo.');
    expect(gh.madeLabels).toEqual(['area:ask 1d76db', 'needs design ededed']);
    // The card makes one from what is typed.
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    await ui.press({ key: 'filter-all' });
    await ui.press({ key: 'issue-43' });
    await ui.press({ key: 'edit-43' });
    await ui.press({ key: 'more-43' });
    await ui.input({ key: 'new-label-43', text: 'area:board' });
    expect(gh.madeLabels.at(-1)).toBe('area:board 1d76db');
    await ui.unmount();
});
test("moving the Status of the issue Claude is on doesn't ask; any other change does", async ($, on) => {
    adoptedStore(on);
    github(on);
    // Beneath the board, Claude Code asks before a tool that changes something.
    on('tool.check', async () => ({ decision: 'ask' }));
    on('prompt.submit', async (_$, e) => ({ text: e.text }));
    await $.command.run({ ...RUN, args: 'refresh' });
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    await ui.press({ key: 'filter-all' });
    await ui.press({ key: 'issue-43' });
    await ui.press({ key: 'start-43' });
    const check = (input) => $.tool.check({ tool: 'mcp__issue-board__issue_update', input });
    expect((await check({ number: 43, status: 'Verification' })).decision).toBe('allow');
    expect((await check({ number: 35, status: 'Verification' })).decision).toBe('ask');
    expect((await check({ number: 43, status: 'Done', comment: 'Done.' })).decision).toBe('ask');
    expect((await check({ number: 43, addLabels: ['bug'] })).decision).toBe('ask');
    await ui.unmount();
});
test('a permission check that fails falls back to the verdict beneath, and says why in the debug log', async ($, on) => {
    adoptedStore(on);
    github(on);
    // Beneath the board, Claude Code would run the command.
    on('tool.check', async () => ({ decision: 'allow' }));
    // Once the board is up, its copy reads back malformed, so the check on closing an epic throws.
    let malformed = false;
    on('state.get', async (_$, e, next) => {
        const got = await next(e);
        if (!malformed || e.key !== 'board' || !got.value?.value)
            return got;
        return { value: { ...got.value, value: { ...got.value.value, issues: 'malformed' } } };
    });
    const logged = [];
    on('ui.log', async (_$, e) => {
        if (e.to === 'debug')
            logged.push(e.text);
        return { value: undefined };
    });
    await $.command.run({ ...RUN, args: 'refresh' });
    malformed = true;
    // The command still runs as Claude Code decided, rather than being refused, so a fault in the board blocks no command.
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'gh issue close 35' } });
    expect(verdict.decision).toBe('allow');
    expect(logged.some(line => line.startsWith('issue-board: tool.check on Bash failed and was left to the default:'))).toBe(true);
    // One of the board's own tools has nothing beneath to fall back to: Claude reads why it failed.
    malformed = false;
    const listed = await $.tool.call({ tool: 'mcp__issue-board__issues', area: 5 });
    expect(listed.deny).toMatch(/^The issue board's issues tool failed: /);
});
test("an organization's ceiling of ask keeps both board tools asking; one of allow, or none, changes nothing", async ($, on) => {
    adoptedStore(on);
    github(on);
    on('tool.check', async () => ({ decision: 'ask' }));
    on('prompt.submit', async (_$, e) => ({ text: e.text }));
    await $.command.run({ ...RUN, args: 'refresh' });
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    await ui.press({ key: 'filter-all' });
    await ui.press({ key: 'issue-43' });
    await ui.press({ key: 'start-43' });
    const move = { number: 43, status: 'Verification' };
    const update = (ceiling) => $.tool.check({ tool: 'mcp__issue-board__issue_update', input: move, ...(ceiling ? { ceiling } : {}) });
    const issues = (ceiling) => $.tool.check({ tool: 'mcp__issue-board__issues', input: {}, ...(ceiling ? { ceiling } : {}) });
    expect((await update('ask')).decision).toBe('ask');
    expect((await issues('ask')).decision).toBe('ask');
    expect((await update('allow')).decision).toBe('allow');
    expect((await issues('allow')).decision).toBe('allow');
    expect((await update()).decision).toBe('allow');
    expect((await issues()).decision).toBe('allow');
    await ui.unmount();
});
test("the card's editor changes labels, assignee and milestone, comments, and asks twice to close an epic with open sub-issues", async ($, on) => {
    adoptedStore(on);
    const gh = github(on);
    await $.command.run({ ...RUN, args: 'refresh' });
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    await ui.press({ key: 'filter-all' });
    await ui.press({ key: 'issue-43' });
    await ui.press({ key: 'edit-43' });
    await ui.press({ key: 'more-43' });
    // The repo's labels, the one it has drawn as set; the repo's milestones.
    expect(await ui.find({ key: 'label-43-enhancement' })).toMatchObject({ props: { variant: 'primary' } });
    expect(await ui.find({ key: 'label-43-bug' })).toBeDefined();
    expect(await ui.find({ key: 'milestone-43-Launch' })).toBeDefined();
    expect(await ui.find({ text: /^#35 Make the issue board/ })).toBeDefined();
    await ui.press({ key: 'label-43-bug' });
    await ui.press({ key: 'label-43-enhancement' });
    await ui.press({ key: 'assign-43' });
    await ui.press({ key: 'milestone-43-Launch' });
    await ui.press({ key: 'unparent-43' });
    await ui.input({ key: 'reply-43', text: 'Looks right.', kind: 'change' });
    await ui.input({ key: 'reply-43', text: 'Looks right.', kind: 'submit' });
    await ui.input({ key: 'parent-43', text: '#35', kind: 'submit' });
    expect(writes(gh.calls).map(call => call.argv.join(' '))).toEqual([
        'issue edit 43 --add-label bug',
        'issue edit 43 --remove-label enhancement',
        'issue edit 43 --add-assignee @me',
        'issue edit 43 --milestone Launch',
        'issue edit 43 --remove-parent',
        'issue comment 43 --body-file -',
        'issue edit 43 --parent 35',
    ]);
    await ui.press({ key: 'close-not-planned-43' });
    expect(writes(gh.calls).at(-1)?.argv.join(' ')).toBe('issue close 43 --reason not planned');
    // The epic: the first press of Close says what's open; the second closes it.
    const count = writes(gh.calls).length;
    await ui.press({ key: 'issue-35' });
    await ui.press({ key: 'edit-35' });
    await ui.press({ key: 'more-35' });
    await ui.press({ key: 'close-completed-35' });
    expect(await ui.find({ text: /^#35 is an epic with 6 open sub-issues\. .*Press again to close it anyway\.$/ })).toBeDefined();
    expect(writes(gh.calls).length).toBe(count);
    await ui.press({ key: 'close-completed-35' });
    expect(writes(gh.calls).at(-1)?.argv.join(' ')).toBe('issue close 35 --reason completed');
    await ui.unmount();
});
