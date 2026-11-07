const result = await agent('Implement the parser module as specified.', {
  label: 'build: parser module',
  model: 'sonnet',
  effort: 'high',
  schema: {
    type: 'object',
    properties: {
      files: { type: 'array', items: { type: 'string' } },
      blocked_on: { type: ['string', 'null'], description: '' }
    },
    required: ['files', 'blocked_on']
  }
})
return result
