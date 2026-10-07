import type { Board, BugMarker, Issue, Label, Markers } from '../types'

// What the board went by before it read the repo's own names: the label `bug`, and without a project the label
// `future`. A repo with none of the names below keeps them.
export const DEFAULT_MARKERS: Markers = { bug: { label: 'bug' }, later: 'future' }

// The names the board looks for, in the order it tries them, ignoring case.
export const BUG_LABELS = ['bug', 'type:bug', 'kind:bug', 'bug report', 'defect']
export const LATER_LABELS = ['future', 'later', 'someday', 'icebox']
// GitHub's issue type for bugs, where the repo's organization has types.
export const BUG_TYPE = 'Bug'

// GitHub keeps label, option and field names unique whatever their case, so a name matches in any case, and the
// space around it doesn't count.
export const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

export const isBug = (issue: Issue, markers: Markers = DEFAULT_MARKERS): boolean => {
  const bug = markers.bug
  if ('type' in bug) return !!issue.type && same(issue.type, bug.type)
  return issue.labels.some(label => same(label.name, bug.label))
}

export const isFuture = (issue: Issue, markers: Markers = DEFAULT_MARKERS): boolean => issue.labels.some(label => same(label.name, markers.later))

// Whether a label is the one that marks bugs, which a row shows as its badge instead of a chip.
export const isBugLabel = (label: Label, markers: Markers = DEFAULT_MARKERS): boolean => 'label' in markers.bug && same(label.name, markers.bug.label)

// What the guess reads: the repo's labels (the ones on its open issues, on a board read before it had them), its issue
// types, its open issues, and whether it has a project, which leaves Later to Priority.
type Repo = Pick<Board, 'issues'> & Partial<Pick<Board, 'labels' | 'issueTypes' | 'project'>>

// The markers the repo's own names suggest. Bugs: the Bug issue type when open issues use it, else the first bug label
// the repo has, else the Bug type when the repo offers it. Later, only without a project: the first later label. A
// part with nothing to go on is left out.
export const guessMarkers = (repo: Repo | null | undefined): Partial<Markers> => {
  if (!repo) return {}
  const labels = repo.labels ?? [...new Set(repo.issues.flatMap(issue => issue.labels.map(label => label.name)))]
  const pick = (names: string[]) => names.map(name => labels.find(one => same(one, name))).find(one => one !== undefined)
  const type = (repo.issueTypes ?? []).find(one => same(one, BUG_TYPE))
  const label = pick(BUG_LABELS)
  const used = type !== undefined && repo.issues.some(issue => !!issue.type && same(issue.type, type))
  const found: Partial<Markers> = {}
  if (type && (used || !label)) found.bug = { type }
  else if (label) found.bug = { label }
  const later = repo.project ? undefined : pick(LATER_LABELS)
  if (later) found.later = later
  return found
}

// The markers the board goes by: the person's choice, then the guess, then the old names.
export const markersFor = (guess: Partial<Markers>, chosen: Partial<Markers> | null | undefined): Markers => ({
  bug: chosen?.bug ?? guess.bug ?? DEFAULT_MARKERS.bug,
  later: chosen?.later ?? guess.later ?? DEFAULT_MARKERS.later,
})

// The markers the board goes by for a board and the person's choice.
export const markersOf = (repo: Repo | null | undefined, chosen: Partial<Markers> | null | undefined): Markers => markersFor(guessMarkers(repo), chosen)

// The parts of the guess the band asks the person to confirm: the ones they haven't chosen that differ from the old
// names. A repo whose bug label is `bug` isn't asked anything.
export const markerAskOf = (repo: Repo | null | undefined, chosen: Partial<Markers> | null | undefined): Partial<Markers> => {
  const guess = guessMarkers(repo)
  const ask: Partial<Markers> = {}
  if (!chosen?.bug && guess.bug && !('label' in guess.bug && same(guess.bug.label, 'bug'))) ask.bug = guess.bug
  if (!chosen?.later && guess.later && !same(guess.later, DEFAULT_MARKERS.later)) ask.later = guess.later
  return ask
}

// A bug marker in words: `the Bug issue type`, or `the label defect`.
export const bugMarkerText = (bug: BugMarker): string => ('type' in bug ? `the ${bug.type} issue type` : `the label ${bug.label}`)

// The guess as a line: `Bugs: the Bug issue type · Later: the label someday`.
export const markerText = (ask: Partial<Markers>): string =>
  [ask.bug ? `Bugs: ${bugMarkerText(ask.bug)}` : '', ask.later ? `Later: the label ${ask.later}` : ''].filter(Boolean).join(' · ')

// What tells one guess from another, kept with the answered Status guesses, so an answered one stays answered.
export const markerKey = (ask: Partial<Markers>): string =>
  `labels:${[ask.bug ? `bug=${'type' in ask.bug ? `type:${ask.bug.type}` : ask.bug.label}` : '', ask.later ? `later=${ask.later}` : ''].filter(Boolean).join(',')}`

// What `/issues labels` offers: the repo's issue types, then each label but the area ones, the markers in effect among
// them even when the repo no longer has them.
export const markerOptionsOf = (repo: Repo | null | undefined, markers: Markers): { types: string[]; labels: string[] } => {
  const labels = repo?.labels ?? [...new Set((repo?.issues ?? []).flatMap(issue => issue.labels.map(label => label.name)))]
  const kept = ['label' in markers.bug ? markers.bug.label : '', markers.later].filter(Boolean)
  const all = [...labels.filter(name => !name.startsWith('area:'))]
  for (const name of kept) if (!all.some(one => same(one, name))) all.push(name)
  const types = [...(repo?.issueTypes ?? [])]
  const bug = markers.bug
  if ('type' in bug && !types.some(one => same(one, bug.type))) types.push(bug.type)
  return { types, labels: all.sort((a, b) => a.localeCompare(b)) }
}
