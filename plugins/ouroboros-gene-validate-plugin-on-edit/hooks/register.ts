import type { EngineInterface, Register } from 'claude-code'

// After an Edit or Write lands on a plugin's code or manifest, run
// `claude plugin validate` on that plugin and hand any failure to the model.

const WATCHED = /\.(ts|tsx|js|mjs|json)$/
const MAX_LEVELS = 6
const TAIL_LINES = 40

// Collapses `.`, `..` and repeated slashes in an absolute POSIX path.
function normalize(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return '/' + parts.join('/')
}

function parent(dir: string): string {
  const cut = dir.lastIndexOf('/')
  return cut <= 0 ? '/' : dir.slice(0, cut)
}

// The nearest folder above `file` holding both plugin manifests, if any.
async function findPlugin($: EngineInterface, file: string): Promise<string | undefined> {
  let dir = parent(file)
  for (let level = 0; level < MAX_LEVELS; level++) {
    const hasManifest = await $.fs.exists(`${dir}/.claude-plugin/plugin.json`)
    if (hasManifest && (await $.fs.exists(`${dir}/hooks/hooks.json`))) return dir
    if (dir === '/') return undefined
    dir = parent(dir)
  }
  return undefined
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== 'Edit' && e.tool !== 'Write') return ran
    if (e.agentId !== undefined || ran.deny !== undefined || ran.isError) return ran
    if (!WATCHED.test(e.file_path)) return ran

    try {
      const absolute = e.file_path.startsWith('/') ? e.file_path : `${await $.session.cwd()}/${e.file_path}`
      const dir = await findPlugin($, normalize(absolute))
      if (dir === undefined) return ran

      const check = await $.process.run(['claude', 'plugin', 'validate', dir], { timeoutMs: 60000 })
      if (check.exitCode === 0) return ran

      const output = [check.stdout, check.stderr].filter(text => text.trim() !== '').join('\n')
      const tail = output.trimEnd().split('\n').slice(-TAIL_LINES).join('\n')
      const note = `claude plugin validate failed for ${dir} (exit ${check.exitCode}):\n${tail}`
      return { ...ran, context: [...(ran.context ?? []), note] }
    } catch {
      return ran
    }
  })
}
