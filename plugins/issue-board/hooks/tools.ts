import type { ToolSpec } from 'claude-code'

// The board's tools for Claude: what Claude Code registers for each, and the line /issues help gives it. Pure data, so
// the help and the registration come from the one list.

// The agent type Start in background runs, as `$.agent.register` names it.
export const WORKER = 'issue-board:worker'

// One of the board's tools: its name, description and input schema as registered, and `what`, its line in /issues help.
export type BoardTool = ToolSpec & { what: string }

// Each tool's text is sent with every request, so it says only what Claude needs to choose and call the tool. Claude
// Code's own permission prompt covers asking, and the working and orchestrator notes cover the workflow.
export const TOOL_SPECS: BoardTool[] = [
  {
    name: 'issues',
    what: 'lists the board, one issue in full with its comments and fields, searches every issue, and lists by Status or milestones',
    description:
      "Lists this repo's open issues and pull requests from the issue board's copy, one line each. " +
      'With `number`, one in full with its boxes numbered as tick counts them. With `state` closed or all, or `search`, it searches GitHub instead. ' +
      "Read an issue's whole text with `gh issue view`.",
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'integer', description: 'One issue or pull request to show in full.' },
        filter: {
          type: 'string',
          enum: ['active', 'future', 'bugs', 'mine', 'all', 'inbox'],
          description:
            'Default all. With a project, active is P0 and P1, future is P2, and inbox is Status Inbox or none; without one, future is labelled future.',
        },
        area: { type: 'string', description: 'Only issues with this area: label.' },
        query: { type: 'string', description: 'Only issues whose title, number or labels hold every word.' },
        state: { type: 'string', enum: ['open', 'closed', 'all'] },
        search: { type: 'string', description: 'Words in any title or body.' },
        label: { type: 'string' },
        assignee: { type: 'string', description: 'A login.' },
        milestone: { type: 'string', description: 'A milestone title.' },
        milestones: { type: 'boolean', description: 'true lists the open milestones instead, with progress and due dates.' },
        status: { type: 'string', description: "Lists the project's issues at this Status instead, open or closed, such as Done." },
        since: { type: 'string', description: 'With status: closed on or after this date, YYYY-MM-DD.' },
      },
  },
  },
  {
    name: 'tick',
    what: 'ticks or unticks acceptance boxes',
    description:
      "Ticks `- [ ]` boxes in an issue's body once their work is done and checked. Boxes count from 1 in body order, as the issues tool shows them with `number`.",
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'integer' },
        boxes: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1 },
        done: { type: 'boolean', description: 'false unticks.' },
      },
      required: ['number', 'boxes'],
  },
  },
  {
    name: 'issue_update',
    what: 'changes an issue: Status, Priority, title, body, boxes, labels, epic, fields, type, links, closing, and starting work on it',
    description:
      'Changes an issue and the issue board at once. Give only what changes. ' +
      "When you start work on an issue or pull request here without the board's Start, call this with start: true. " +
      `To work one in the background instead, dispatch the ${WORKER} agent with a description that starts with the issue's #number.`,
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'integer', description: 'With start, a pull request starts its issue.' },
        start: { type: 'boolean', description: "true makes it this session's issue, moves it to In progress and assigns it, as Start does." },
        status: { type: 'string', description: 'A project Status option, such as In progress or Done.' },
        priority: { type: 'string', description: 'A project Priority option, such as P1.' },
        addLabels: { type: 'array', items: { type: 'string' }, description: 'Missing ones are created.' },
        removeLabels: { type: 'array', items: { type: 'string' } },
        assign: { type: 'array', items: { type: 'string' }, description: 'Logins; @me for you.' },
        unassign: { type: 'array', items: { type: 'string' }, description: 'Logins; @me for you.' },
        parent: { type: 'integer', minimum: 0, description: 'The epic to put it under; 0 takes it out.' },
        milestone: { type: 'string', description: 'A milestone title; empty takes it off.' },
        comment: { type: 'string', description: 'Markdown.' },
        close: { type: 'string', enum: ['completed', 'not planned'] },
        duplicateOf: { type: 'integer', minimum: 1, description: 'Closes it as a duplicate.' },
        type: { type: ['string', 'null'], description: 'An issue type, such as Bug, where the org has types; null takes it off.' },
        moveBefore: { type: 'integer', description: "Moves this sub-issue before this sibling in its epic's order." },
        moveAfter: { type: 'integer' },
        projectAfter: { type: 'integer', minimum: 0, description: "Moves it after this issue in the project's order; 0 to the top." },
        pin: { type: 'boolean' },
        lock: {
          type: ['boolean', 'string'],
          enum: [true, false, 'off_topic', 'resolved', 'spam', 'too_heated'],
        },
        transferTo: { type: 'string', description: "Moves it to another of the owner's repos, by name." },
        confirmTransfer: { type: 'boolean', description: "Needed to move it from a public repo to a private one, which GitHub can't undo." },
        fields: {
          type: 'object',
          additionalProperties: { type: ['string', 'number', 'null'] },
          description: 'Other project fields by name, such as {"Estimate": 3, "Due": "2026-10-20"}: a number, YYYY-MM-DD, text, an iteration or option name; null clears.',
        },
        reopen: { type: 'boolean' },
        title: { type: 'string' },
        body: { type: 'string', description: 'A whole new Markdown body, refused if it changed on GitHub since the board read it. For boxes use addBoxes or rewordBoxes.' },
        addBoxes: { type: 'array', items: { type: 'string' }, description: 'Acceptance boxes to add after the last one.' },
        rewordBoxes: {
          type: 'array',
          items: { type: 'object', properties: { box: { type: 'integer', minimum: 1 }, text: { type: 'string' } }, required: ['box', 'text'] },
          description: 'Ticked boxes stay ticked.',
        },
        addBlockedBy: { type: 'array', items: { type: 'integer' } },
        removeBlockedBy: { type: 'array', items: { type: 'integer' } },
      },
      required: ['number'],
  },
  },
  {
    name: 'capture',
    what: 'files work found in conversation to the Inbox, or comments on the same work already filed, without asking',
    description:
      "Files work found in conversation to the project's Inbox, for the person to triage, without asking. " +
      'If an open issue, or one closed in the last 30 days, is the same work, it comments there instead.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string', description: 'Markdown: what the work is and why it came up.' },
        labels: { type: 'array', items: { type: 'string' } },
        epic: { type: 'integer', minimum: 1, description: 'The epic to file it under.' },
      },
      required: ['title', 'body'],
  },
  },
  {
    name: 'issue_create',
    what: 'files an issue, or an epic with its sub-issues, into the project with a Status, Priority or fields',
    description:
      "Files an issue and puts it on the issue board. Without a status it goes to the project's Inbox. " +
      'Write the body in Markdown with an Acceptance list of `- [ ]` boxes. If a step after filing fails, the answer says which, with the new number.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Missing ones are created.' },
        assign: { type: 'array', items: { type: 'string' }, description: 'Logins; @me for you.' },
        milestone: { type: 'string', description: 'An open milestone title.' },
        parent: { type: 'integer', minimum: 1, description: 'The epic to file it under.' },
        blockedBy: { type: 'array', items: { type: 'integer' } },
        type: { type: 'string', description: 'An issue type, such as Bug, where the org has types.' },
        status: { type: 'string', description: 'A project Status option, such as Backlog.' },
        priority: { type: 'string', description: 'A project Priority option, such as P1.' },
        subIssues: {
          type: 'array',
          description: 'For an epic: sub-issues to file under it, in order.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              body: { type: 'string' },
              labels: { type: 'array', items: { type: 'string' } },
              assign: { type: 'array', items: { type: 'string' } },
              milestone: { type: 'string' },
              status: { type: 'string' },
              priority: { type: 'string' },
              blockedBy: { type: 'array', items: { type: 'integer' } },
            },
            required: ['title'],
          },
        },
      },
      required: ['title'],
  },
  },
  {
    name: 'milestone',
    what: 'makes or changes a milestone',
    description: "Makes a milestone by title if the repo hasn't got it, or else changes it. The issues tool lists them with `milestones`.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        newTitle: { type: 'string' },
        due: { type: 'string', description: 'YYYY-MM-DD; empty clears it.' },
        description: { type: 'string' },
        close: { type: 'boolean' },
        reopen: { type: 'boolean' },
      },
      required: ['title'],
  },
  },
  {
    name: 'project_status',
    what: "reads or posts the project's status update",
    description: "Reads the latest status update of the repo's GitHub Project, or with status posts one.",
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['On track', 'At risk', 'Off track', 'Complete', 'Inactive'] },
        note: { type: 'string', description: 'Markdown.' },
        start: { type: 'string', description: 'YYYY-MM-DD.' },
        target: { type: 'string', description: 'YYYY-MM-DD.' },
      },
  },
  },
  {
    name: 'project_archive',
    what: "archives the project's Done items closed before a date, or one issue's item",
    description:
      "Archives items in the repo's GitHub Project, leaving the issues as they are: one issue's item, or every Done item closed before a date. " +
      'The first call lists them and changes nothing; call again with confirm: true to archive.',
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'integer' },
        doneBefore: { type: 'string', description: 'YYYY-MM-DD.' },
        confirm: { type: 'boolean' },
      },
  },
  },
  {
    name: 'project_plan',
    what: 'proposes many issue, label and view changes as one plan, which you approve once or apply in part from its card in the pane',
    description:
      'Proposes many issue, label and view changes as one plan, each with a reason, refused whole if any is invalid. ' +
      'The person approves it once, or applies some of it in /issues. A new plan replaces the last.',
    inputSchema: {
      type: 'object',
      properties: {
        issues: {
          type: 'array',
          description: 'Fields as in issue_update.',
          items: {
            type: 'object',
            properties: {
              number: { type: 'integer' },
              reason: { type: 'string' },
              status: { type: 'string' },
              priority: { type: 'string' },
              fields: { type: 'object', additionalProperties: { type: ['string', 'number', 'null'] } },
              addLabels: { type: 'array', items: { type: 'string' } },
              removeLabels: { type: 'array', items: { type: 'string' } },
              assign: { type: 'array', items: { type: 'string' } },
              unassign: { type: 'array', items: { type: 'string' } },
              milestone: { type: 'string' },
              parent: { type: 'integer', minimum: 0 },
              projectAfter: { type: 'integer', minimum: 0 },
            },
            required: ['number', 'reason'],
          },
        },
        labels: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              reason: { type: 'string' },
              create: { type: 'boolean' },
              delete: { type: 'boolean' },
              rename: { type: 'string' },
              color: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['name', 'reason'],
          },
        },
        views: {
          type: 'array',
          description: 'view: a number or name; omit to create.',
          items: {
            type: 'object',
            properties: {
              view: { type: ['integer', 'string'] },
              reason: { type: 'string' },
              name: { type: 'string' },
              layout: { enum: ['table', 'board', 'roadmap'] },
              filter: { type: 'string' },
              delete: { type: 'boolean' },
            },
            required: ['reason'],
          },
        },
      },
  },
  },
  {
    name: 'project_adopt',
    what: 'lets the board write to a project, or releases it, when you ask, after a permission prompt',
    description:
      'Lets the issue board write to a GitHub Project of this repo, which it otherwise only reads; release: true stops it. ' +
      'Call it only when the person asks you to let the board write to a project, or to release one; never on your own, and never to get past a refusal.',
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'integer', minimum: 1, description: 'A project linked to the repo; by default the one the board reads.' },
        release: { type: 'boolean' },
      },
  },
  },
]

// The board's tools for Claude, each in a line: /issues help lists them.
export const TOOLS: { name: string; what: string }[] = TOOL_SPECS.map(({ name, what }) => ({ name, what }))
