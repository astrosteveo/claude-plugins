import type { On } from 'claude-code'

import type { SetupOption } from '../types'

// GitHub as /issues setup sees it, shared by the setup tests and the budget test.

export const option = (name: string, id?: string): SetupOption => ({ ...(id ? { id } : {}), name, color: 'GRAY', description: '' })
export const BOARD_STATUSES = ['Inbox', 'Backlog', 'Ready', 'In progress', 'Verification', 'Done']

export const complete = {
  id: 'PVT_8',
  number: 8,
  title: 'Void Sector',
  url: 'https://github.com/users/astrosteveo/projects/8',
  status: { id: 'F_status', options: BOARD_STATUSES.map((name, index) => option(name, `s${index}`)) },
  priority: { id: 'F_priority', options: ['P0', 'P1', 'P2'].map((name, index) => option(name, `p${index}`)) },
  workflows: [
    { name: 'Item closed', enabled: true },
    { name: 'Auto-add to project', enabled: false },
    { name: 'Auto-add sub-issues to project', enabled: true },
  ],
}

// GitHub as setup sees it: the repo, its projects and issues, and every change asked for, in order. `calls` keeps every
// gh command, for the budget test.
export const github = (on: On, start: { hasIssues: boolean; projects: (typeof complete)[]; labels: string[]; issues: { number: number; items: { project: string; item: string; status: string | null }[] }[] }) => {
  const state = { ...start, writes: [] as string[], created: null as null | typeof complete, calls: [] as string[] }
  const projectNode = (project: typeof complete) => ({
    id: project.id,
    number: project.number,
    title: project.title,
    url: project.url,
    closed: false,
    fields: { nodes: [project.status, project.priority].filter(Boolean).map(field => ({ id: field?.id, name: field?.id === 'F_status' ? 'Status' : 'Priority', options: field?.options })) },
    workflows: { nodes: project.workflows },
  })
  on('process.run', async (_$, e) => {
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const argv = e.argv
    if (argv[0] === 'gh') state.calls.push(argv.slice(1).join(' '))
    if (argv[0] === 'git') return answer('main\n')
    if (argv[1] === 'repo' && argv[2] === 'view') return answer(JSON.stringify({ nameWithOwner: 'astrosteveo/void-sector', hasIssuesEnabled: state.hasIssues }))
    if (argv[1] === 'repo' && argv[2] === 'edit') {
      state.writes.push(`repo edit ${argv.slice(3).join(' ')}`)
      state.hasIssues = true
      return answer('')
    }
    if (argv[1] === 'label' && argv[2] === 'create') {
      state.writes.push(`label ${argv[3]}`)
      return answer('')
    }
    if (argv[1] === 'api' && argv[2] === 'graphql' && argv.includes('--input')) {
      const { query, variables } = JSON.parse(e.init?.stdin ?? '{}') as { query: string; variables: Record<string, any> }
      const data = (value: unknown) => answer(JSON.stringify({ data: value }))
      if (query.includes('labels(first: 100)')) {
        return data({
          repository: {
            id: 'R_1',
            nameWithOwner: 'astrosteveo/void-sector',
            hasIssuesEnabled: state.hasIssues,
            viewerPermission: 'ADMIN',
            owner: { id: 'U_1' },
            labels: { nodes: state.labels.map(name => ({ name })) },
            projectsV2: { nodes: state.projects.map(projectNode) },
          },
        })
      }
      if (query.includes('projectItems')) {
        return data({
          repository: {
            issues: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: state.issues.map(issue => ({
                id: `I_${issue.number}`,
                number: issue.number,
                projectItems: { nodes: issue.items.map(item => ({ id: item.item, project: { id: item.project }, status: item.status ? { name: item.status } : null })) },
              })),
            },
          },
        })
      }
      const project = state.created ?? state.projects[0]
      if (query.includes('createProjectV2(')) {
        state.writes.push(`create project ${variables.title} for ${variables.repo} by ${variables.owner}`)
        state.created = { ...complete, id: 'PVT_new', number: 9, title: variables.title, priority: null as never, status: { id: 'F_status', options: [option('Todo', 'd0'), option('In Progress', 'd1'), option('Done', 'd2')] } as never }
        return data({ createProjectV2: { projectV2: { id: 'PVT_new', number: 9, title: variables.title, url: '' } } })
      }
      if (query.includes('node(id: $id)')) return data({ node: projectNode(project!) })
      if (query.includes('updateProjectV2Field(')) {
        const options = variables.options as SetupOption[]
        state.writes.push(`status ${options.map(one => `${one.name}${one.id ? `=${one.id}` : ''}`).join(',')}`)
        project!.status = { id: 'F_status', options: options.map((one, index) => ({ ...one, id: one.id ?? `n${index}` })) }
        return data({ updateProjectV2Field: { projectV2Field: { id: 'F_status' } } })
      }
      if (query.includes('createProjectV2Field(')) {
        state.writes.push(`field ${variables.name} ${(variables.options as SetupOption[]).map(one => one.name).join(',')}`)
        project!.priority = { id: 'F_priority', options: (variables.options as SetupOption[]).map((one, index) => ({ ...one, id: `p${index}` })) }
        return data({ createProjectV2Field: { projectV2Field: { id: 'F_priority' } } })
      }
      if (query.includes('addProjectV2ItemById')) {
        state.writes.push(`add ${variables.content}`)
        return data({ addProjectV2ItemById: { item: { id: `PVTI_${variables.content}` } } })
      }
      if (query.includes('updateProjectV2ItemFieldValue')) {
        state.writes.push(`set ${variables.item} ${project!.status.options.find(one => one.id === variables.option)?.name}`)
        return data({ updateProjectV2ItemFieldValue: { projectV2Item: { id: variables.item } } })
      }
    }
    // The board's own refresh, which follows Apply.
    if (argv[1] === 'api' && argv[2] === 'graphql') return answer(JSON.stringify({ data: { repository: { issues: { pageInfo: { hasNextPage: false }, nodes: [] } } } }))
    return answer(argv[1] === 'api' ? 'astrosteveo\n' : '[]')
  })
  on('session.repo', async () => ({ value: { root: '/work/void-sector', remote: 'git@github.com:astrosteveo/void-sector.git', internal: false, name: null } }))
  on('session.root', async () => ({ value: '/work/void-sector' }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  // The folder: a client and a server, and no issue template.
  on('fs.list', async (_$, e) => ({ value: e.path === '/work/void-sector' ? [{ name: 'client', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }, { name: 'server', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }] : [] }))
  return state
}
