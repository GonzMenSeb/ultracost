export const meta = {
  name: 'tabulate-and-check',
  description: 'Tabulate the open issues per label on haiku medium, check the links on haiku high, then build the report on sonnet',
  phases: [
    { title: 'Collect', detail: 'two fixed-shape stages on haiku' },
    { title: 'Report', detail: 'one build agent' }
  ]
}

phase('Collect')
const [counts, links] = await parallel([
  () =>
    agent('Read issues.jsonl and count the issues per label. Compute the counts in code with no interpretation. Return one row per label.', {
      label: 'grunt: issues per label',
      phase: 'Collect',
      model: 'haiku',
      effort: 'medium',
      schema: {
        type: 'object',
        properties: {
          rows: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, count: { type: 'number' } }, required: ['label', 'count'] } },
          blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
        },
        required: ['rows', 'blocked_on']
      }
    }),
  () =>
    agent('Run `node scripts/check-links.mjs docs/` and return its exit code and raw output.', {
      label: 'code: check links',
      phase: 'Collect',
      model: 'haiku',
      effort: 'high',
      schema: {
        type: 'object',
        properties: {
          exitCode: { type: 'number' },
          output: { type: 'string' },
          blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
        },
        required: ['exitCode', 'output', 'blocked_on']
      }
    })
])

phase('Report')
return agent(`Write REPORT.md from these tables.\n\n${JSON.stringify({ counts, links })}`, {
  label: 'build: report',
  phase: 'Report',
  model: 'sonnet',
  effort: 'high',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
    },
    required: ['path', 'blocked_on']
  }
})
