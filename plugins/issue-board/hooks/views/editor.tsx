import type { FieldValues, Issue, ProjectField, TypedText } from '../../types'
import type { IssueChanges } from '../changes'
import { issueNumberIn } from '../changes'
import { fit } from '../layout'
import { labelsOf } from '../prompts'
import type { PaneElements } from './parts'
import { partsOf } from './parts'

export type EditorData = {
  issue: Issue
  // The GitHub login gh is signed in as; null before it is known.
  who: string | null
  // The repo's labels and open milestones; null until the editor first opens.
  offered: { labels: string[]; milestones: string[] } | null
  // The board's issues, whose labels stand in until the repo's are read.
  issues: Issue[]
  issueTypes: string[]
  // What the card's text fields hold.
  fields: TypedText
  // Whether the editor shows its rarer rows.
  more: boolean
  // The project's fields beyond Status and Priority, and what each issue has in them.
  otherFields: ProjectField[]
  fieldValues: Record<number, FieldValues>
  // The epic whose Close waits on a second press.
  armedClose: number | null
}

export type EditorHandlers = {
  // Keeps what a text field of the card holds, by its name.
  type: (key: string, text: string) => unknown
  // Empties a text field, then makes the change it asked for.
  submit: (number: number, key: string, edit: IssueChanges) => unknown
  change: (number: number, edit: IssueChanges) => unknown
  // Puts a request to edit the body in the prompt box.
  fillBody: (number: number) => unknown
  // Closes the issue as it says; an epic with sub-issues still open is armed first.
  close: (number: number, open: number, reason: 'completed' | 'not planned') => unknown
  // Closes the issue as a duplicate of another.
  duplicate: (number: number, of: number) => unknown
  toggleMore: () => unknown
}

