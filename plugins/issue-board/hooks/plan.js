import { fieldValueOf, projectMoveOf, viewMatchOf } from './parse';
import { optionOf } from './project';
// A plan Claude proposes with project_plan: the changes it lists, checked against the board, each with its reason.
// The most changes one plan holds, so a runaway call can't fill the pane.
export const PLAN_LIMIT = 100;
// What one entry of the tool's `issues` list may change. Anything else is issue_update's.
const ISSUE_KEYS = new Set(['number', 'reason', 'status', 'priority', 'fields', 'addLabels', 'removeLabels', 'assign', 'unassign', 'milestone', 'parent', 'projectAfter']);
// What one entry of the tool's `labels` list may say.
const LABEL_KEYS = new Set(['name', 'reason', 'create', 'rename', 'color', 'description', 'delete']);
// What one entry of the tool's `views` list may hold: the view it changes (none to create one), and what it becomes.
const VIEW_KEYS = new Set(['view', 'reason', 'name', 'layout', 'filter', 'delete']);
const LAYOUTS = ['table', 'board', 'roadmap'];
// The issue a change is on; null for a change to the repo's labels or the project's views.
export const issueOf = (change) => (change.kind === 'label' || change.kind === 'view' ? null : change.number);
// The group a change's row goes in on the card: the repo's labels, its issue, or the project's views. Also the start of
// the row's id.
export const groupOf = (change) => (change.kind === 'label' || change.kind === 'view' ? change.kind : change.number);
// The name of the view a change is to: the view's own, or the new one's.
const viewNameOf = (change) => change.view?.name ?? change.to?.name ?? '';
// GitHub keeps label names unique whatever their case.
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const names = (value) => Array.isArray(value) ? value.filter((one) => typeof one === 'string' && one.trim() !== '').map(one => one.trim()) : [];
const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
// The name a kind goes by in the card, the prompt and the problems.
const KIND_NAMES = { status: 'Status', priority: 'Priority', field: 'fields', labels: 'labels', assignees: 'assignees', milestone: 'milestone', parent: 'parent', order: 'order', label: 'repo labels', view: 'views' };
// What a change touches, so the same thing changed twice for one issue, label or view is caught.
const slotOf = (change) => {
    if (change.kind === 'label')
        return `label ${change.name.toLowerCase()}`;
    if (change.kind === 'view')
        return change.view ? `view ${change.view.number}` : `new view ${viewNameOf(change).toLowerCase()}`;
    return `${change.number} ${change.kind}${change.kind === 'field' ? ` ${change.field.toLowerCase()}` : ''}`;
};
// One entry of the tool's `views` list as a change, or null with its problems added. An entry without `view` creates
// one; with `view`, named by number or by name, it changes that view, or deletes it with `delete: true`. Filters are
// checked with the tabs' own parser: a term the board can't apply is allowed, and kept to say so on the row.
const viewChangeOf = (entry, index, context, problems) => {
    const one = (entry ?? {});
    const { project } = context;
    const named = typeof one.view === 'number' || typeof one.view === 'string' ? one.view : undefined;
    const name = text(one.name);
    const at = named !== undefined ? `View ${named}` : `New view ${name ?? `(entry ${index + 1})`}`;
    const before = problems.length;
    if (!project) {
        problems.push(`${at}: the board reads no project, so it can't change its views.`);
        return null;
    }
    if (!text(one.reason))
        problems.push(`${at} has no reason.`);
    const unknown = Object.keys(one).filter(key => !VIEW_KEYS.has(key));
    if (unknown.length > 0)
        problems.push(`${at}: a view entry can't hold ${unknown.join(', ')}.`);
    const written = text(one.layout)?.toLowerCase();
    const layout = LAYOUTS.find(known => known === written);
    if (written !== undefined && !layout)
        problems.push(`${at}: a layout is table, board or roadmap, not ${written}.`);
    if (one.filter !== undefined && typeof one.filter !== 'string')
        problems.push(`${at}: give its filter as text.`);
    const filter = typeof one.filter === 'string' ? one.filter.trim() : undefined;
    let view = null;
    if (named !== undefined) {
        const views = project.views;
        const found = views?.filter(known => (typeof named === 'number' ? known.number === named : known.name.toLowerCase() === named.trim().toLowerCase())) ?? [];
        if (!views)
            problems.push(`${at}: the board hasn't read ${project.title}'s views; refresh it and try again.`);
        else if (found.length > 1)
            problems.push(`${at}: ${project.title} has ${found.length} views called ${named}; name it by number.`);
        else if (!found[0])
            problems.push(`${at}: ${project.title} has no such view${views.length > 0 ? `; it has ${views.map(known => `${known.name} (${known.number})`).join(', ')}` : ''}.`);
        else
            view = found[0];
    }
    if (one.delete === true) {
        if (named === undefined)
            problems.push(`${at}: give view, the view to delete.`);
        else if (name !== undefined || written !== undefined || filter !== undefined)
            problems.push(`${at}: a view that's deleted takes no name, layout or filter.`);
        return problems.length > before || !view ? null : { kind: 'view', view, to: null, partial: [] };
    }
    if (problems.length > before)
        return null;
    let to;
    if (!view) {
        if (!name) {
            problems.push(`${at} has no name.`);
            return null;
        }
        to = { name, layout: layout ?? 'table', filter: filter ?? '' };
    }
    else {
        to = { name: name ?? view.name, layout: layout ?? view.layout, filter: filter ?? view.filter };
        if (to.name === view.name && to.layout === view.layout && to.filter === view.filter) {
            problems.push(`${at} changes nothing.`);
            return null;
        }
    }
    // Only a filter the plan sets is checked; one the view keeps shows on its tab as it did.
    const partial = filter ? viewMatchOf(filter, project).unknown : [];
    return { kind: 'view', view, to, partial };
};
// The label changes of project_plan's input, one row each. Their problems go on `problems`.
const labelChangesOf = (entries, context, problems) => {
    const changes = [];
    const repo = context.labels;
    const known = (name) => repo?.find(one => same(one, name));
    entries.forEach((entry, index) => {
        const one = (entry ?? {});
        const given = text(one.name);
        if (!given) {
            problems.push(`Label ${index + 1} has no name.`);
            return;
        }
        const name = known(given) ?? given;
        const at = `Label ${name}`;
        const reason = text(one.reason);
        if (!reason)
            problems.push(`${at} has no reason.`);
        const unknown = Object.keys(one).filter(key => !LABEL_KEYS.has(key));
        if (unknown.length > 0)
            problems.push(`${at}: a plan can't change its ${unknown.join(', ')}.`);
        const rename = text(one.rename);
        const description = typeof one.description === 'string' ? one.description.trim() : undefined;
        let color;
        if (one.color !== undefined) {
            color = typeof one.color === 'string' ? one.color.trim().replace(/^#/, '').toLowerCase() : '';
            if (!/^[0-9a-f]{6}$/.test(color))
                problems.push(`${at}: color takes six hex digits, such as d73a4a, not ${String(one.color)}.`);
        }
        const action = one.create === true ? 'create' : one.delete === true ? 'delete' : 'edit';
        if (one.create === true && one.delete === true)
            problems.push(`${at} can't be made and deleted at once.`);
        else if (action === 'create') {
            if (known(given))
                problems.push(`The repo already has a label called ${name}.`);
            if (rename)
                problems.push(`${at}: name a new label as you want it, without rename.`);
        }
        else if (repo && !known(given))
            problems.push(`The repo has no label called ${given}.`);
        else if (action === 'delete' && (rename || color !== undefined || description !== undefined))
            problems.push(`${at}: a delete changes nothing else.`);
        else if (action === 'edit' && !rename && color === undefined && description === undefined)
            problems.push(`${at} changes nothing.`);
        const taken = action === 'edit' && rename && !same(rename, name) ? known(rename) : undefined;
        if (taken)
            problems.push(`The repo already has a label called ${taken}.`);
        // The saved markers that go by the label: a rename moves them and a delete clears them.
        const saved = context.markers ?? {};
        const moves = action === 'delete' || (action === 'edit' && !!rename);
        const markers = moves
            ? [saved.bug && 'label' in saved.bug && same(saved.bug.label, name) ? 'bug' : null, saved.later && same(saved.later, name) ? 'later' : null].filter(Boolean)
            : [];
        changes.push({
            change: {
                kind: 'label',
                action,
                name,
                ...(rename && action === 'edit' ? { rename } : {}),
                ...(color !== undefined && action !== 'delete' ? { color } : {}),
                ...(description !== undefined && action !== 'delete' ? { description } : {}),
                ...(markers.length > 0 ? { markers } : {}),
            },
            reason: reason ?? '',
        });
    });
    return changes;
};
// The changes project_plan's input asks for, checked against the board as a whole: every problem is listed at once, and
// a plan with any problem is refused. Each entry may change several things on its issue; each becomes a row of its own,
// with the entry's reason. Changes to the repo's labels come first, so an issue can take a label the plan makes; then
// the rows are grouped by issue, in the order the issues first come, and the changes to the project's views come last,
// in the plan's order. They apply in that order.
export const planOf = (input, context) => {
    const raw = (input ?? {});
    const entries = Array.isArray(raw.issues) ? raw.issues : [];
    const labelEntries = Array.isArray(raw.labels) ? raw.labels : [];
    const viewEntries = Array.isArray(raw.views) ? raw.views : [];
    if (entries.length === 0 && labelEntries.length === 0 && viewEntries.length === 0)
        return { problems: ['Give issues, labels or views: lists of changes, each with a reason.'] };
    const problems = [];
    const changes = labelChangesOf(labelEntries, context, problems);
    const { project } = context;
    const open = new Set(context.issues.map(one => one.number));
    entries.forEach((entry, index) => {
        const one = (entry ?? {});
        const number = one.number;
        if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
            problems.push(`Entry ${index + 1} has no issue number.`);
            return;
        }
        const at = `#${number}`;
        if (!open.has(number))
            problems.push(`${at} isn't an open issue on the board.`);
        const reason = text(one.reason);
        if (!reason)
            problems.push(`${at} has no reason.`);
        const unknown = Object.keys(one).filter(key => !ISSUE_KEYS.has(key));
        if (unknown.length > 0)
            problems.push(`${at}: a plan can't change ${unknown.join(', ')}; use issue_update for that.`);
        const made = [];
        for (const kind of ['status', 'priority']) {
            const value = text(one[kind]);
            if (!value)
                continue;
            const field = kind === 'status' ? project?.status : project?.priority;
            const option = optionOf(field, value);
            if (!project)
                problems.push(`${at}: the board reads no project, so it can't set ${KIND_NAMES[kind]}.`);
            else if (!option)
                problems.push(`${at}: ${project.title} has no ${KIND_NAMES[kind]} called ${value}${field?.options.length ? `; it has ${field.options.map(o => o.name).join(', ')}` : ''}.`);
            else
                made.push({ kind, number, value: option.name });
        }
        if (one.fields && typeof one.fields === 'object' && !Array.isArray(one.fields)) {
            for (const [name, value] of Object.entries(one.fields)) {
                if (/^(status|priority)$/i.test(name.trim())) {
                    problems.push(`${at}: set ${name.trim()} with ${name.trim().toLowerCase()}, not fields.`);
                    continue;
                }
                if (!project) {
                    problems.push(`${at}: the board reads no project, so it can't set ${name}.`);
                    continue;
                }
                const field = project.fields?.find(known => known.name.toLowerCase() === name.trim().toLowerCase());
                if (!field) {
                    problems.push(`${at}: ${project.title} has no field called ${name}.`);
                    continue;
                }
                if (value !== null) {
                    const fits = fieldValueOf(field, value);
                    if (typeof fits === 'string') {
                        problems.push(`${at}: ${fits}.`);
                        continue;
                    }
                }
                made.push({ kind: 'field', number, field: field.name, value: value === null ? null : typeof value === 'number' ? value : String(value).trim() });
            }
        }
        for (const [kind, add, remove] of [
            ['labels', names(one.addLabels), names(one.removeLabels)],
            ['assignees', names(one.assign), names(one.unassign)],
        ]) {
            if (add.length > 0 || remove.length > 0)
                made.push({ kind, number, add, remove });
        }
        if (typeof one.milestone === 'string') {
            const title = one.milestone.trim();
            const known = context.milestones?.find(milestone => milestone.title.toLowerCase() === title.toLowerCase());
            if (title && context.milestones && !known)
                problems.push(`${at}: the repo has no open milestone called ${title}.`);
            else
                made.push({ kind: 'milestone', number, value: title ? (known?.title ?? title) : null });
        }
        if (typeof one.parent === 'number' && Number.isInteger(one.parent) && one.parent >= 0) {
            if (one.parent === number)
                problems.push(`${at} can't be its own parent.`);
            else if (one.parent > 0 && !open.has(one.parent))
                problems.push(`${at}: its parent #${one.parent} isn't an open issue on the board.`);
            else
                made.push({ kind: 'parent', number, value: one.parent > 0 ? one.parent : null });
        }
        if (typeof one.projectAfter === 'number' && Number.isInteger(one.projectAfter) && one.projectAfter >= 0) {
            // An issue the project doesn't hold yet joins it when the plan sets one of its fields first, so it can move then.
            const joins = made.some(touchesProject);
            const issues = context.issues.map(issue => (issue.number === number && joins && !issue.item ? { ...issue, item: 'joining' } : issue));
            const move = project ? projectMoveOf(issues, number, one.projectAfter > 0 ? one.projectAfter : null, false) : null;
            if (!project)
                problems.push(`${at}: the board reads no project, so it can't move it in the project's order.`);
            else if (typeof move === 'string') {
                if (open.has(number))
                    problems.push(`${at}: ${move.replace(`#${number} `, '')}.`);
            }
            else
                made.push({ kind: 'order', number, after: one.projectAfter > 0 ? one.projectAfter : null });
        }
        // An entry that asks for nothing a plan changes; one whose changes were refused already says why.
        const asked = Object.keys(one).some(key => ISSUE_KEYS.has(key) && key !== 'number' && key !== 'reason');
        if (made.length === 0 && !asked && unknown.length === 0)
            problems.push(`${at} changes nothing.`);
        for (const change of made)
            changes.push({ change, reason: reason ?? '' });
    });
    viewEntries.forEach((entry, index) => {
        const change = viewChangeOf(entry, index, context, problems);
        if (change)
            changes.push({ change, reason: text(entry?.reason) ?? '' });
    });
    const seen = new Set();
    for (const { change } of changes) {
        const slot = slotOf(change);
        if (seen.has(slot))
            problems.push(`${subjectOf(change)} is in the plan twice.`);
        seen.add(slot);
    }
    if (changes.length > PLAN_LIMIT)
        problems.push(`A plan holds at most ${PLAN_LIMIT} changes; this one has ${changes.length}. Split it.`);
    if (context.refusal && changes.some(({ change }) => touchesProject(change)))
        problems.unshift(context.refusal);
    if (problems.length > 0)
        return { problems: [...new Set(problems)] };
    const order = [...new Set(changes.map(({ change }) => groupOf(change)))];
    return { changes: order.flatMap(group => changes.filter(({ change }) => groupOf(change) === group)) };
};
// What a change touches, for the problem of a plan that changes it twice: `#340's Status`, `Label bug`, `View Bugs`.
const subjectOf = (change) => change.kind === 'label' ? `Label ${change.name}` : change.kind === 'view' ? `View ${viewNameOf(change)}` : `#${change.number}'s ${change.kind === 'field' ? change.field : KIND_NAMES[change.kind]}`;
// Whether a change writes to the project rather than to the issue.
export const touchesProject = (change) => change.kind === 'status' || change.kind === 'priority' || change.kind === 'field' || change.kind === 'order' || change.kind === 'view';
// The change as issue_update makes it.
export const issueChangesOf = (change) => {
    switch (change.kind) {
        case 'status':
            return { status: change.value };
        case 'priority':
            return { priority: change.value };
        case 'field':
            return { fields: { [change.field]: change.value } };
        case 'labels':
            return { ...(change.add.length > 0 ? { addLabels: change.add } : {}), ...(change.remove.length > 0 ? { removeLabels: change.remove } : {}) };
        case 'assignees':
            return { ...(change.add.length > 0 ? { assign: change.add } : {}), ...(change.remove.length > 0 ? { unassign: change.remove } : {}) };
        case 'milestone':
            return { milestone: change.value };
        case 'parent':
            return { parent: change.value };
        case 'order':
            return { projectAfter: change.after ?? 0 };
    }
};
// A change in a few words, for its row on the card: `Status → Ready`, `labels +bug −area:ui`, `under #35`.
export const changeText = (change) => {
    const both = (add, remove) => [...add.map(one => `+${one}`), ...remove.map(one => `−${one}`)].join(' ');
    switch (change.kind) {
        case 'status':
        case 'priority':
            return `${KIND_NAMES[change.kind]} → ${change.value}`;
        case 'field':
            return change.value === null ? `${change.field} cleared` : `${change.field} → ${change.value}`;
        case 'labels':
        case 'assignees':
            return `${change.kind} ${both(change.add, change.remove)}`;
        case 'milestone':
            return change.value === null ? 'off its milestone' : `milestone → ${change.value}`;
        case 'parent':
            return change.value === null ? 'out of its epic' : `under #${change.value}`;
        case 'order':
            return change.after === null ? "top of the project's order" : `after #${change.after} in the order`;
        case 'label':
            return labelText(change);
        case 'view':
            return viewText(change);
    }
};
// A change split for its row on the card: the head goes on the row's button, which can't wrap, and the rest in text
// beside it, which can. A label or view change says what it does to which label or view in the head, and its counts,
// colors, markers and filters in the rest, so a long filter can't push the button past a narrow pane. Other changes
// are short, and all head.
export const cardParts = (change) => {
    const full = changeText(change);
    let head = full;
    if (change.kind === 'label')
        head = change.action === 'create' ? `new label ${change.name}` : change.action === 'delete' ? `delete label ${change.name}` : `label ${change.name}${change.rename ? ` → ${change.rename}` : ''}`;
    if (change.kind === 'view')
        head = !change.to ? `delete view ${viewNameOf(change)}` : !change.view ? `new ${change.to.layout} view ${change.to.name}` : `view ${change.view.name}`;
    return { head, detail: full.slice(head.length).replace(/^(?: · |: | )/, '') };
};
// A change with what it is on, for lists outside the card: `#340 Status → Ready`, `new label area:net`, `new table view
// Bugs`.
export const rowText = (change) => (issueOf(change) === null ? changeText(change) : `#${issueOf(change)} ${changeText(change)}`);
// What a view change does, in a few words: `new table view Bugs · label:bug`, `view Bugs: renamed Triage, filter
// cleared`, `delete view Bugs · label:bug`. A delete names the filter, or says it had none, so the person sees what goes.
const viewText = (change) => {
    const { view, to } = change;
    if (!to)
        return `delete view ${view?.name ?? ''} · ${view?.filter ? view.filter : 'no filter'}`;
    if (!view)
        return `new ${to.layout} view ${to.name}${to.filter ? ` · ${to.filter}` : ''}`;
    const parts = [
        ...(to.name !== view.name ? [`renamed ${to.name}`] : []),
        ...(to.layout !== view.layout ? [`${to.layout} layout`] : []),
        ...(to.filter !== view.filter ? [to.filter ? `filter ${to.filter}` : 'filter cleared'] : []),
    ];
    return `view ${view.name}: ${parts.join(', ')}`;
};
// The note under a view's row when its filter holds terms the board can't apply. Those terms are left out of the tab's
// filter, so the tab shows every issue the rest keeps.
export const viewNoteOf = (change) => change.kind === 'view' && change.partial.length > 0
    ? `The board can't apply ${change.partial.join(' ')}, so its tab in /issues leaves ${change.partial.length === 1 ? 'that term' : 'those terms'} out and shows more than GitHub does.`
    : null;
// What an applied view change answers.
export const viewDoneText = (change) => {
    const partial = change.partial.length > 0 ? ` Its tab leaves out ${change.partial.join(' ')}, which the board can't apply.` : '';
    if (!change.to)
        return `Deleted the view ${viewNameOf(change)}.`;
    if (!change.view)
        return `Created the ${change.to.layout} view ${change.to.name}${change.to.filter ? ` with the filter ${change.to.filter}` : ''}.${partial}`;
    return `Changed the ${viewText(change)}.${partial}`;
};
// A label change in a few words: `new label area:net #1d76db`, `label bug → defect`, `delete label wontfix · on 3 open
// and 2 closed issues`, with what it does to a saved marker.
const labelText = (change) => {
    const looks = [change.color ? `#${change.color}` : '', change.description !== undefined ? `“${change.description}”` : ''].filter(Boolean).join(' ');
    const markers = (change.markers ?? []).map(one => (one === 'bug' ? 'Bugs' : 'Later')).join(' and ');
    const marker = markers ? ` · ${change.action === 'delete' ? `clears the saved ${markers} marker` : `the saved ${markers} marker follows`}` : '';
    if (change.action === 'create')
        return `new label ${change.name}${looks ? ` ${looks}` : ''}`;
    if (change.action === 'edit')
        return `label ${change.name}${change.rename ? ` → ${change.rename}` : ''}${looks ? ` ${looks}` : ''}${marker}`;
    const count = change.uses ? change.uses.open + change.uses.closed : 0;
    const uses = change.uses === null ? " · couldn't count its issues" : change.uses ? ` · on ${change.uses.open} open and ${change.uses.closed} closed ${count === 1 ? 'issue' : 'issues'}` : '';
    return `delete label ${change.name}${uses}${marker}`;
};
// The plan's rows, each ticked, with an id that stays the row's own through an Apply.
export const rowsOf = (changes) => changes.map(({ change, reason }, index) => ({ id: `${groupOf(change)}-${index + 1}`, change, reason, picked: true, failed: null }));
// How many changes to how many issues, labels and views: `5 changes to 3 issues`, `4 changes to 2 issues and 2 labels`,
// `6 changes to 3 issues, 2 labels and 1 view`.
export const sizeText = (changes) => {
    const issues = new Set(changes.map(issueOf).filter(one => one !== null)).size;
    const labels = changes.filter(change => change.kind === 'label').length;
    const views = changes.filter(change => change.kind === 'view').length;
    const count = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
    const what = [issues > 0 || labels + views === 0 ? count(issues, 'issue') : '', labels > 0 ? count(labels, 'label') : '', views > 0 ? count(views, 'view') : ''].filter(Boolean);
    const listed = what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what.at(-1)}` : (what[0] ?? '');
    return `${count(changes.length, 'change')} to ${listed}`;
};
// The changes counted by kind, in the order kinds first come: `Status 3 · Priority 2 · labels 1`.
export const kindsText = (changes) => {
    const counts = new Map();
    for (const change of changes)
        counts.set(KIND_NAMES[change.kind], (counts.get(KIND_NAMES[change.kind]) ?? 0) + 1);
    return [...counts].map(([name, count]) => `${name} ${count}`).join(' · ');
};
// What the permission prompt for project_plan says: the plan's size and its changes by kind.
export const planAsk = (changes) => `Apply Claude's plan: ${sizeText(changes)}?\n${kindsText(changes)}\nThe /issues pane shows it row by row, to apply only some.`;
// What a refused plan tells Claude: every problem, one a line.
export const problemsOfPlan = (problems) => `The plan wasn't made. Fix ${problems.length === 1 ? 'this' : 'these'} and call again:\n${problems.map(one => `- ${one}`).join('\n')}`;
// What an Apply answers: how many changes went through, each one's text, and each failure with why. The failed rows stay
// on the card. Ticked rows the board showed as made already were skipped, and are named too.
export const appliedText = (done, failed, skipped = []) => {
    const total = done.length + failed.length;
    const head = total === 0
        ? `Nothing was applied: ${skipped.length === 1 ? 'the ticked change was' : `all ${skipped.length} ticked changes were`} made already.`
        : failed.length === 0
            ? `Applied the plan: ${total} ${total === 1 ? 'change' : 'changes'}.`
            : `Applied ${done.length} of ${total} changes. ${failed.length} failed and ${failed.length === 1 ? 'stays' : 'stay'} on the plan card in /issues.`;
    const skips = total > 0 && skipped.length > 0 ? ` Skipped ${skipped.length} made already.` : '';
    return [
        `${head}${skips}`,
        ...done,
        ...failed.map(({ row, message }) => `Failed: ${rowText(row.change)}: ${message}`),
        ...skipped.map(row => `Skipped, made already: ${rowText(row.change)}`),
    ].join('\n');
};
// Whether the board shows a change as made already, as when Claude made it with issue_update after proposing the plan.
// A change the board can't check, such as a field it doesn't read or a label's color, counts as not made, so its row
// stays. So does a change to an issue the board no longer holds, as when it was closed.
export const alreadyTrue = (change, state) => {
    if (change.kind === 'label') {
        const repo = state.labels;
        if (!repo)
            return false;
        const has = (name) => repo.some(one => same(one, name));
        if (change.action === 'create')
            return has(change.name);
        if (change.action === 'delete')
            return !has(change.name);
        // A rename shows in the names alone. A new color or description doesn't, so a change with one stays.
        if (!change.rename || same(change.rename, change.name) || change.color !== undefined || change.description !== undefined)
            return false;
        return has(change.rename) && !has(change.name);
    }
    if (change.kind === 'view') {
        const views = state.project?.views;
        if (!views)
            return false;
        const { view, to } = change;
        if (!to)
            return !!view && !views.some(one => one.number === view.number);
        const now = view ? views.find(one => one.number === view.number) : views.find(one => one.name.toLowerCase() === to.name.toLowerCase());
        return !!now && now.name === to.name && now.layout === to.layout && now.filter === to.filter;
    }
    const issue = state.issues.find(one => one.number === change.number);
    if (!issue)
        return false;
    switch (change.kind) {
        case 'status':
        case 'priority': {
            const value = issue[change.kind];
            return typeof value === 'string' && value.toLowerCase() === change.value.toLowerCase();
        }
        case 'field': {
            // The board reads only the fields a view needs, so a field it doesn't hold can't be checked, and neither can a
            // clear.
            const value = issue.fields?.[change.field];
            return change.value !== null && value !== undefined && value.toLowerCase() === String(change.value).toLowerCase();
        }
        case 'labels':
        case 'assignees': {
            const held = change.kind === 'labels' ? issue.labels.map(one => one.name) : issue.assignees;
            const has = (name) => held.some(one => same(one, name));
            return change.add.every(has) && !change.remove.some(has);
        }
        case 'milestone':
            if (issue.milestone === undefined)
                return false;
            return (issue.milestone ?? '').toLowerCase() === (change.value ?? '').toLowerCase();
        case 'parent':
            if (issue.parent === undefined)
                return false;
            return (issue.parent?.number ?? null) === change.value;
        case 'order': {
            if (issue.position === undefined)
                return false;
            const ordered = state.issues.filter(one => one.position !== undefined).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
            const at = ordered.findIndex(one => one.number === change.number);
            return change.after === null ? at === 0 : ordered[at - 1]?.number === change.after;
        }
    }
};
// The plan's rows still to make: those the board doesn't show as made already.
export const rowsToMake = (rows, state) => rows.filter(row => !alreadyTrue(row.change, state));
