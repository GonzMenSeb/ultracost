export const meta = {
  name: 'design-open-questions',
  description: 'Rank the open design questions, put the three hardest on opus and the rest on sonnet',
  phases: [
    { title: 'Rank', detail: 'one sonnet investigator' },
    { title: 'Design', detail: 'three opus designers, the rest on sonnet' }
  ]
}

phase('Rank')
const ranking = await agent('List the open design questions in docs/design, the most complex first. Return one short key and one sentence per question.', {
  label: 'investigate: rank open design questions',
  phase: 'Rank',
  model: 'sonnet',
  effort: 'medium',
  schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: { type: 'object', properties: { key: { type: 'string' }, summary: { type: 'string' } }, required: ['key', 'summary'] }
      },
      blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
    },
    required: ['questions', 'blocked_on']
  }
})

const ranked = ranking ? ranking.questions : []

phase('Design')
const designs = await parallel([
  ...ranked.slice(0, 3).map((q) => () =>
    agent(`Design the answer to: ${q.summary}`, {
      label: `design: ${q.key}`,
      phase: 'Design',
      model: 'opus',
      effort: 'high'
    })
  ),
  ...ranked.slice(3).map((q) => () =>
    agent(`Design the answer to: ${q.summary}`, {
      label: `design: ${q.key}`,
      phase: 'Design',
      model: 'sonnet',
      effort: 'high',
      schema: {
        type: 'object',
        properties: {
          design: { type: 'string' },
          blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
        },
        required: ['design', 'blocked_on']
      }
    })
  )
])

return designs.filter(Boolean)
