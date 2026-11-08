const tier = args.cheap ? 'sonnet' : 'opus'
const result = await agent('Pick the approach for the cache layer.', {
  label: 'decide: pick the cache approach',
  model: tier,
  effort: 'high'
})
return result
