export const meta = {
  name: 'review-panel',
  description: 'Review the working-tree diff through independent lenses, then merge the findings',
  phases: [
    { title: 'Review', detail: 'one reviewer per lens' },
    { title: 'Merge', detail: 'synthesize the reviews' }
  ]
}

const LENSES = ['correctness', 'security', 'performance']

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { file: { type: 'string' }, line: { type: 'number' }, problem: { type: 'string' } },
        required: ['file', 'problem']
      }
    }
  },
  required: ['findings']
}

phase('Review')
const reviews = await parallel(
  LENSES.map((lens) => () =>
    agent(`Review the current git diff through the ${lens} lens only. Report concrete problems with file and line.`, {
      label: `judge: ${lens} review`,
      phase: 'Review',
      model: 'opus',
      effort: 'xhigh',
      schema: FINDINGS
    })
  )
)

const usable = reviews.filter(Boolean)
if (usable.length === 0) throw new Error('every reviewer failed')

phase('Merge')
const merged = await agent(`Merge these reviews into one ranked list, dropping duplicates and findings that contradict each other:\n\n${JSON.stringify(usable)}`, {
  label: 'synth: merge reviews',
  phase: 'Merge',
  model: 'opus',
  effort: 'high'
})

return merged