// The card's editor: each row a change made on GitHub as soon as it's pressed or entered. Closing an epic whose
// sub-issues are still open takes a second press.
export const editor = (elements: PaneElements, data: EditorData, handlers: EditorHandlers) => {
  const { Box, Text, Button, Input } = elements
  const { choice } = partsOf(elements)
  const { issue, offered, fields, more, otherFields, fieldValues, armedClose } = data
  const n = issue.number
  const me = data.who ?? '@me'
  const mine = issue.assignees.includes(me)
  const open = (issue.subIssues?.total ?? 0) - (issue.subIssues?.completed ?? 0)
  const labels = [...new Set([...(offered?.labels ?? labelsOf(data.issues)), ...issue.labels.map(label => label.name)])].sort()
  const row = (label: string) => <Text dimColor>{label.padEnd(9)}</Text>
  return (
    <Box key={`editor-${n}`} flexDirection="column" marginTop={1}>
      {/* What it is. */}
      {Input && (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {row('Title')}
          <Input
            key={`title-${n}`}
            label=""
            placeholder={fit(issue.title, 50)}
            value={fields.title ?? ''}
            submitLabel="rename"
            onInput={text => void handlers.type('title', text)}
            onSubmit={text => {
              if (!text.trim() || text.trim() === issue.title) return
              void handlers.submit(n, 'title', { title: text.trim() })
            }}
          />
        </Box>
      )}
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {row('Boxes')}
        {Input && (
          <Input
            key={`box-${n}`}
            label="+ "
            placeholder="add an acceptance box"
            value={fields.box ?? ''}
            submitLabel="add"
            onInput={text => void handlers.type('box', text)}
            onSubmit={text => {
              if (!text.trim()) return
              void handlers.submit(n, 'box', { addBoxes: [text.trim()] })
            }}
          />
        )}
        <Button key={`body-${n}`} dimColor onPress={() => void handlers.fillBody(n)}>
          ✎ Edit the body with Claude
        </Button>
      </Box>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {row('Labels')}
        {labels.map(name => {
          const has = issue.labels.some(label => label.name === name)
          return choice(`label-${n}-${name}`, name, has, () => void handlers.change(n, has ? { removeLabels: [name] } : { addLabels: [name] }))
        })}
        {Input && (
          // A label the repo hasn't got yet is made, then put on the issue; Claude Code doesn't ask, as the person typed it.
          <Input
            key={`new-label-${n}`}
            label="+ "
            placeholder="new label"
            value={fields.label ?? ''}
            submitLabel="add"
            onInput={text => void handlers.type('label', text)}
            onSubmit={text => {
              if (!text.trim()) return
              void handlers.submit(n, 'label', { addLabels: [text.trim()] })
            }}
          />
        )}
      </Box>
      {more && (data.issueTypes.length > 0 && (
        <Box key={`type-row-${n}`} flexDirection="row" gap={1} flexWrap="wrap">
          {row('Type')}
          {data.issueTypes.map(name => choice(`type-${n}-${name}`, name, name === issue.type, () => void handlers.change(n, { type: name === issue.type ? null : name })))}
        </Box>
      ))}
      {/* Where it sits. */}
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {row('Epic')}
        <Text>{issue.parent ? `#${issue.parent.number} ${fit(issue.parent.title, 30)}` : 'none'}</Text>
        {issue.parent && (
          <Button key={`unparent-${n}`} dimColor onPress={() => void handlers.change(n, { parent: null })}>
            Take out
          </Button>
        )}
        {Input && (
          <Input
            key={`parent-${n}`}
            label="put under #"
            placeholder="epic number"
            value={fields.parent ?? ''}
            submitLabel="set"
            onInput={text => void handlers.type('parent', text)}
            onSubmit={text => {
              const parent = issueNumberIn(text)
              if (parent === null) return
              void handlers.submit(n, 'parent', { parent })
            }}
          />
        )}
      </Box>
      {more && (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {row('Milestone')}
          {!offered && <Text dimColor>reading…</Text>}
          {offered && offered.milestones.length === 0 && <Text dimColor>none in this repo</Text>}
          {(offered?.milestones ?? []).map(title => {
            const has = issue.milestone === title
            return choice(`milestone-${n}-${title}`, title, has, () => void handlers.change(n, { milestone: has ? null : title }))
          })}
        </Box>
      )}
      {more && (otherFields.map(field => {
        const now$ = fieldValues[n]?.[field.name]
        const key = `${n}-${field.id}`
        return (
          <Box key={`field-row-${key}`} flexDirection="row" gap={1} flexWrap="wrap">
            {row(fit(field.name, 9))}
            {field.kind === 'select' || field.kind === 'iteration'
              ? (field.options ?? []).map(option =>
                  choice(`field-${key}-${option.id}`, option.name, option.name === now$, () => void handlers.change(n, { fields: { [field.name]: option.name === now$ ? null : option.name } })),
                )
              : Input && (
                  <Input
                    key={`field-${key}`}
                    label=""
                    placeholder={now$ ?? (field.kind === 'date' ? 'YYYY-MM-DD' : field.kind === 'number' ? 'a number' : 'text')}
                    value={fields[key] ?? ''}
                    submitLabel="set"
                    onInput={text => void handlers.type(key, text)}
                    onSubmit={text => {
                      if (!text.trim()) return
                      void handlers.submit(n, key, { fields: { [field.name]: text.trim() } })
                    }}
                  />
                )}
            {now$ !== undefined && (
              <Button key={`field-clear-${key}`} dimColor onPress={() => void handlers.change(n, { fields: { [field.name]: null } })}>
                clear
              </Button>
            )}
          </Box>
        )
      }))}
      {/* Who has it. */}
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {row('Assignee')}
        {issue.assignees.filter(login => login !== me).map(login => (
          <Text color="suggestion">{`@${login}`}</Text>
        ))}
        <Button key={`assign-${n}`} dimColor={mine} onPress={() => void handlers.change(n, mine ? { unassign: ['@me'] } : { assign: ['@me'] })}>
          {mine ? `Unassign me (@${me})` : 'Assign me'}
        </Button>
      </Box>
      {/* Ending it. */}
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {row('Close')}
        <Button key={`close-completed-${n}`} dimColor onPress={() => void handlers.close(n, open, 'completed')}>
          as completed
        </Button>
        <Button key={`close-not-planned-${n}`} dimColor onPress={() => void handlers.close(n, open, 'not planned')}>
          as not planned
        </Button>
        {more && Input && (
          <Input
            key={`duplicate-${n}`}
            label="as duplicate of #"
            placeholder="issue number"
            value={fields.duplicate ?? ''}
            submitLabel="close"
            onInput={text => void handlers.type('duplicate', text)}
            onSubmit={text => {
              const of = issueNumberIn(text)
              if (of === null || of === n) return
              void handlers.duplicate(n, of)
            }}
          />
        )}
      </Box>
      {armedClose === n && (
        <Text color="warning" wrap="wrap">{`#${n} is an epic with ${open} open ${open === 1 ? 'sub-issue' : 'sub-issues'}. Closing it leaves them open under a closed epic. Press again to close it anyway.`}</Text>
      )}
      <Box key={`more-row-${n}`} flexDirection="row">
        <Button key={`more-${n}`} dimColor onPress={() => void handlers.toggleMore()}>
          {more ? '▴ Less' : `▾ More: ${[data.issueTypes.length > 0 ? 'type' : '', 'milestone', otherFields.length > 0 ? 'fields' : '', 'duplicate'].filter(Boolean).join(', ')}`}
        </Button>
      </Box>
    </Box>
  )
}
