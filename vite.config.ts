import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The service worker precaches the build's files, so it needs their (hashed) names: fill them into the copy of
// public/sw.js in dist. The list's hash is the cache version, so every deploy swaps the cache.
function precacheList(): Plugin {
  return {
    name: 'precache-list',
    apply: 'build',
    writeBundle(opts, bundle) {
      const dist = opts.dir ?? 'dist'
      // the destination photos keep their names too, so they are listed by hand and their bytes join the version
      const cities = readdirSync(join(dist, 'cities')).map((f) => 'cities/' + f)
      const files = [
        './',
        'media.json',
        'manifest.webmanifest',
        'icon.svg',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
        'apple-touch-icon.png',
        ...cities,
        ...Object.keys(bundle),
      ]
      // media.json keeps its name between deploys, so its content goes into the version too
      const version = createHash('sha1')
        .update(files.join() + readFileSync(join(dist, 'media.json')))
        .update(Buffer.concat(cities.map((f) => readFileSync(join(dist, f)))))
        .digest('hex')
        .slice(0, 10)
      const file = join(dist, 'sw.js')
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replace('/*PRECACHE*/[]', JSON.stringify(files)).replace('/*VERSION*/dev', version),
      )
    },
  }
}

/**
 * Light or dark follows the phone unless the person picked one in settings (html[data-theme="light" | "dark"]).
 * Every `@media (prefers-color-scheme: dark)` block is written once in the CSS and comes out twice: inside the media
 * query unless "light" was picked, and outside it when "dark" was picked. :where() adds no selector weight, so each
 * rule keeps exactly the priority it had.
 */
function themeOverride() {
  type Rule = { selectors: string[] }
  type Node = { params: string; clone(): Node; after(n: Node[]): void; nodes: Node[]; walkRules(f: (r: Rule) => void): void }
  const scope = (sel: string, cond: string) =>
    sel.startsWith(':root') ? `:root:where(${cond})${sel.slice(5)}` : `:where(:root${cond}) ${sel}`
  return {
    postcssPlugin: 'theme-override',
    Once(root: { walkAtRules(name: string, f: (at: Node) => void): void }) {
      root.walkAtRules('media', (at) => {
        if (at.params.replace(/\s+/g, '') !== '(prefers-color-scheme:dark)') return
        const forced = at.clone()
        forced.walkRules((r) => (r.selectors = r.selectors.map((s) => scope(s, '[data-theme="dark"]'))))
        at.walkRules((r) => (r.selectors = r.selectors.map((s) => scope(s, ':not([data-theme="light"])'))))
        at.after(forced.nodes)
      })
    },
  }
}

// which build a problem report came from: the commit on GitHub Actions, and when it was built
const build = `${(process.env.GITHUB_SHA ?? 'local').slice(0, 7)} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`

export default defineConfig({
  plugins: [react(), precacheList()],
  css: { postcss: { plugins: [themeOverride()] } },
  // relative base so the build works on GitHub Pages under /<repo>/
  base: './',
  define: { 'import.meta.env.VITE_BUILD': JSON.stringify(build) },
})
