const common = { phase: 'Decide' }
const result = await agent('Pick the approach for the cache layer.', {
  ...common,
  label: 'decide: pick the cache approach',
  model: 'opus',
  effort: 'high'
})
return result
