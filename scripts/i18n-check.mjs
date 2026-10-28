// Checks the English UI text: every t('…') key in src has an English entry, and lists Hebrew left outside t().
//   node scripts/i18n-check.mjs            summary
//   node scripts/i18n-check.mjs --list     every missing key and every unwrapped Hebrew line
// A line that is Hebrew on purpose (data the code matches, the Hebrew side of a phrase) carries `// he-only`.
import { build } from 'esbuild'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const out = await build({ entryPoints: ['src/i18n/en.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })
const { EN } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

const files = []
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(f) && !p.startsWith(join('src', 'i18n'))) files.push(p)
  }
}
walk('src')

const HEB = /[֐-׿]/
const CALL = /\bt\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g
const list = process.argv.includes('--list')
const missing = new Map()
const loose = []
let keys = 0
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(CALL)) {
    const key = m[2].replace(/\\(['"`\\])/g, '$1')
    if (!HEB.test(key)) continue
    keys++
    if (!(key in EN)) missing.set(key, f)
  }
  text.split('\n').forEach((line, i) => {
    if (!HEB.test(line) || /he-only/.test(line)) return
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    // Hebrew outside any t('…') on this line
    const rest = line.replace(CALL, '')
    if (HEB.test(rest)) loose.push(`${f}:${i + 1}: ${trimmed.slice(0, 120)}`)
  })
}
console.log(`t() keys: ${keys}, without English: ${missing.size}, Hebrew lines outside t(): ${loose.length}`)
if (list) {
  for (const [k, f] of missing) console.log(`missing  ${f}  ${k}`)
  for (const l of loose) console.log(`loose    ${l}`)
}
process.exit(missing.size || loose.length ? 1 : 0)
