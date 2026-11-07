export const meta = {
  name: 'fix-failing-tests',
  description: 'Fix failing tests one at a time until the suite is green, escalating undecided questions',
  phases: [
    { title: 'Fix', detail: 'one fix agent per failing test' },
    { title: 'Decide', detail: 'resolve questions the fixers raised' }
  ]
}

const MAX_ROUNDS = 4
const open = Array.isArray(args) ? [...args] : []
const fixed = []
const questions = []

let round = 0
while (open.length > 0 && round < MAX_ROUNDS) {
  round++
  log(`round ${round}: ${open.length} failing tests`)
  const batch = open.splice(0, open.length)
  const outcomes = await parallel(
    batch.map((test) => () =>
      agent(`The test "${test}" fails and the cause is known: ${args.causes?.[test] ?? 'see the failure output'}. Fix the code under test, then rerun the test.`, {
        label: `fix: ${test}`,
        phase: 'Fix',
        model: 'sonnet',
        effort: 'medium',
        schema: {
          type: 'object',
          properties: {
            passed: { type: 'boolean' },
            notes: { type: 'string' },
            blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
          },
          required: ['passed', 'notes', 'blocked_on']
        }
      })
    )
  )
  outcomes.forEach((out, i) => {
    if (!out) open.push(batch[i])
    else if (out.blocked_on) questions.push({ test: batch[i], question: out.blocked_on })
    else if (out.passed) fixed.push(batch[i])
    else open.push(batch[i])
  })
}

const answers = []
for (const { test, question } of questions) {
  try {
    const answer = await agent(`Decide: ${question}\n\nContext: the test "${test}" is failing.`, {
      label: `decide: ${test}`,
      phase: 'Decide',
      model: 'opus',
      effort: 'medium'
    })
    answers.push({ test, answer })
  } catch (err) {
    log(`decision for ${test} failed: ${err.message}`)
  }
}

return { fixed, stillFailing: open, answers }
