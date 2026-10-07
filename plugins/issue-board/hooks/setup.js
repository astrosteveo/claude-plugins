import { BUG_LABELS } from './markers';
import { fieldOf, nodesOf } from './parse';
import { ROLE_NAMES, ROLE_ORDER, rolesFor } from './project';
// The board's Status options, in its order, with the color and description a new one gets.
export const STATUSES = [
    { name: 'Inbox', color: 'GRAY', description: 'New, not looked at yet' },
    { name: 'Backlog', color: 'BLUE', description: 'Scoped, for later' },
    { name: 'Ready', color: 'GREEN', description: 'Ready to start' },
    { name: 'In progress', color: 'YELLOW', description: 'Being worked on' },
    { name: 'Verification', color: 'ORANGE', description: 'Built; a check or sign-off remains' },
    { name: 'Done', color: 'PURPLE', description: 'Acceptance met' },
];
export const PRIORITIES = [
    { name: 'P0', color: 'RED', description: 'Blocks the release' },
    { name: 'P1', color: 'ORANGE', description: 'Planned work' },
    { name: 'P2', color: 'GRAY', description: 'Future or optional' },
];
// The project automations the board relies on. GitHub's API can read them but not turn them on.
// The project's own workflows the board wants on: they put new issues and sub-issues in the project.
export const AUTOMATIONS = ['Auto-add to project', 'Auto-add sub-issues to project'];
// And the one it wants off: "Item closed" marks every closed issue Done, even one closed as not planned or as a duplicate,
// so Done stops meaning shipped. The board moves only issues closed as completed to Done.
export const UNWANTED = ['Item closed'];
const OPTION = 'options { id name color description }';
// The repo, its labels, and its linked projects with their single-select fields and automations.
export const FACTS_QUERY = 'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id nameWithOwner hasIssuesEnabled viewerPermission owner { id } ' +
    'labels(first: 100) { nodes { name } } ' +
    `projectsV2(first: 10) { nodes { id number title url closed fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name ${OPTION} } } } ` +
    'workflows(first: 20) { nodes { name enabled } } } } } }';
// The open issues, 100 a page, with their item and Status in each project.
export const ITEMS_QUERY = 'query($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) { issues(first: 100, states: OPEN, after: $after) { ' +
    'pageInfo { hasNextPage endCursor } nodes { id number projectItems(first: 10) { nodes { id project { id } ' +
    'status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } } } }';
