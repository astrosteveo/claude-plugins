import type { UiCopyArgs } from 'claude-code'

import type { MarkerPicks, Markers, Problem, Project, Role, Setup, SetupProject, StatusPicks } from '../../types'
import { ROLE_NAMES, ROLE_ORDER } from '../project'
import { addsAsTodo, automationsOff, automationsOn, statusOptionsOf } from '../setup'
import type { Elements, PaneElements } from './parts'
import { partsOf } from './parts'

export type AccessHandlers = {
  copyFix: (problem: Problem, surface?: UiCopyArgs['surface']) => unknown
  recheck: () => unknown
}

// What the last permission check found missing, each with its fix.
export const accessCard = ({ Box, Text, Button, Link }: Elements, { problems }: { problems: Problem[] }, handlers: AccessHandlers) => {
  const blocked = problems.some(problem => problem.blocks)
  return (
    problems.length > 0 && (
      <Box flexDirection="column" borderStyle="round" borderColor={blocked ? 'error' : 'warning'} paddingX={1} marginTop={1}>
        <Text color={blocked ? 'error' : 'warning'} bold>
          {blocked ? '✗ Setup needed' : '⚠ The board is limited'}
        </Text>
        {problems.map(problem => (
          <Box key={`problem-${problem.id}`} flexDirection="column" marginTop={1}>
            <Text bold wrap="wrap">
              {problem.title}
            </Text>
            <Text dimColor wrap="wrap">
              {problem.detail}
            </Text>
            <Text wrap="wrap">{problem.fix}</Text>
            {problem.command && (
              <Box flexDirection="row">
                <Button key={`copy-fix-${problem.id}`} onPress={press => void handlers.copyFix(problem, press.surface)}>
                  Copy command
                </Button>
              </Box>
            )}
            {problem.url && !problem.command && <Link href={problem.url} label={`↗ ${problem.url.replace(/^https:\/\//, '')}`} />}
          </Box>
        ))}
        <Box flexDirection="row" marginTop={1}>
          <Button key="recheck" variant="primary" onPress={() => void handlers.recheck()}>
            Check again
          </Button>
        </Box>
      </Box>
    )
  )
}

export type AdoptHandlers = {
  adopt: (project: Project) => unknown
  decline: (project: Project) => unknown
}

// The one-time ask before the board writes to the project it reads: what it would write and what that costs. Setup
// showing asks the same through Apply, so this waits.
export const adoptCard = (
  elements: Elements,
  { asked, asking }: { asked: Project | null; asking: { title: string; lines: string[] } | null },
  handlers: AdoptHandlers,
) => {
  const { Box, Text, Button } = elements
  const { link } = partsOf(elements)
  return (
    asking &&
    asked && (
      <Box key="adopt-card" flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1} marginTop={1}>
        <Text color="warning" bold wrap="wrap">
          {`⚠ ${asking.title}`}
        </Text>
        {asking.lines.map((line, index) => (
          <Text key={`adopt-line-${index}`} dimColor={index > 0} wrap="wrap">
            {line}
          </Text>
        ))}
        <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
          <Button key="adopt-yes" variant="primary" onPress={() => void handlers.adopt(asked)}>
            Let it write
          </Button>
          <Button key="adopt-no" dimColor onPress={() => void handlers.decline(asked)}>
            Keep read-only
          </Button>
          {link(asked.url)}
        </Box>
      </Box>
    )
  )
}

export type StatusesHandlers = {
  pick: (role: Role, id: string | null) => () => unknown
  save: () => unknown
  cancel: () => unknown
}

