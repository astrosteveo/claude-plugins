import { expect, mock, test } from 'claude-code/testing';
import { ago, agoText, bar, cells, checksOf, ciOf, filterKeys, fit, hintFit, issuesOf, openedText, pad, peekPlace, proseOf, rowRoom, spark, summary, weekly, wrappedLines } from '../hooks/parse';
import { graphPage, isIssuesQuery } from './graph';
test("a card's text leaves out its boxes, and a pull request names the issues it is for", () => {
    expect(proseOf('Why it matters.\n\n## Acceptance\n\n- [ ] One\n- [x] Two\n\n## Notes\n\nKeep this.')).toBe('Why it matters.\n\n## Notes\n\nKeep this.');
    expect(proseOf('## Acceptance\r\n\r\n- [ ] Only boxes\r\n')).toBe('');
    expect(proseOf('x'.repeat(12000))).toHaveLength(10000);
    expect(issuesOf([{ number: 344 }], 'Fixes #12, then refs #344 and see #9. Closes: #13')).toEqual([344, 12, 13]);
    expect(issuesOf([], '')).toEqual([]);
});
const ISSUES = [
    {
        number: 315,
        title: 'Lay Kessik out for play',
        labels: [{ name: 'enhancement', color: 'a2eeef' }, { name: 'area:simulation', color: '0e8a16' }, { name: 'future', color: 'c5def5' }],
        assignees: [{ login: 'astrosteveo' }],
        body: 'Kessik needs a layout for play.\n\n## Acceptance\n\n- [x] Layout in place\n- [X] Old saves load\n- [ ] Goldens regenerated',
        updatedAt: '2026-10-03T20:00:00Z',
    },
    {
        number: 289,
        title: "Asteroids didn't draw",
        labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'area:art-audio', color: 'fbca04' }],
        body: null,
        updatedAt: '2026-10-02T20:00:00Z',
    },
];
const PRS = [
    {
        number: 335,
        title: 'Glide in to a planet',
        headRefName: 'fix/planet-glide',
        isDraft: false,
        statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
        reviewDecision: 'APPROVED',
        additions: 120,
        deletions: 40,
        author: { login: 'astrosteveo' },
        updatedAt: '2026-10-03T20:00:00Z',
    },
];
const PANE = { component: 'Pane', requestId: 'issue-board', props: { title: 'Issues', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } };
test('acceptance boxes and CI read the way gh writes them', () => {
    expect(checksOf('- [x] one\n* [ ] two\nnot a box\n  - [X] three')).toEqual([
        { done: true, text: 'one' },
        { done: false, text: 'two' },
        { done: true, text: 'three' },
    ]);
    expect(ciOf([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }])).toBe('pending');
    expect(ciOf([{ status: 'COMPLETED', conclusion: 'FAILURE' }, { status: 'IN_PROGRESS' }])).toBe('fail');
    expect(ciOf(null)).toBe('none');
});
test('bars, ages and titles fit the pane', () => {
    expect(bar({ done: 0, total: 0 }, 4)).toEqual(['', '╌╌╌╌']);
    expect(bar({ done: 2, total: 4 }, 6)).toEqual(['━━━', '━━━']);
    expect(bar({ done: 99, total: 100 }, 6)).toEqual(['━━━━━', '━']);
    expect(bar({ done: 3, total: 3 }, 6)).toEqual(['━━━━━━', '']);
    const at = Date.parse('2026-10-03T12:00:00Z');
    expect(ago('2026-10-03T11:59:30Z', at)).toBe('now');
    expect(ago('2026-10-03T09:00:00Z', at)).toBe('3h');
    expect(ago('2026-09-01T12:00:00Z', at)).toBe('4w');
    expect(fit('Lay Kessik out for play', 10)).toBe('Lay Kessi…');
    expect(fit('short', 10)).toBe('short');
});
test('an age in a sentence reads "just now" under a minute, never "now ago", from a number or an ISO string', () => {
    const at = Date.parse('2026-10-03T12:00:00Z');
    expect(agoText('2026-10-03T11:59:30Z', at)).toBe('just now');
    expect(agoText(at - 30000, at)).toBe('just now');
    expect(agoText('2026-10-03T09:00:00Z', at)).toBe('3h ago');
    expect(agoText(at - 5 * 60000, at)).toBe('5m ago');
    expect(ago(at - 3 * 3600000, at)).toBe('3h');
    expect(agoText('not a date', at)).toBe('');
    expect(agoText('', at)).toBe('');
});
test('text is measured in terminal cells: an emoji or a wide character takes two, a combining mark none', () => {
    expect(cells('marked ⛔')).toBe(9);
    expect(cells('星系')).toBe(4);
    expect(cells('é')).toBe(1);
    expect(cells('☐ box')).toBe(5);
    // Cut at the cell, never past it: ⛔ wouldn't fit in the last cell before the ellipsis.
    expect(fit('is marked ⛔ #301', 12)).toBe('is marked …');
    expect(cells(fit('is marked ⛔ #301', 13))).toBeLessThanOrEqual(13);
    expect(fit('is marked ⛔', 12)).toBe('is marked ⛔');
    expect(pad('⛔ go', 6)).toBe('⛔ go ');
    expect(cells(pad('⛔ go', 6))).toBe(6);
});
test("a preview line holding an emoji keeps the card's width, so nothing shows through it", async ($, on) => {
    const blocked = {
        number: 42,
        title: 'Show epics as parent issues with sub-issues',
        labels: [{ name: 'enhancement', color: 'a2eeef' }],
        body: '- [ ] A blocked row shows `⛔ #N`.\n- [ ] Ready ones come first.',
        updatedAt: '2026-10-03T20:00:00Z',
    };
    // Rows enough above it for its card: numbered higher, so they sort first.
    const others = [101, 102, 103, 104, 105, 106].map(number => ({ number, title: `Other ${number}`, labels: [], body: '', updatedAt: '2026-10-03T20:00:00Z' }));
    on('process.run', async (_$, e) => {
        const stdout = isIssuesQuery(e.argv) ? graphPage([blocked, ...others]) : e.argv[1] === 'repo' ? JSON.stringify({ nameWithOwner: 'astrosteveo/claude-plugins', hasIssuesEnabled: true }) : '[]';
        return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
    });
    await $.command.run({ command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } });
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    const preview = (await ui.findAll({ type: 'Box' })).find(box => box.props.position === 'absolute');
    // The card's lines, which are cut rather than wrapped; the repo's name in the header is cut too, but isn't one.
    const lines = (await ui.findAll({ type: 'Text' })).filter(text => text.props.wrap === 'truncate-end' && !text.text.startsWith('◆ '));
    expect(lines.some(line => line.text.includes('⛔'))).toBe(true);
    // Each line fills the card's inside exactly: its width less the two border cells.
    expect(lines.map(line => cells(line.text))).toEqual(lines.map(() => Number(preview?.props.width) - 2));
    await ui.unmount();
});
test('a hover card goes above its row, whole when it fits, trimmed when short of room, else not at all', () => {
    // Five boxes open: the title, how far along, four boxes, +1 more and the hint, in a border, take ten lines.
    expect(peekPlace(10, 5)).toEqual({ listed: 4, more: true, hint: true });
    expect(peekPlace(7, 2)).toEqual({ listed: 2, more: false, hint: true });
    // Short of room: no hint, the boxes that fit, and +N more for the rest.
    expect(peekPlace(6, 5)).toEqual({ listed: 1, more: true, hint: false });
    expect(peekPlace(6, 2)).toEqual({ listed: 2, more: false, hint: false });
    expect(peekPlace(4, 5)).toEqual({ listed: 0, more: false, hint: false });
    // Not even the title and how far along fit.
    expect(peekPlace(3, 5)).toBeNull();
});
test('the hint line keeps the most useful keys that fit, shortens the filters before dropping them, and never wraps', () => {
    const filters = [
        { hotkey: '1', name: 'Now' },
        { hotkey: '2', name: 'Later' },
        { hotkey: '7', name: 'Closed' },
    ];
    const parts = ['⏎ open an issue', filterKeys(filters), 'r refresh', 'm merge all PRs'];
    expect(hintFit(parts, 120)).toBe('⏎ open an issue · 1 now · 2 later · 7 closed · r refresh · m merge all PRs');
    // Narrower: the filters fold to their short form, then the last parts go.
    expect(hintFit(parts, 50)).toBe('⏎ open an issue · 1-7 filter · r refresh');
    expect(hintFit(parts, 30)).toBe('⏎ open an issue · 1-7 filter');
    for (const width of [120, 50, 30, 10])
        expect(cells(hintFit(parts, width))).toBeLessThanOrEqual(width);
});
test('opening the pane names every filter it has, from the same list the pane draws', () => {
    expect(openedText([{ hotkey: '1', name: 'Now' }, { hotkey: '7', name: 'Closed' }])).toBe('Issues pane opened. Filters: 1 Now, 7 Closed. Enter opens an issue: Start hands it to Claude, Change edits it, and Esc folds it. r refreshes. ' +
        'Also: /issues new [epic] captures an issue to the Inbox, /issues setup links a project, /issues check says what is missing. /issues help lists everything.');
});
test('a wrapping row counts the lines its items take', () => {
    expect(wrappedLines([6, 10, 10], 40)).toBe(1);
    expect(wrappedLines([6, 10, 10], 28)).toBe(1);
    expect(wrappedLines([6, 10, 10], 27)).toBe(2);
    // An item wider than the row still takes a line of its own.
    expect(wrappedLines([50, 4], 40)).toBe(2);
});
test('every hover card sits above its row, trimmed near the top, and none where there is no room', async ($, on) => {
    const issues = [1, 2, 3, 4, 5, 6, 7].map(number => ({
        number,
        title: `Issue ${number}`,
        labels: [],
        body: '- [ ] One.\n- [ ] Two.',
        updatedAt: '2026-10-03T20:00:00Z',
    }));
    on('process.run', async (_$, e) => {
        const stdout = isIssuesQuery(e.argv) ? graphPage(issues) : e.argv[1] === 'repo' ? JSON.stringify({ nameWithOwner: 'astrosteveo/claude-plugins', hasIssuesEnabled: true }) : '[]';
        return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
    });
    await $.command.run({ command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } });
    const tops = async (offset, bodyRows) => {
        const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE, props: { ...PANE.props, scroll: { offset, bodyRows } } });
        const found = (await ui.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute').map(box => Number(box.props.top));
        await ui.unmount();
        return found;
    };
    // A whole card takes seven lines. Above the first row are four: the repo line, the trends, the Issues heading and the
    // group's. The first rows' cards are trimmed to fit above them; from the fourth row down they are whole. None goes
    // below its row, where the rows after it would paint over it.
    const tops$ = await tops(0, 40);
    expect(tops$).toEqual([-4, -5, -6, -7, -7, -7, -7]);
    // Scrolled so the first row is at the window's top: the rows near it have no room for a card, so none shows.
    expect(await tops(4, 40)).toEqual([-4, -5, -6]);
});
test('a narrow row drops its chips, then its bar, then its age, and the title keeps the rest', () => {
    const parts = { chips: 14, bar: 10, age: 4, rest: 0 };
    expect(rowRoom(100, 6, parts)).toEqual({ chips: true, bar: true, age: true, title: 66 });
    expect(rowRoom(56, 6, parts)).toEqual({ chips: false, bar: true, age: true, title: 36 });
    expect(rowRoom(40, 6, parts)).toEqual({ chips: false, bar: false, age: true, title: 30 });
    expect(rowRoom(30, 6, parts)).toEqual({ chips: false, bar: false, age: false, title: 24 });
    // What always stays, such as the agent badge, still leaves the title a cell rather than wrapping the row.
    expect(rowRoom(30, 6, { ...parts, rest: 40 })).toEqual({ chips: false, bar: false, age: false, title: 1 });
    // A part the row hasn't is never shown.
    expect(rowRoom(100, 6, { chips: 0, bar: 0, age: 4, rest: 0 })).toEqual({ chips: false, bar: false, age: true, title: 90 });
});
test('the pane has no blank lines between sections, short group headers and the progress at the right', async ($, on) => {
    on('process.run', async (_$, e) => {
        const stdout = isIssuesQuery(e.argv) ? graphPage(ISSUES) : e.argv[1] === 'repo' ? JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }) : '[]';
        return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
    });
    await $.command.run({ command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } });
    const textOf = (node) => typeof node === 'string' ? node : node.props?.position === 'absolute' ? '' : node.type === 'Button' ? (node.props?.label ?? '') : (node.children ?? []).map(textOf).join('');
    const rowOf = async (ui, number) => ((await ui.find({ key: `row-${number}` }))?.children ?? []).map(child => textOf(child)).join('|');
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    await ui.press({ key: 'filter-all' });
    // No pull requests are open, so there is no section for them.
    expect(await ui.find({ text: /Pull requests/ })).toBeUndefined();
    // A group header is its name and its count: no rule, no percentage.
    const groups = (await ui.findAll({ type: 'Box' })).filter(box => String(box.props.key ?? '').startsWith('group-'));
    expect(groups.length).toBe(2);
    expect(groups.some(box => /─|%/.test(box.text))).toBe(false);
    const header = (await ui.findAll({ type: 'Box' })).find(box => box.text === 'simulation1');
    expect(header).toBeDefined();
    expect((await ui.findAll({ type: 'Text' })).find(text => text.text === 'simulation')?.props).toMatchObject({ bold: true, color: 'claude' });
    // The number and title start the row; the bar and count sit before the age at its right. No boxes, no bar.
    expect(await rowOf(ui, 315)).toMatch(/^\|  #315 Lay Kessik out for play\|.*━━━ 2\/3 +\S+$/);
    expect(await rowOf(ui, 289)).toMatch(/^\|▲ #289 Asteroids didn't draw\| +\S+$/);
    // Nothing puts a blank line above it while no card is open.
    expect((await ui.findAll({ type: 'Box' })).filter(box => box.props.marginTop)).toEqual([]);
    // An open card keeps the space below it.
    await ui.press({ key: 'issue-315' });
    expect((await ui.find({ key: 'card-315' }))?.props.marginBottom).toBe(1);
    await ui.unmount();
    // A narrow pane gives up the bar, then the age, and keeps the title on one line.
    for (const [columns, bar, age] of [[60, true, true], [44, false, true]]) {
        const narrow = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: columns } });
        await narrow.press({ key: 'filter-all' });
        const row = await rowOf(narrow, 315);
        expect(/━━━ 2\/3/.test(row)).toBe(bar);
        expect(/\d[mhdwy]$|now$/.test(row)).toBe(age);
        expect(cells(row)).toBeLessThan(columns);
        await narrow.unmount();
    }
});
test('velocity counts each week and draws it as a sparkline', () => {
    const at = Date.parse('2026-10-03T12:00:00Z');
    expect(weekly(['2026-10-03T00:00:00Z', '2026-10-01T00:00:00Z', '2026-09-24T00:00:00Z', '2025-01-01T00:00:00Z'], at, 3)).toEqual([0, 1, 2]);
    expect(spark([0, 1, 2, 4])).toBe('▁▃▅█');
    expect(spark([0, 0])).toBe('▁▁');
});
test('the pane lists the issues by filter and opens one to its boxes', async ($, on) => {
    on('process.run', async (_$, e) => {
        const kind = e.argv[1];
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const stdout = isIssuesQuery(e.argv)
            ? graphPage(ISSUES)
            : kind === 'repo'
                ? JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true })
                : e.argv.includes('closed')
                    ? JSON.stringify([{ closedAt: yesterday }, { closedAt: yesterday }])
                    : e.argv.includes('merged')
                        ? JSON.stringify([{ mergedAt: yesterday }])
                        : JSON.stringify(kind === 'issue' ? ISSUES : PRS);
        return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
    });
    const sent = [];
    on('prompt.submit', async (_$, e) => {
        sent.push(e.text);
        return { text: e.text };
    });
    await $.command.run({
        command: 'issues',
        args: 'refresh',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: true, columns: 120 },
    });
    for (const surface of ['terminal', 'desktop']) {
        const ui = await $.ui.mount({ plugin: 'issue-board', surface, ...PANE });
        expect(await ui.find({ text: /^Glide in to a planet$/ })).toBeDefined();
        expect((await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('filter-')).map(one => one.props.hotkey)).toEqual(['1', '2', '3', '4', '5', '7']);
        expect(await ui.find({ text: / ✓ PASS / })).toBeDefined();
        // A pull request is one row; its title opens its details, link included, beneath it.
        expect(await ui.find({ type: 'Link' })).toBeUndefined();
        expect(await ui.find({ text: /approved/ })).toBeUndefined();
        await ui.press({ key: 'pr-335' });
        expect(await ui.find({ text: /^· ● approved$/ })).toBeDefined();
        // A board without URLs links to the page the repo gives.
        expect((await ui.findAll({ type: 'Link' })).map(link => link.props.href)).toEqual(['https://github.com/astrosteveo/void-sector/pull/335']);
        await ui.press({ key: 'pr-335' });
        expect(await ui.find({ text: /approved/ })).toBeUndefined();
        expect(await ui.find({ key: 'issue-289' })).toBeDefined();
        expect(await ui.find({ key: 'issue-315' })).toBeUndefined();
        expect(await ui.find({ text: /^closed / })).toBeDefined();
        expect((await ui.find({ text: /^ 2$/ }))?.props.bold).toBe(true);
        // The hover preview is drawn hidden beside the row, shown by the surface on hover. It sits at the pane's right, so
        // the rows above keep their mark, number and the start of their title clear for the pointer moving up.
        expect(await ui.find({ text: /^ No acceptance boxes\. +$/ })).toBeDefined();
        const previews = (await ui.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute');
        expect(previews.length).toBeGreaterThan(0);
        expect(previews.every(box => box.props.left === 44 && box.props.width === 56)).toBe(true);
        await ui.press({ key: 'filter-future' });
        expect(await ui.find({ key: 'issue-315' })).toBeDefined();
        expect(await ui.find({ key: 'start-315' })).toBeUndefined();
        await ui.press({ key: 'issue-315' });
        expect(await ui.find({ text: /Goldens regenerated/ })).toBeDefined();
        expect(await ui.find({ text: / 2\/3/ })).toBeDefined();
        expect(await ui.find({ text: /@astrosteveo/ })).toBeDefined();
        expect(await ui.find({ text: /^s start/ })).toBeDefined();
        expect(await ui.find({ key: 'draft-315' })).toMatchObject({ text: '✎ Edit first', props: { hotkey: 'e' } });
        expect(await ui.find({ key: 'close-315' })).toMatchObject({ text: 'Collapse', props: { hotkey: 'x' } });
        expect((await ui.findAll({ type: 'Link' })).map(link => link.props.href)).toContain('https://github.com/astrosteveo/void-sector/issues/315');
        const holding = (match) => (element) => element.children.some(child => match(child));
        expect((await ui.findAll({ type: 'Box' })).find(holding(child => child.props?.key === 'start-315'))?.props.flexWrap).toBe('wrap');
        expect((await ui.findAll({ type: 'Text' })).filter(holding(child => child.type === 'Link')).map(text => text.props.wrap)).toEqual(['truncate-end']);
        // A box's mark keeps its two cells beside a long box, whose text wraps in the room the mark leaves.
        expect((await ui.find({ key: 'box-row-315-1' }))?.children.map(child => child.props?.flexShrink)).toEqual([0, 1]);
        // The card shows the issue's text, without the boxes it lists as buttons or the heading they leave empty.
        expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('Kessik needs a layout for play.');
        // Opening it also scrolls it into view: the engine resolves that against a real window, which a test hasn't.
        expect(await ui.find({ key: 'card-315' })).toBeDefined();
        await ui.press({ key: 'start-315' });
        expect(sent.at(-1)).toMatch(/^Let's start on #315: Lay Kessik out for play\./);
        expect(sent.at(-1)).toMatch(/- Goldens regenerated$/);
        expect(sent.at(-1)).not.toMatch(/Layout in place/);
        // One card at a time: opening another folds the first, and the new one takes the letter keys.
        await ui.press({ key: 'filter-all' });
        await ui.press({ key: 'issue-289' });
        expect(await ui.find({ key: 'start-315' })).toBeUndefined();
        expect((await ui.find({ key: 'start-289' }))?.props.hotkey).toBe('s');
        expect(await ui.find({ text: /^s start/ })).toBeDefined();
        await ui.press({ key: 'issue-289' });
        // At 100 columns every key in full doesn't fit, so the filters show in short; their names are on the buttons above.
        expect(await ui.find({ text: /^⏎ open an issue · 1-7 filter · r refresh · m merge all PRs$/ })).toBeDefined();
        await ui.press({ key: 'filter-active' });
        await ui.unmount();
    }
    // A narrow pane keeps its one header line and leaves out the sparklines and the ticked meter.
    const narrow = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 80 } });
    expect((await narrow.find({ text: /^ 2$/ }))?.props.bold).toBe(true);
    expect(await narrow.find({ text: /^closed / })).toBeUndefined();
    expect(await narrow.find({ text: /^ \d+%$/ })).toBeUndefined();
    // Its preview narrows to keep the left of the rows clear; a pane too narrow for both shows none.
    expect((await narrow.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute').map(box => [box.props.left, box.props.width])).toContainEqual([28, 52]);
    await narrow.unmount();
    const slim = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 50 } });
    expect((await slim.findAll({ type: 'Box' })).filter(box => box.props.position === 'absolute')).toEqual([]);
    await slim.unmount();
});
test('the summary names what is open, and nothing when nothing is', () => {
    expect(summary([], [])).toBeUndefined();
    const issue = { number: 1, title: 'One', url: '', labels: [], assignees: [], checks: [], updatedAt: '', body: '' };
    expect(summary([issue], [])).toBe('1 issue');
});
test("the summary leaves out the pull request Claude Code's footer already shows, and only that one", () => {
    const issue = { number: 1, title: 'One', url: '', labels: [], assignees: [], checks: [], updatedAt: '', body: '' };
    const pr = (number, branch, ci) => ({ number, title: '', url: '', author: '', branch, isDraft: false, ci, review: '' });
    const prs = [pr(276, 'fix/276-footer', 'pass'), pr(280, 'feat/280-other', 'fail')];
    expect(summary([issue], prs)).toBe('1 issue · PR #276✓ #280✗');
    expect(summary([issue], prs, undefined, null)).toBe('1 issue · PR #276✓ #280✗');
    expect(summary([issue], prs, undefined, 'fix/276-footer')).toBe('1 issue · PR #280✗');
    // A branch with no pull request on the board leaves the list as it is.
    expect(summary([issue], prs, undefined, 'main')).toBe('1 issue · PR #276✓ #280✗');
    // With only the footer's pull request open, the list goes, and with nothing else open, the summary does.
    expect(summary([issue], prs.slice(0, 1), undefined, 'fix/276-footer')).toBe('1 issue');
    expect(summary([], prs.slice(0, 1), undefined, 'fix/276-footer')).toBeUndefined();
});
const HINT = { component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } };
const REFRESH = { command: 'issues', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } };
test('the hint under the prompt carries the summary, and nothing with nothing open', async ($, on) => {
    let repo = { nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true };
    let issues = ISSUES;
    let prs = PRS;
    const issueCalls = [];
    on('process.run', async (_$, e) => {
        const kind = e.argv[1];
        if (kind === 'issue')
            issueCalls.push([...e.argv]);
        const stdout = isIssuesQuery(e.argv) ? graphPage(issues) : kind === 'repo' ? JSON.stringify(repo) : e.argv.includes('closed') || e.argv.includes('merged') ? '[]' : JSON.stringify(kind === 'issue' ? issues : prs);
        return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
    });
    // What the engine draws: its hint, then ` · ` and the tail the plugins added.
    on('ui.render', { component: 'PromptHint' }, async ($$, e) => {
        const { Text } = $$.ui.resolve(e);
        return <Text>{e.props.tail ? `${e.props.hint} · ${e.props.tail}` : e.props.hint}</Text>;
    });
    const hint = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...HINT });
    const shows = async (text) => expect(await hint.drawn()).toMatchObject({ type: 'Text', children: [text] });
    await $.command.run(REFRESH);
    await shows('? for shortcuts · 2 issues · 1 bug · PR #335✓');
    issues = [];
    prs = [];
    const reply = await $.command.run(REFRESH);
    await shows('? for shortcuts');
    expect(reply.text).toBe('Refreshed: nothing open.');
    // A repo with issues turned off: no issue calls, and its pull requests still show.
    repo = { ...repo, hasIssuesEnabled: false };
    prs = PRS;
    issueCalls.length = 0;
    await $.command.run(REFRESH);
    expect(issueCalls).toEqual([]);
    await shows('? for shortcuts · PR #335✓');
    await hint.unmount();
});
// The person's Esc reaches plugins as their close of the pane, which a test can't raise: the ui.close hook that turns
// it into a collapse while a card is open is left to the live session.
test('the pane opens to close on Esc, and Collapse folds the card', async ($, on) => {
    on('process.run', async (_$, e) => {
        const kind = e.argv[1];
        const stdout = isIssuesQuery(e.argv) ? graphPage(ISSUES) : kind === 'repo' ? JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true }) : e.argv.includes('closed') || e.argv.includes('merged') ? '[]' : JSON.stringify(kind === 'issue' ? ISSUES : PRS);
        return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
    });
    const opened = [];
    on('ui.open', async (_$, e) => {
        opened.push(e);
        return { value: { isPlaced: true } };
    });
    await $.command.run({ command: 'issues', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } });
    expect(opened).toEqual([{ id: 'issue-board', title: 'Issues', focus: true, closeOnEscape: true }]);
    // The pane reads GitHub as it opens: wait for that read.
    await $.command.run(REFRESH);
    const ui = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    await ui.press({ key: 'filter-all' });
    await ui.press({ key: 'issue-315' });
    expect(await ui.find({ key: 'start-315' })).toBeDefined();
    expect(await ui.find({ text: /x or esc collapse/ })).toBeDefined();
    await ui.press({ key: 'close-315' });
    expect(await ui.find({ key: 'start-315' })).toBeUndefined();
    expect(await ui.find({ key: 'issue-315' })).toBeDefined();
    await ui.unmount();
});
// GitHub with the board's issues and pull requests, counting every call the board makes.
const quiet = (on) => {
    const state = { calls: 0 };
    on('process.run', async (_$, e) => {
        state.calls += 1;
        const kind = e.argv[1];
        const stdout = isIssuesQuery(e.argv)
            ? graphPage(ISSUES)
            : kind === 'repo'
                ? JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true })
                : e.argv.includes('closed') || e.argv.includes('merged')
                    ? '[]'
                    : JSON.stringify(kind === 'issue' ? ISSUES : PRS);
        return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
    });
    return state;
};
test('by default the board looks at GitHub again five minutes after a read', async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-06T10:00:00Z') });
    const gh = quiet(on);
    await $.command.run(REFRESH);
    await clock.settle();
    const after = gh.calls;
    await clock.advance(4 * 60 * 1000);
    expect(gh.calls).toBe(after);
    await clock.advance(60 * 1000);
    expect(gh.calls).toBeGreaterThan(after);
});
test('set to 15 minutes, the board waits that long before it looks again', { options: { refresh: '15' } }, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-06T10:00:00Z') });
    const gh = quiet(on);
    await $.command.run(REFRESH);
    await clock.settle();
    const after = gh.calls;
    await clock.advance(14 * 60 * 1000);
    expect(gh.calls).toBe(after);
    await clock.advance(60 * 1000);
    expect(gh.calls).toBeGreaterThan(after);
});
test('set to 60 minutes, the board waits an hour', { options: { refresh: '60' } }, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-06T10:00:00Z') });
    const gh = quiet(on);
    await $.command.run(REFRESH);
    await clock.settle();
    const after = gh.calls;
    await clock.advance(59 * 60 * 1000);
    expect(gh.calls).toBe(after);
    await clock.advance(60 * 1000);
    expect(gh.calls).toBeGreaterThan(after);
});
test('set to manual, the board looks at GitHub only when asked', { options: { refresh: 'manual' } }, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-06T10:00:00Z') });
    const gh = quiet(on);
    await $.command.run(REFRESH);
    await clock.settle();
    const after = gh.calls;
    await clock.advance(3 * 60 * 60 * 1000);
    expect(gh.calls).toBe(after);
    await $.command.run(REFRESH);
    expect(gh.calls).toBeGreaterThan(after);
});
// Claude Code's /config row for its own PR footer, as `$.config.list()` returns it.
const footerRow = (value) => ({ key: 'prStatus', label: 'Show PR status footer', kind: 'boolean', value, provider: { plugin: 'engine', tier: 'core' }, isLocked: false });
test("while Claude Code's PR footer is on, the hint's tail leaves out the branch's pull request", async ($, on) => {
    const other = { ...PRS[0], number: 336, title: 'Dock at a station', headRefName: 'feat/336-dock', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] };
    let here = 'fix/planet-glide';
    let footer = true;
    on('process.run', async (_$, e) => {
        const kind = e.argv[1];
        const stdout = e.argv[0] === 'git' && kind === 'branch'
            ? `${here}\n`
            : isIssuesQuery(e.argv)
                ? graphPage(ISSUES)
                : kind === 'repo'
                    ? JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: true })
                    : e.argv.includes('closed') || e.argv.includes('merged')
                        ? '[]'
                        : JSON.stringify(kind === 'issue' ? ISSUES : [...PRS, other]);
        return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
    });
    on('config.list', async () => ({ value: [footerRow(footer)] }));
    on('ui.render', { component: 'PromptHint' }, async ($$, e) => {
        const { Text } = $$.ui.resolve(e);
        return <Text>{e.props.tail ? `${e.props.hint} · ${e.props.tail}` : e.props.hint}</Text>;
    });
    const hint = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...HINT });
    const shows = async (text) => expect(await hint.drawn()).toMatchObject({ type: 'Text', children: [text] });
    await $.command.run(REFRESH);
    await shows('? for shortcuts · 2 issues · 1 bug · PR #336✗');
    // It still has its row in the pane, with its CI.
    const pane = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...PANE });
    expect(await pane.find({ text: /#335/ })).toBeDefined();
    await pane.unmount();
    // The footer turned off: the tail lists every pull request again.
    footer = false;
    await $.command.run(REFRESH);
    await shows('? for shortcuts · 2 issues · 1 bug · PR #335✓ #336✗');
    // On a branch with no pull request, nothing is left out.
    footer = true;
    here = 'main';
    await $.command.run(REFRESH);
    await shows('? for shortcuts · 2 issues · 1 bug · PR #335✓ #336✗');
    await hint.unmount();
});
test('with its summary turned off, the hint under the prompt keeps its own text', { options: { hintSummary: false } }, async ($, on) => {
    quiet(on);
    on('ui.render', { component: 'PromptHint' }, async ($$, e) => {
        const { Text } = $$.ui.resolve(e);
        return <Text>{e.props.tail ? `${e.props.hint} · ${e.props.tail}` : e.props.hint}</Text>;
    });
    const hint = await $.ui.mount({ plugin: 'issue-board', surface: 'terminal', ...HINT });
    await $.command.run(REFRESH);
    expect(await hint.drawn()).toMatchObject({ type: 'Text', children: ['? for shortcuts'] });
});