// One project's fields again, after setup created it or changed them.
export const PROJECT_QUERY = `query($id: ID!) { node(id: $id) { ... on ProjectV2 { id number title url fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name ${OPTION} } } } workflows(first: 20) { nodes { name enabled } } } } }`;
export const CREATE_PROJECT = 'mutation($owner: ID!, $title: String!, $repo: ID!) { createProjectV2(input: {ownerId: $owner, title: $title, repositoryId: $repo}) { projectV2 { id number title url } } }';
export const UPDATE_FIELD = 'mutation($field: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]) { updateProjectV2Field(input: {fieldId: $field, singleSelectOptions: $options}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }';
export const CREATE_FIELD = 'mutation($project: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]) { createProjectV2Field(input: {projectId: $project, dataType: SINGLE_SELECT, name: $name, singleSelectOptions: $options}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }';
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
// A project as setup reads it, from the facts query or the one-project query.
export const projectOf = (raw) => ({
    id: raw.id,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    status: fieldOf(raw, 'Status'),
    priority: fieldOf(raw, 'Priority'),
    workflows: nodesOf(raw.workflows),
});
// The facts from the facts query and the pages of the items query; `suggested` and `hasTemplate` come from the folder.
export const factsOf = (json, pages, suggested, hasTemplate) => {
    const repo = JSON.parse(json).data?.repository;
    if (!repo)
        throw new Error("GitHub didn't answer with the repository");
    const issues = pages.flatMap(page => (JSON.parse(page).data?.repository?.issues?.nodes ?? []).filter(one => one !== null));
    return {
        repo: { id: repo.id, name: repo.nameWithOwner, ownerId: repo.owner.id, hasIssues: repo.hasIssuesEnabled, permission: repo.viewerPermission ?? null },
        projects: nodesOf(repo.projectsV2)
            .filter(one => !one.closed)
            .map(projectOf),
        labels: nodesOf(repo.labels).map(label => label.name),
        issues: issues.map(issue => ({
            id: issue.id,
            number: issue.number,
            items: nodesOf(issue.projectItems).flatMap(item => (item.project ? [{ project: item.project.id, item: item.id, status: item.status?.name ?? null }] : [])),
        })),
        suggested,
        hasTemplate,
    };
};
// Where the next page of issues starts, or null after the last.
export const nextItemsOf = (json) => {
    const info = JSON.parse(json).data?.repository?.issues?.pageInfo;
    return info?.hasNextPage && info.endCursor ? info.endCursor : null;
};
// What setup suggests for each role: the project's option with the board's name, whatever its case, or the board's name
// for setup to add.
export const suggestRoles = (options) => Object.fromEntries(ROLE_ORDER.map(role => [role, options.find(one => same(one.name, ROLE_NAMES[role]))?.name ?? ROLE_NAMES[role]]));
// The Status options with the ones the picks name but the project lacks added: by default, every one of the board's it
// lacks. The existing ones stay as they are, ids and all, so issues keep their Status, and where they are. A new one goes
// in before the next of the board's options the project has, or last. A name matches whatever its case, so a project's
// `In Progress` stands for `In progress`.
export const mergeStatuses = (existing, picks = suggestRoles(existing)) => {
    const options = [...existing];
    const added = [];
    const picked = Object.values(picks).filter((name) => name !== null);
    STATUSES.forEach((wanted, index) => {
        if (!picked.some(name => same(name, wanted.name)) || options.some(one => same(one.name, wanted.name)))
            return;
        const next = STATUSES.slice(index + 1).find(later => options.some(one => same(one.name, later.name)));
        const at = next ? options.findIndex(one => same(one.name, next.name)) : options.length;
        options.splice(at, 0, { ...wanted });
        added.push(wanted.name);
    });
    return { options, added };
};
// A new project's Status before setup changes it: GitHub's own three.
const DEFAULT_STATUS = [
    { name: 'Todo', color: 'GREEN', description: '' },
    { name: 'In Progress', color: 'YELLOW', description: '' },
    { name: 'Done', color: 'PURPLE', description: '' },
];
const AREA = /^area:/;
// The `area:` labels to create: the ones typed in the field, without `area:` or the ones the repo has.
export const areasOf = (typed, labels) => [
    ...new Set(typed
        .split(/[,\s]+/)
        .map(one => one.trim().replace(AREA, '').toLowerCase())
        .filter(one => /^[a-z0-9][a-z0-9._-]*$/.test(one) && !labels.includes(`area:${one}`))),
];
// The area labels setup offers: none when the repo has some, else the repo's own parts, read from its folders.
export const suggestAreas = (labels, folders) => {
    if (labels.some(label => AREA.test(label)))
        return [];
    const grouped = ['plugins', 'packages', 'apps', 'services', 'src'];
    const parts = grouped.flatMap(group => folders.nested[group] ?? []);
    const names = parts.length > 0 ? parts : folders.top.filter(one => !grouped.includes(one));
    const skip = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'target', 'tests', 'test', 'docs', 'scripts', 'bin']);
    return [...new Set(names.map(one => one.toLowerCase()).filter(one => !one.startsWith('.') && !skip.has(one) && /^[a-z0-9][a-z0-9._-]*$/.test(one)))].slice(0, 8);
};
// The Status options setup starts from for a project: its own, or GitHub's three for one it creates.
export const statusOptionsOf = (project) => (project ? (project.status?.options ?? []) : DEFAULT_STATUS);
// The roles the board goes by for a project now: what setup saved for it, or the board's names.
const rolesNow = (facts, project) => project.status ? rolesFor({ id: project.status.id, options: project.status.options.map(one => ({ id: one.id ?? '', name: one.name })) }, facts.saved?.project === project.id ? facts.saved.roles : undefined) : {};
// The picks as a line: each role and its option, or none.
export const picksText = (picks) => ROLE_ORDER.map(role => `${ROLE_NAMES[role]}: ${picks[role] ?? 'none'}`).join(', ');
// What setup will change: each step only when something is missing. `chosen` is the project picked (null: create one),
// `picks` the option for each role, the board's names by default.
export const stepsOf = (facts, chosen, typed, picks) => {
    const steps = [];
    const project = facts.projects.find(one => one.id === chosen);
    const name = facts.repo.name.split('/')[1] ?? facts.repo.name;
    const existing = statusOptionsOf(project);
    const roles = picks ?? suggestRoles(existing);
    // Apply lets the board write to the project it sets up. A project it creates is adopted as it is made. Facts read
    // without what the board may write to leave this step out.
    if (project && facts.adopted !== undefined && facts.adopted !== project.id)
        steps.push({ id: 'adopt', title: `Let the board write to ${project.title}` });
    if (!facts.repo.hasIssues)
        steps.push({ id: 'issues', title: `Turn on issues for ${facts.repo.name}` });
    if (!project)
        steps.push({ id: 'project', title: `Create the project "${name}" and link it to ${facts.repo.name}` });
    const status = mergeStatuses(existing, roles);
    if (project && !project.status)
        steps.push({ id: 'status', title: 'The project has no Status field; add it in the project, then run setup again' });
    else if (status.added.length > 0)
        steps.push({ id: 'status', title: `Add Status options: ${status.added.join(', ')}` });
    // Roles that differ from what the board goes by now are saved, even when nothing else changes.
    const now = project?.status ? rolesNow(facts, project) : {};
    const next = rolesOf(existing, roles);
    if (project?.status && status.added.length === 0 && ROLE_ORDER.some(role => next[role] !== now[role])) {
        steps.push({ id: 'roles', title: `Go by these Status options: ${picksText(roles)}` });
    }
    if (!project?.priority)
        steps.push({ id: 'priority', title: 'Create a Priority field: P0, P1, P2' });
    // A repo that marks bugs its own way, such as with `defect`, keeps it: the board finds that label.
    if (!facts.labels.some(label => BUG_LABELS.includes(label.toLowerCase())))
        steps.push({ id: 'bug', title: 'Create the label bug' });
    const areas = areasOf(typed, facts.labels);
    if (areas.length > 0)
        steps.push({ id: 'areas', title: `Create the labels ${areas.map(one => `area:${one}`).join(', ')}` });
    const missing = facts.issues.filter(issue => !project || !issue.items.some(item => item.project === project.id));
    if (missing.length > 0)
        steps.push({ id: 'items', title: `Add ${missing.length} open ${missing.length === 1 ? 'issue' : 'issues'} to the project` });
    const unset = facts.issues.filter(issue => !project || !issue.items.some(item => item.project === project.id && item.status));
    if (unset.length > 0 && roles.inbox !== null)
        steps.push({ id: 'inbox', title: `Set Status to ${roles.inbox} on ${unset.length} ${unset.length === 1 ? 'issue that has' : 'issues that have'} none` });
    return steps;
};
// The automations that are off in a project, which only its settings page can turn on.
export const automationsOff = (project) => project ? AUTOMATIONS.filter(name => project.workflows.some(one => one.name === name && !one.enabled)) : AUTOMATIONS;
// The workflows the project has on that the board wants off.
export const automationsOn = (project) => project ? UNWANTED.filter(name => project.workflows.some(one => one.name === name && one.enabled)) : [];
// Whether the project still has GitHub's own Todo, which its "Item added to project" automation sets on new issues
// unless told otherwise, and it isn't the Inbox. The API can't read or change what the automation sets, so setup asks
// the person to set it to the Inbox.
export const addsAsTodo = (project, inbox = 'Inbox') => inbox !== null && !same(inbox, 'todo') && (project?.status?.options ?? [{ name: 'Todo' }]).some(option => same(option.name, 'todo'));
// Which Status option means what, for the board to save: each role's pick matched to an option by name, whatever its
// case; by default the board's names.
export const rolesOf = (options, picks = suggestRoles(options)) => Object.fromEntries(ROLE_ORDER.flatMap(role => {
    const pick = picks[role];
    const id = pick === null ? undefined : options.find(one => same(one.name, pick))?.id;
    return id ? [[role, id]] : [];
}));
// Roles by option id as picks by name, for setup to start from what the board goes by.
export const rolesAsPicks = (options, roles) => Object.fromEntries(ROLE_ORDER.map(role => [role, options.find(one => one.id !== undefined && one.id === roles[role])?.name ?? null]));
// The picks setup starts from for a project: what the board goes by when setup saved roles for it, else the board's
// names, with the ones the project lacks to add.
export const picksFor = (facts, chosen) => {
    const project = facts.projects.find(one => one.id === chosen);
    const options = statusOptionsOf(project);
    return project?.status && facts.saved?.project === project.id ? rolesAsPicks(options, rolesNow(facts, project)) : suggestRoles(options);
};
// What the template button hands Claude: a normal change to the repo, for the person to review.
export const templatePrompt = (repo) => [
    `Add an issue template to ${repo} at \`.github/ISSUE_TEMPLATE/task.yml\`, as a GitHub issue form.`,
    'It asks for what is wrong or wanted and why, then an "Acceptance" list written as task-list boxes ("- [ ] ..."), one checkable outcome each,',
    'so the issue board can show and tick them. Keep the wording short and plain.',
    'Make the change on a branch and open a pull request for me to review; don\'t merge it.',
].join(' ');
