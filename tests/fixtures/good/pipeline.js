export const meta = {
  name: 'migrate-config-loaders',
  description: 'Find config loaders that read process.env directly, migrate each, then review the result',
  phases: [
    { title: 'Discover', detail: 'list the loaders to migrate' },
    { title: 'Migrate', detail: 'one build agent per loader' },
    { title: 'Verify', detail: 'adversarial review of each migrated loader' }
  ]
}

phase('Discover')
const plan = await agent('List every config loader under src/config that still reads process.env directly. Return the file paths only.', {
  label: 'grunt: list env-reading loaders',
  phase: 'Discover',
  model: 'sonnet',
  effort: 'medium',
  schema: {
    type: 'object',
    properties: {
      files: { type: 'array', items: { type: 'string' } },
      blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
    },
    required: ['files', 'blocked_on']
  }
})

if (!plan || plan.files.length === 0) {
  log('No loaders read process.env directly')
  return []
}

const results = await pipeline(
  plan.files,
  (file) =>
    agent(`Migrate ${file} to read configuration through the shared Config class. Keep the public exports unchanged and run the loader tests.`, {
      label: `build: migrate ${file}`,
      phase: 'Migrate',
      model: 'sonnet',
      effort: 'high',
      schema: {
        type: 'object',
        properties: {
          changed: { type: 'boolean' },
          summary: { type: 'string' },
          blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
        },
        required: ['changed', 'summary', 'blocked_on']
      }
    }),
  (built, file) =>
    agent(`Review the migration of ${file}. Try to break it: missing defaults, changed exports, tests that no longer cover the loader.\n\nReported change: ${built ? built.summary : 'none'}`, {
      label: `judge: review ${file}`,
      phase: 'Verify',
      model: 'opus',
      effort: 'high',
      schema: {
        type: 'object',
        properties: {
          verdict: { type: 'string', enum: ['pass', 'fail'] },
          problems: { type: 'array', items: { type: 'string' } }
        },
        required: ['verdict', 'problems']
      }
    })
)

return results.filter(Boolean)
