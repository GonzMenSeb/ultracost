export const meta = {
  name: 'review-panel-four-opus',
  description: 'Review the working-tree diff through four lenses at once on opus',
  phases: [{ title: 'Review', detail: 'one reviewer per lens' }]
}

const LENSES = ['correctness', 'security', 'performance', 'maintainability']

phase('Review')
const reviews = await parallel(
  LENSES.map((lens) => () =>
    agent(`Review the current git diff through the ${lens} lens only. Report concrete problems with file and line.`, {
      label: `judge: ${lens} review`,
      phase: 'Review',
      model: 'opus',
      effort: 'xhigh'
    })
  )
)

return reviews.filter(Boolean)
