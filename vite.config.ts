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

// relative base so the build works on GitHub Pages under /<repo>/
export default defineConfig({ plugins: [react(), precacheList()], base: './' })
