const name = 'cache layer'
const result = await agent('Pick the approach for the cache layer.', {
  label: 'decide: ' + name,
  model: 'opus',
  effort: 'high'
})
return result
