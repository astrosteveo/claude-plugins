import type { Project, Role } from '../types'
import { ROLE_NAMES, projectKeysOf, roleOf } from './project'

// Where Start works by default: `main` starts the issue in this chat, `background` hands it to the board's agent and
// keeps the main-chat Start one key away.
export type StartMode = 'main' | 'background'
export const START_MODES: readonly StartMode[] = ['main', 'background']

// The person's settings, from the manifest's userConfig, each under its key there. plugin.json declares them for
// /config; this file is the one place the board defines them. What changes the shared project by itself is off for a
// new install; Start's own changes are on, since the person pressed Start. Of what the board adds to Claude's prompts,
// the working note with its pull request rule, the capture section and the copies of issues a prompt names are on. The
// next-step suggestion changes how Claude Code behaves, so it is off. Start works in the main chat unless the person
// asks for background workers.
export type Settings = {
  // Moves the board makes by itself: closed issues to Done, a Refs merge to Verification, and epics with their
  // sub-issues. Each also needs its Status role, so setting a role to none skips that one move.
  autoMove: boolean
  claimOnStart: boolean
  startMode: StartMode
  workingNote: boolean
  // The working note and the background agent say `Closes #N` only when every box is ticked, else `Refs #N`. Off, they
  // say nothing, which leaves it to the repository's own rules.
  closesWhenTicked: boolean
  // Whether the system prompt tells Claude to capture work it finds to the Inbox.
  capture: boolean
  issueCopies: boolean
  suggestNextStep: boolean
  followBranch: boolean
  band: boolean
  // How often the board looks at GitHub by itself, in minutes; null for only when asked.
  refresh: number | null
  // The projects the board may write to, as owner/number.
  writeProjects: string[]
}

// Each setting's name in /config, as plugin.json titles it. /issues check and /issues help name a setting by it.
export const SETTING_TITLES: Record<keyof Settings, string> = {
  autoMove: 'Move issues on their own',
  claimOnStart: 'Start assigns and moves the issue',
  startMode: 'Where Start works',
  workingNote: 'Working note in the system prompt',
  closesWhenTicked: 'Closes only when every box is ticked',
  capture: 'Capture section in the system prompt',
  issueCopies: 'Copies of issues a prompt names',
  suggestNextStep: 'Suggest the next step',
  followBranch: 'Follow the branch',
  band: 'Band above the prompt',
  refresh: 'How often the board reads GitHub',
  writeProjects: 'Projects the board may write to',
}

export const settingsOf = (options: Readonly<Record<string, unknown>> | undefined): Settings => ({
  autoMove: options?.autoMove === true,
  claimOnStart: options?.claimOnStart !== false,
  startMode: START_MODES.find(mode => mode === options?.startMode) ?? 'main',
  workingNote: options?.workingNote !== false,
  closesWhenTicked: options?.closesWhenTicked !== false,
  capture: options?.capture !== false,
  issueCopies: options?.issueCopies !== false,
  suggestNextStep: options?.suggestNextStep === true,
  followBranch: options?.followBranch !== false,
  band: options?.band !== false,
  refresh: options?.refresh === 'manual' ? null : options?.refresh === '15' ? 15 : options?.refresh === '60' ? 60 : 5,
  writeProjects: projectKeysOf(options?.writeProjects),
})

// The keys autoMove replaced. Claude Code passes the board only the keys plugin.json declares, so these are read from
// the settings files themselves.
const OLD_MOVES = ['moveToDone', 'moveToVerification', 'advanceEpics'] as const

// The settings with what an older board's keys said, for one release, where the stored options don't set the new key:
// any of the three moves on turns autoMove on, and prRule's `closes-when-ticked` keeps closesWhenTicked on while its
// `always-closes` and `none` turn it off. `stored` is the board's options as the settings files hold them.
export const withOldKeys = (settings: Settings, stored: Readonly<Record<string, unknown>>): Settings => ({
  ...settings,
  ...(stored.autoMove === undefined && OLD_MOVES.some(key => stored[key] === true) ? { autoMove: true } : {}),
  ...(stored.closesWhenTicked === undefined && typeof stored.prRule === 'string' ? { closesWhenTicked: stored.prRule === 'closes-when-ticked' } : {}),
})

