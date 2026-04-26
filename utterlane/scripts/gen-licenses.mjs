/**
 * 扫 node_modules 抽取所有运行时依赖（dependencies，含传递）的许可证信息，
 * 输出到 src/renderer/src/generated/licenses.json。About 对话框直接读这份文件。
 *
 * 设计取舍：
 *   - 只看 dependencies，不看 devDependencies——devDeps 只在构建时用，
 *     最终包里没有它们的代码，不需要展示给用户。
 *   - 沿着 dependencies 树递归收集传递依赖；node_modules 扁平化布局让我们
 *     可以直接 readFile(node_modules/<name>/package.json)。
 *   - license 字段格式不统一（字符串 / { type } 对象 / 数组），统一规整成
 *     字符串。读不到的标 'UNKNOWN' 不阻塞构建。
 *   - 不抽取 LICENSE 文件正文——典型的 MIT 全文重复展示噪音大；对话框只
 *     列出名称 / 版本 / 许可证类型 / homepage，详细法律文本走外链。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outFile = join(root, 'src/renderer/src/generated/licenses.json')

async function readPkgJson(pkgDir) {
  try {
    return JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

function normalizeLicense(field) {
  if (!field) return 'UNKNOWN'
  if (typeof field === 'string') return field
  if (Array.isArray(field)) return field.map((x) => normalizeLicense(x)).join(', ')
  if (typeof field === 'object' && field.type) return field.type
  return 'UNKNOWN'
}

function normalizeHomepage(pkg) {
  if (typeof pkg.homepage === 'string' && pkg.homepage) return pkg.homepage
  if (typeof pkg.repository === 'string') return pkg.repository
  if (pkg.repository && typeof pkg.repository.url === 'string') {
    // git+https://github.com/foo/bar.git → https://github.com/foo/bar
    return pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')
  }
  return null
}

async function main() {
  const rootPkg = await readPkgJson(root)
  if (!rootPkg) throw new Error('root package.json 读取失败')

  // BFS 抽取传递依赖。已访问的 name 用 Set 去重——同一个包不会重复进结果
  const queue = Object.keys(rootPkg.dependencies ?? {})
  const visited = new Set()
  const collected = []

  while (queue.length > 0) {
    const name = queue.shift()
    if (visited.has(name)) continue
    visited.add(name)
    const dir = join(root, 'node_modules', name)
    const pkg = await readPkgJson(dir)
    if (!pkg) {
      collected.push({ name, version: '?', license: 'UNKNOWN', homepage: null })
      continue
    }
    collected.push({
      name,
      version: pkg.version ?? '?',
      license: normalizeLicense(pkg.license),
      homepage: normalizeHomepage(pkg)
    })
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (!visited.has(dep)) queue.push(dep)
    }
  }

  collected.sort((a, b) => a.name.localeCompare(b.name))
  await mkdir(dirname(outFile), { recursive: true })
  await writeFile(outFile, JSON.stringify(collected, null, 2) + '\n', 'utf8')
  console.log(`[gen:licenses] wrote ${collected.length} entries to ${outFile}`)
}

main().catch((err) => {
  console.error('[gen:licenses] failed:', err)
  process.exit(1)
})
