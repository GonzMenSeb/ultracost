const r = await agent('Implement the parser module as specified.', {
  label: 'build: parser module',
  model: 'sonnet',
  effort: 'high',
  schema: {
    type: 'object',
    properties: {
      result: { type: 'string' },
      blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
    },
    required: ['result', 'blocked_on']
  }
})
return await agent('Review the parser module for correctness.', { label: 'judge: parser review', model: 'opus', effort: 'high' })
