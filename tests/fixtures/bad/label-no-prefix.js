const result = await agent('Pick the approach for the cache layer.', {
  label: 'pick the cache approach',
  model: 'opus',
  effort: 'high'
})
return result
