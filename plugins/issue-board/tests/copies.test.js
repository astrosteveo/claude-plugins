import { expect, mock, test } from 'claude-code/testing';
import { graphPage, isIssuesQuery } from './graph';
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } };
const REPO = { root: '/work/void-sector', remote: null, internal: false, name: null };
const issue = (number, updatedAt, body = `Issue ${number} needs doing.\n\n- [ ] Done`) => ({
    number,
    title: `Issue ${number}`,
    url: `https://github.com/astrosteveo/void-sector/issues/${number}`,
    labels: [],
    assignees: [],
    body,
    updatedAt,
});
// GitHub as the board reads it: open issues #1 to #5, each changed at a time the test can move, and the prompts sent.
const world = (on) => {
    const state = {
        updated: new Map([1, 2, 3, 4, 5].map(number => [number, '2026-10-01T10:00:00Z'])),
        bodies: new Map(),
        prompts: [],
    };
    on('process.run', async (_$, e) => {
        const argv = e.argv;
        const answer = (stdout) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } });
        if (argv[0] === 'git')
            return answer('main\n');
        if (argv[1] === 'repo')
            return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }));
        if (isIssuesQuery(argv))
            return answer(graphPage([...state.updated].map(([number, at]) => issue(number, at, state.bodies.get(number)))));
        if (argv[1] === 'api' && argv[2] === 'graphql')
            return answer(JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } }));
        if (argv[1] === 'api')
            return answer('astrosteveo\n');
        return answer('[]');
    });
    on('session.id', async () => ({ value: 'session-1' }));
    on('session.repo', async () => ({ value: REPO }));
    on('session.root', async () => ({ value: REPO.root }));
    on('session.end', async (_$, e) => ({ sessionId: e.sessionId }));
    on('session.compact', async (_$, e) => ({ messages: e.messages }));
    on('prompt.submit', async (_$, e) => {
        state.prompts.push({ text: e.text, context: e.context ?? [] });
        return { text: e.text, ...(e.context ? { context: e.context } : {}) };
    });
    return state;
};
// A conversation to compact: a compaction keeps at least one message.
const TALK = [{ role: 'user', text: 'Look at #2.', toolUses: [] }];
// The numbers whose copies the last prompt carried.
const copied = (state) => (state.prompts.at(-1)?.context ?? []).flatMap(line => {
    const named = /^The prompt names #(\d+)\. /.exec(line);
    return named ? [Number(named[1])] : [];
});
const ask = async ($, text) => {
    await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } });
};
test("an issue's copy goes once per session, and again when it changed", async ($, on) => {
    mock.store(on);
    const gh = world(on);
    await $.command.run(REFRESH);
    await ask($, 'Look at #1.');
    expect(copied(gh)).toEqual([1]);
    // Named again, unchanged: no second copy, and a line says an earlier prompt carried it.
    await ask($, 'And #1 again.');
    expect(copied(gh)).toEqual([]);
    expect(gh.prompts.at(-1)?.context).toEqual(["An earlier prompt in this session carried the board's copy of #1, and it hasn't changed since."]);
    // #1 changes on GitHub: the next prompt naming it carries the new copy.
    gh.updated.set(1, '2026-10-02T10:00:00Z');
    await $.command.run(REFRESH);
    await ask($, 'What about #1 now?');
    expect(copied(gh)).toEqual([1]);
    await ask($, '#1 once more.');
    expect(copied(gh)).toEqual([]);
});
test('after a compaction or /clear, the next prompt naming an issue sends its copy again', async ($, on) => {
    mock.store(on);
    const clock = mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') });
    const gh = world(on);
    await $.command.run(REFRESH);
    await ask($, 'Look at #2.');
    expect(copied(gh)).toEqual([2]);
    // A precompute and a subagent's compaction leave the main conversation's copies in place.
    await $.session.compact({ trigger: 'precompute', messages: TALK });
    await $.session.compact({ trigger: 'auto', agentId: 'agent-1', messages: TALK });
    await ask($, '#2 again.');
    expect(copied(gh)).toEqual([]);
    await $.session.compact({ trigger: 'manual', messages: TALK });
    await ask($, '#2 after compacting.');
    expect(copied(gh)).toEqual([2]);
    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } });
    await ask($, '#2 after a clear.');
    expect(copied(gh)).toEqual([2]);
    // The first prompt after /clear also fills the board again: let it finish.
    await clock.settle();
});
test('a prompt carries at most 3 copies, and names the rest in one line', async ($, on) => {
    mock.store(on);
    const gh = world(on);
    await $.command.run(REFRESH);
    await ask($, 'Look at #1.');
    await ask($, 'Now #1, #2, #3, #4 and #5.');
    // #1 went already, so the three copies are #2 to #4, and #5 is named past the cap.
    expect(copied(gh)).toEqual([2, 3, 4]);
    expect(gh.prompts.at(-1)?.context.slice(3)).toEqual([
        "An earlier prompt in this session carried the board's copy of #1, and it hasn't changed since.",
        'The prompt names #5 too, past the 3 copies a prompt carries: the issues tool shows each with its `number`.',
    ]);
    // #5 wasn't sent, so the next prompt naming it carries it.
    await ask($, 'And #5?');
    expect(copied(gh)).toEqual([5]);
});
test("a long body is cut, and the copy says so", async ($, on) => {
    mock.store(on);
    const gh = world(on);
    gh.bodies.set(3, 'x'.repeat(2500));
    await $.command.run(REFRESH);
    await ask($, 'Look at #3 and #4.');
    const [long, short] = gh.prompts.at(-1)?.context ?? [];
    expect(long).toMatch(/\nText, without the boxes, cut to its first 2000 of 2500 characters:\nx{1999}…\nRead the whole issue with `gh issue view 3`\.$/);
    expect(short).toMatch(/\nText, without the boxes:\nIssue 4 needs doing\.\n/);
});
