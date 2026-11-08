import { readFileSync, writeFileSync } from 'node:fs'
import { buildRatios } from '../src/calibrate.mjs'
import { loadPrices } from '../src/prices.mjs'

const dir = new URL('../data/', import.meta.url)
const read = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8'))
const target = new URL('ratios.json', dir)

const text = JSON.stringify(
  buildRatios({ replays: read('replays'), published: read('published'), prices: loadPrices(read('prices')) }),
  null,
  2,
) + '\n'

if (process.argv.includes('--check')) {
  let disk = ''
  try {
    disk = readFileSync(target, 'utf8')
  } catch {}
  if (disk !== text) {
    console.error('data/ratios.json is stale: run node scripts/calibrate.mjs')
    process.exit(1)
  }
} else {
  writeFileSync(target, text)
}