// The settings that turn a feature off, by their key: true where the feature is on. `refresh` is false when the board
// reads GitHub only when asked. Where Start works and the projects the board may write to turn nothing off.
type SwitchKey = Exclude<keyof Settings, 'startMode' | 'writeProjects'>
export type Switches = Record<SwitchKey, boolean>

export const switchesOf = (settings: Settings): Switches => {
  const { startMode: _mode, writeProjects: _projects, ...rest } = settings
  return Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, value !== false && value !== null])) as Switches
}

// The board's features that a setting or a Status role can turn off: the setting's key, and the role the feature needs.
// Features may share a setting; when it is off, only the first of them is said.
const FEATURES: { feature: string; setting?: SwitchKey; role?: Role }[] = [
  { feature: 'Moving issues on their own: closed ones to Done, ones a Refs merge touched to Verification, and epics with their sub-issues', setting: 'autoMove' },
  { feature: 'Moving closed issues to Done', setting: 'autoMove', role: 'done' },
  { feature: 'Moving an issue a Refs merge touched to Verification', setting: 'autoMove', role: 'verification' },
  { feature: "Start moving the issue's Status", setting: 'claimOnStart', role: 'started' },
  { feature: 'The Inbox filter, its triage, and new issues landing in the Inbox', role: 'inbox' },
  { feature: "Triage's Accept moving issues to Ready", role: 'ready' },
  { feature: "The Backlog folding, and triage's Accept moving issues to it", role: 'backlog' },
  { feature: 'project_archive by doneBefore', role: 'done' },
  { feature: 'The working note in the system prompt', setting: 'workingNote' },
  { feature: "The working note's pull request rule", setting: 'closesWhenTicked' },
  { feature: 'The capture section in the system prompt', setting: 'capture' },
  { feature: 'Copies of the issues a prompt names', setting: 'issueCopies' },
  { feature: 'The next step suggested in the prompt box', setting: 'suggestNextStep' },
  { feature: 'Following the branch to the issue Claude is on', setting: 'followBranch' },
  { feature: 'The band above the prompt', setting: 'band' },
  { feature: 'Reading GitHub by itself', setting: 'refresh' },
]

// The features that are off, each with why: the setting that turned it off, or the Status role the project has no
// option for. A role counts only with a project that has a Status field. `writable` is false while the person hasn't
// let the board write to the project, which leaves every project write off, whatever the settings say.
export const featuresOff = (switches: Switches, project: Project | null | undefined, writable = true): { feature: string; why: string }[] => [
  ...(project && !writable
    ? [{ feature: 'Every change to the project: Status, Priority, adding items, archiving and status updates', why: `the board only reads ${project.title} until you let it write there; press Let it write in /issues, or Apply in /issues setup` }]
    : []),
  ...FEATURES.flatMap(({ feature, setting, role }, index) => {
    if (setting && !switches[setting]) {
      const first = FEATURES.findIndex(one => one.setting === setting) === index
      return first ? [{ feature, why: `turned off in /config by ${SETTING_TITLES[setting]} (${setting})` }] : []
    }
    if (role && project?.status && !roleOf(project, role)) {
      return [{ feature, why: `${project.title} has no Status option as the ${ROLE_NAMES[role]}; pick one in /issues statuses` }]
    }
    return []
  }),
]

// The features that are off, as lines for /issues check and /issues help; none when all are on.
export const offText = (off: { feature: string; why: string }[]): string[] => (off.length > 0 ? ['Off:', ...off.map(one => `- ${one.feature}: ${one.why}.`)] : [])
