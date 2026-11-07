export const meta = {
  name: 'feature-slice',
  description: 'Design a small UI feature, build it, and verify the result',
  whenToUse: 'A decided feature needs a design pass, an implementation and a verdict',
  phases: [
    { title: 'Design', detail: 'one opus designer' },
    { title: 'Build', detail: 'sonnet builders in parallel' },
    { title: 'Verdict', detail: 'opus judge' }
  ]
}

phase('Design')
const design = await agent('Design the empty-state screen for the project list: layout, copy and states. Return the spec.', {
  'label': 'design: project list empty state',
  'phase': 'Design',
  'model': 'opus',
  'effort': 'high'
})

phase('Build')
const parts = ['component', 'styles', 'story']
const built = await Promise.all(
  parts.map(async (part) => {
    const res = await agent(`Implement the ${part} for this spec:\n\n${design}`, {
      label: `build: ${part}`,
      phase: 'Build',
      model: 'sonnet',
      effort: 'xhigh',
      schema: {
        type: 'object',
        properties: { files: { type: 'array', items: { type: 'string' } }, blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' } },
        required: ['files', 'blocked_on']
      }
    })
    return { part, files: res ? res.files : [] }
  })
)

const extracted = await agent('Extract the list of changed file paths from this build output as a JSON array of strings.', {
  label: 'code: normalize file list',
  model: 'sonnet',
  effort: 'high',
  schema: {
    type: 'object',
    properties: {
      paths: { type: 'array', items: { type: 'string' } },
      blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
    },
    required: ['paths', 'blocked_on']
  }
})

phase('Verdict')
return agent(`Judge whether the built feature matches the design spec.\n\nSpec:\n${design}\n\nBuilt: ${JSON.stringify(built)}\nFiles: ${extracted ? extracted.paths.join(', ') : 'unknown'}`, {
  label: 'judge: feature matches spec',
  phase: 'Verdict',
  model: 'opus',
  effort: 'xhigh'
})