// `/issues statuses`: Which Status is which alone, picked among the project's own options. Save keeps it in the
// store; adding an option the project lacks stays in /issues setup.
export const statusesCard = (elements: Elements, { mapping }: { mapping: StatusPicks | null }, handlers: StatusesHandlers) => {
  const { Box, Text, Button } = elements
  const { choice } = partsOf(elements)
  return (
    mapping && (
      <Box key="statuses-card" flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1} marginTop={1}>
        <Text color="suggestion" bold>
          {`⚙ Which Status is which in ${mapping.project.title}`}
        </Text>
        <Text dimColor wrap="wrap">
          Pick the option that plays each part, or none to turn that part off. Save keeps it here and changes nothing on GitHub.
        </Text>
        {ROLE_ORDER.map(role => {
          const pick = mapping.picks[role] ?? null
          const option = (key: string, label: string, id: string | null) => choice(`statuses-${role}-${key}`, label, pick === id, handlers.pick(role, id))
          return (
            <Box key={`statuses-${role}`} flexDirection="row" gap={1} flexWrap="wrap">
              <Text dimColor>{`${ROLE_NAMES[role]}${role === 'backlog' ? ' (folds)' : ''}`}</Text>
              {mapping.options.map(one => option(one.id, one.name, one.id))}
              {option('none', 'none', null)}
            </Box>
          )
        })}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Button key="statuses-save" variant="primary" onPress={() => void handlers.save()}>
            Save
          </Button>
          <Button key="statuses-cancel" dimColor onPress={() => void handlers.cancel()}>
            Cancel
          </Button>
        </Box>
      </Box>
    )
  )
}

export type LabelsHandlers = {
  pick: (picks: Partial<Markers>) => () => unknown
  save: () => unknown
  cancel: () => unknown
}

// `/issues labels`: which label or issue type Bugs goes by, and without a project which label Later does, picked
// among the repo's own. Save keeps it in the store.
export const labelsCard = (elements: Elements, { marking }: { marking: MarkerPicks | null }, handlers: LabelsHandlers) => {
  const { Box, Text, Button } = elements
  const { choice } = partsOf(elements)
  return (
    marking && (
      <Box key="labels-card" flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1} marginTop={1}>
        <Text color="suggestion" bold>
          ⚙ Which labels Bugs and Later go by
        </Text>
        <Text dimColor wrap="wrap">
          {marking.later
            ? 'Pick what marks a bug, and the label for Later. Save keeps it here and changes nothing on GitHub.'
            : 'Pick what marks a bug. With a project, Later goes by Priority. Save keeps it here and changes nothing on GitHub.'}
        </Text>
        <Box key="labels-bug" flexDirection="row" gap={1} flexWrap="wrap">
          <Text dimColor>Bugs</Text>
          {marking.types.map(type =>
            choice(`labels-bug-type-${type}`, `${type} type`, 'type' in marking.picks.bug && marking.picks.bug.type === type, handlers.pick({ bug: { type } })),
          )}
          {marking.labels.map(label =>
            choice(`labels-bug-${label}`, label, 'label' in marking.picks.bug && marking.picks.bug.label === label, handlers.pick({ bug: { label } })),
          )}
        </Box>
        {marking.later && (
          <Box key="labels-later" flexDirection="row" gap={1} flexWrap="wrap">
            <Text dimColor>Later</Text>
            {marking.labels.map(label => choice(`labels-later-${label}`, label, marking.picks.later === label, handlers.pick({ later: label })))}
          </Box>
        )}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Button key="labels-save" variant="primary" onPress={() => void handlers.save()}>
            Save
          </Button>
          <Button key="labels-cancel" dimColor onPress={() => void handlers.cancel()}>
            Cancel
          </Button>
        </Box>
      </Box>
    )
  )
}

export type SetupHandlers = {
  // Picks the project setup would use.
  choose: (id: string | null) => () => unknown
  // Keeps the area labels typed.
  typeAreas: (text: string) => unknown
  // Picks the option that plays a part.
  pickRole: (role: Role, name: string | null) => () => unknown
  release: (project: SetupProject | undefined) => unknown
  // Asks Claude for an issue template with an Acceptance list.
  askTemplate: (repo: string) => unknown
  apply: () => unknown
  close: () => unknown
}

const MARKS = { running: ['◌', 'warning'], done: ['✓', 'success'], failed: ['✗', 'error'], skipped: ['–', 'inactive'] } as const

