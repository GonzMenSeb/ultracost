const options = { label: 'decide: pick the cache approach', model: 'opus', effort: 'high' }
const result = await agent('Pick the approach for the cache layer.', options)
return result
