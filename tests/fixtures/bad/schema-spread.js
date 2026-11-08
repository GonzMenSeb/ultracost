const base = { required: ['files', 'blocked_on'] }
const result = await agent('Implement the parser module as specified.', {
  label: 'build: parser module',
  model: 'sonnet',
  effort: 'high',
  schema: {
    type: 'object',
    ...base,
    properties: {
      files: { type: 'array', items: { type: 'string' } },
      blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
    }
  }
})
return result
