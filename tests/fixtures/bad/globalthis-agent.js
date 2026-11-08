const result = await globalThis.agent('Pick the approach for the cache layer.', {
  label: 'decide: pick the cache approach',
  model: 'opus',
  effort: 'high'
})
return result
