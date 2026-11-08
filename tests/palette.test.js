import { test } from 'node:test'
import assert from 'node:assert/strict'
import { familyColor, modelColor, savedColor } from '../src/palette.mjs'

const MODELS = ['haiku', 'sonnet', 'opus']
const EFFORTS = ['low', 'medium', 'high', 'xhigh']

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
const linear = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const luminance = (hex) => {
  const [r, g, b] = channels(hex).map(linear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (hex) => (luminance(hex) + 0.05) / (luminance('#262626') + 0.05)

test('every model and effort has its own color and reads on a dark terminal', () => {
  const seen = new Set()
  for (const model of MODELS) {
    for (const effort of EFFORTS) {
      const hex = modelColor(model, effort)
      assert.match(hex, /^#[0-9a-f]{6}$/)
      assert.ok(contrast(hex) >= 3, `${model} ${effort} ${hex}`)
      seen.add(hex)
    }
  }
  assert.equal(seen.size, 12)
})

test('effort deepens a model: lower luminance from low to xhigh', () => {
  for (const model of MODELS) {
    const lum = EFFORTS.map((effort) => luminance(modelColor(model, effort)))
    assert.deepEqual([...lum].sort((a, b) => b - a), lum, model)
  }
})

test('models run gold, orange, crimson', () => {
  assert.equal(modelColor('haiku', 'xhigh'), '#efb219')
  assert.equal(modelColor('sonnet', 'high'), '#f48815')
  assert.equal(modelColor('opus', 'xhigh'), '#d63150')
})

test('fable takes the opus colors; unknown models have none', () => {
  assert.equal(modelColor('fable', 'high'), modelColor('opus', 'high'))
  assert.equal(familyColor('fable'), familyColor('opus'))
  assert.equal(modelColor('mystery', 'high'), undefined)
  assert.equal(familyColor('plain'), undefined)
})

test('a missing or unknown effort reads as high, max as xhigh', () => {
  assert.equal(modelColor('sonnet', null), modelColor('sonnet', 'high'))
  assert.equal(modelColor('sonnet', undefined), modelColor('sonnet', 'high'))
  assert.equal(modelColor('opus', 'max'), modelColor('opus', 'xhigh'))
})

test('a family is drawn in the shade of its usual effort', () => {
  assert.equal(familyColor('haiku'), modelColor('haiku', 'xhigh'))
  assert.equal(familyColor('sonnet'), modelColor('sonnet', 'high'))
  assert.equal(familyColor('opus'), modelColor('opus', 'high'))
})

test('saved runs from light blue at 1% to violet at 20%, flat outside', () => {
  assert.equal(savedColor(1), '#79e4f0')
  assert.equal(savedColor(10), '#65a7fa')
  assert.equal(savedColor(20), '#8565e1')
  assert.equal(savedColor(0), savedColor(1))
  assert.equal(savedColor(-3), savedColor(1))
  assert.equal(savedColor(35), savedColor(20))
  assert.equal(savedColor(NaN), savedColor(1))
})

test('saved colors deepen with the percentage and read on a dark terminal', () => {
  const steps = [1, 3, 5, 8, 10, 12, 15, 18, 20]
  const lum = steps.map((p) => luminance(savedColor(p)))
  assert.deepEqual([...lum].sort((a, b) => b - a), lum)
  for (const p of steps) assert.ok(contrast(savedColor(p)) >= 3, `${p}%`)
})
