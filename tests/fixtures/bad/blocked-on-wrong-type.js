const result = await agent('Implement the parser module as specified.', {
  label: 'build: parser module',
  model: 'sonnet',
  effort: 'high',
  schema: {
    type: 'object',
    properties: {
      files: { type: 'array', items: { type: 'string' } },
      blocked_on: { type: 'string', description: 'An open decision this stage must not make, or null' }
    },
    required: ['files', 'blocked_on']
  }
})
return result
