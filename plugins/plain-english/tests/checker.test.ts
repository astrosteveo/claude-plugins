import { describe, expect, test } from 'claude-code/testing'

import { check, publishedText } from '../hooks/checker'

const rules = (text: string) => check(text).map(finding => finding.rule)

const LONG = Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ') + '.'

describe('the checker catches', () => {
  const caught: [string, string][] = [
    ['The fix is simple — restart the server.', 'em dash'],
    ['This is genuinely useful.', 'stock word'],
    ['It’s worth noting that the cache is cold.', 'stock word'],
    ['Under the hood, the drive aims at the centre.', 'stock word'],
    ['The catch: it only works on Linux.', 'reveal label'],
    ['- **Bottom line:** ship it.', 'reveal label'],
    ['Great question! Postgres is fine for this.', 'filler'],
    ['You’re absolutely right about the timeout.', 'filler'],
    ['Use SQLite.\n\nHope this helps.', 'filler'],
    ['There were two problems.\n\nThe drive aimed at the centre.', 'announcing sentence'],
    ['The design follows four rules.', 'announcing sentence'],
    ["Here's what happened:\n\n- The drive aimed at the centre.", 'announcing sentence'],
    [LONG, 'long sentence'],
  ]
  for (const [text, rule] of caught) {
    test(`${rule}: ${text.slice(0, 40)}`, () => {
      expect(rules(text)).toContain(rule)
    })
  }
})

describe('the checker lets through', () => {
  const clean = [
    'The label measured to the centre, not the surface.',
    'Ranges like 2–3 km use an en dash.',
    '```ts\nconst robust = leverage() // genuinely — fine in code\n```',
    'Call `leverage()` to start the drive.',
    'The wiki says "danger follows the ore — always" in its heading.',
    '> The catch: this is a quote.',
    'Switch to Postgres if any of these apply:\n\n- You run more than one server.',
    'The fix has two parts: the glide and the labels.',
    'Use the cruise drive for long order legs\n\nShips now use the cruise drive when an order sends them\nfar away. Before this change, an order flew at normal speed\nno matter how far it had to go. The map is about to spread out.',
    '| Field | Pay an hour |\n|---|---|\n| Quiet | 5,708 cr |',
  ]
  for (const text of clean) {
    test(text.slice(0, 50), () => {
      expect(check(text)).toEqual([])
    })
  }
})

describe('publishedText', () => {
  test('reads a heredoc commit message', () => {
    const command = `git commit -m "$(cat <<'EOF'\nAdd the gate\n\nIt blocks — sometimes.\nEOF\n)"`
    expect(publishedText(command)).toBe('Add the gate\n\nIt blocks — sometimes.')
  })

  test('reads -m, --title and --body', () => {
    expect(publishedText('git commit -m "Fix the label"')).toBe('Fix the label')
    expect(publishedText(`gh pr create --title "Add X" --body 'Adds X.'`)).toBe('Add X\n\nAdds X.')
  })

  test('ignores commands that publish nothing', () => {
    expect(publishedText('ls -la')).toBeUndefined()
    expect(publishedText('git log --grep "genuinely"')).toBeUndefined()
    expect(publishedText('git commit --amend --no-edit')).toBeUndefined()
  })
})
