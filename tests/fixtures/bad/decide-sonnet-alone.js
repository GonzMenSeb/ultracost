export const meta = {
  name: 'decide-on-sonnet',
  description: 'A single decide stage on sonnet outside any fan-out',
  phases: [{ title: 'Decide', detail: 'one decision' }]
}

phase('Decide')
return agent('Choose between a queue and a cron job for the nightly export. Return the choice and the reason.', {
  label: 'decide: queue or cron',
  phase: 'Decide',
  model: 'sonnet',
  effort: 'high',
  schema: {
    type: 'object',
    properties: {
      choice: { type: 'string' },
      blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
    },
    required: ['choice', 'blocked_on']
  }
})