// `/issues setup`: the project it would use, what it would change, what only the project's settings can turn on,
// and Apply, the one ask before anything changes. While Apply runs, each change is marked as it goes.
export const setupCard = (elements: PaneElements, { planned, autoMove }: { planned: Setup | null; autoMove: boolean }, handlers: SetupHandlers) => {
  const { Box, Text, Button, Link, Input } = elements
  const { link, choice } = partsOf(elements)
  const facts = planned && 'facts' in planned ? planned.facts : undefined
  const chosenProject = facts && planned && 'chosen' in planned ? facts.projects.find(one => one.id === planned.chosen) : undefined
  const manual = facts ? automationsOff(chosenProject) : []
  const unwanted = facts && planned && 'roles' in planned ? automationsOn(chosenProject, autoMove && planned.roles.done !== null) : []
  return (
    planned && (
      <Box key="setup-plan" flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1} marginTop={1}>
        <Text color="suggestion" bold>
          {`⚙ Set up ${facts?.repo.name ?? 'the repo'} for the board`}
        </Text>
        {planned.phase === 'reading' && <Text dimColor>◌ Reading the repo, its project and its issues…</Text>}
        {planned.phase === 'failed' && (
          <Box flexDirection="column">
            <Text color="error" wrap="wrap">{`Couldn't read what setup needs: ${planned.message}`}</Text>
            <Text dimColor>/issues check says what is missing and how to fix it.</Text>
          </Box>
        )}
        {facts && 'steps' in planned && (
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1} flexWrap="wrap" marginTop={1}>
              <Text dimColor>Project</Text>
              {facts.projects.length === 0 && <Text>{`none is linked to ${facts.repo.name}`}</Text>}
              {facts.projects.length === 1 && chosenProject && <Text bold>{`${chosenProject.title} (#${chosenProject.number})`}</Text>}
              {facts.projects.length > 1 &&
                facts.projects.map(one =>
                  choice(`setup-project-${one.number}`, `${one.title} #${one.number}`, one.id === planned.chosen, planned.phase === 'ready' ? handlers.choose(one.id) : () => undefined),
                )}
              {chosenProject && link(chosenProject.url)}
            </Box>
            {facts.adopted !== undefined && (
              <Box key="setup-adopted" flexDirection="row" gap={1} flexWrap="wrap">
                <Text dimColor>Writes</Text>
                {facts.adopted ? (
                  <Text>{`the board may write to ${facts.projects.find(one => one.id === facts.adopted)?.title ?? 'a project of this repo'}`}</Text>
                ) : (
                  <Text>{chosenProject ? `none: the board only reads ${chosenProject.title} until Apply` : 'none: the board writes to no project'}</Text>
                )}
                {facts.adopted && facts.granted && <Text dimColor>{"granted by this repo's .claude/settings.json; edit writeProjects there to release it"}</Text>}
                {facts.adopted && !facts.granted && planned.phase !== 'applying' && (
                  <Button key="setup-release" dimColor onPress={() => void handlers.release(facts.projects.find(one => one.id === facts.adopted))}>
                    Release
                  </Button>
                )}
              </Box>
            )}
            {planned.steps.length === 0 ? (
              <Text color="success">✓ Nothing to change: the repo and its project are set up for the board.</Text>
            ) : (
              <Box flexDirection="column" marginTop={1}>
                <Text bold>{planned.phase === 'ready' ? 'Apply will:' : 'Changes:'}</Text>
                {planned.steps.map(step => {
                  const [mark, color] = step.state ? MARKS[step.state] : (['✚', 'suggestion'] as const)
                  return (
                    <Box key={`setup-step-${step.id}`} flexDirection="column">
                      <Text wrap="wrap">
                        <Text color={color}>{`${mark} `}</Text>
                        <Text>{step.title}</Text>
                      </Text>
                      {step.message && (
                        <Text dimColor wrap="wrap">
                          {`  ${step.message}`}
                        </Text>
                      )}
                    </Box>
                  )
                })}
              </Box>
            )}
            {planned.phase === 'ready' && Input && !facts.labels.some(label => label.startsWith('area:')) && (
              <Box flexDirection="row" marginTop={1}>
                <Input
                  key="setup-areas"
                  label="area labels to create: "
                  placeholder="such as simulation, interface"
                  value={planned.areas}
                  submitLabel="update"
                  onInput={text => void handlers.typeAreas(text)}
                  onSubmit={text => void handlers.typeAreas(text)}
                />
              </Box>
            )}
            {chosenProject?.status && (
              <Box key="setup-roles" flexDirection="column" marginTop={1}>
                <Text bold>Which Status is which</Text>
                {ROLE_ORDER.map(role => {
                  const options = statusOptionsOf(chosenProject).map(one => one.name)
                  const own = ROLE_NAMES[role]
                  const pick = planned.roles[role]
                  const ready = planned.phase === 'ready'
                  const option = (key: string, label: string, name: string | null) =>
                    choice(`setup-role-${role}-${key}`, label, pick === name, ready ? handlers.pickRole(role, name) : () => undefined)
                  return (
                    <Box key={`setup-role-${role}`} flexDirection="row" gap={1} flexWrap="wrap">
                      <Text dimColor>{`${own}${role === 'backlog' ? ' (folds)' : ''}`}</Text>
                      {options.map(name => option(name, name, name))}
                      {!options.some(name => name.toLowerCase() === own.toLowerCase()) && option('add', `＋ ${own}`, own)}
                      {option('none', 'none', null)}
                    </Box>
                  )
                })}
              </Box>
            )}
            {(manual.length > 0 || unwanted.length > 0 || addsAsTodo(chosenProject, planned.roles.inbox)) && (
              <Box flexDirection="column" marginTop={1}>
                <Text color="warning">In the project's Workflows settings, by hand:</Text>
                {manual.length > 0 && <Text color="warning" wrap="wrap">{`  · turn on ${manual.join(', ')}`}</Text>}
                {unwanted.length > 0 && (
                  <Text color="warning" wrap="wrap">
                    {`  · turn off ${unwanted.join(', ')}: it marks every closed issue Done, even an abandoned one; the board moves issues closed as completed`}
                  </Text>
                )}
                {addsAsTodo(chosenProject, planned.roles.inbox) && (
                  <Text color="warning" wrap="wrap">
                    {`  · new issues arrive with Status Todo, GitHub's default, so they skip the Inbox: open Item added to project and set its Status to ${planned.roles.inbox}. Once it's set, delete the Todo option, which this note looks for.`}
                  </Text>
                )}
                {chosenProject && <Link href={`${chosenProject.url}/workflows`} label="↗ Workflows" />}
              </Box>
            )}
            {!facts.hasTemplate && (
              <Box flexDirection="row" gap={1} flexWrap="wrap" marginTop={1}>
                <Text dimColor>No issue template has an Acceptance list.</Text>
                <Button key="setup-template" dimColor onPress={() => void handlers.askTemplate(facts.repo.name)}>
                  Have Claude add one
                </Button>
              </Box>
            )}
            <Box flexDirection="row" gap={1} marginTop={1}>
              {planned.phase === 'ready' && planned.steps.length > 0 && (
                <Button key="setup-apply" variant="primary" onPress={() => void handlers.apply()}>
                  Apply
                </Button>
              )}
              {planned.phase === 'applying' && <Text color="warning">◌ Applying…</Text>}
              {planned.phase !== 'applying' && (
                <Button key="setup-close" dimColor onPress={() => void handlers.close()}>
                  {planned.phase === 'ready' && planned.steps.length > 0 ? 'Cancel' : 'Close'}
                </Button>
              )}
            </Box>
          </Box>
        )}
        {planned.phase === 'failed' && (
          <Box flexDirection="row" marginTop={1}>
            <Button key="setup-close" dimColor onPress={() => void handlers.close()}>
              Close
            </Button>
          </Box>
        )}
      </Box>
    )
  )
}
