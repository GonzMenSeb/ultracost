const call = [
  'Pick the approach for the cache layer.',
  { label: 'decide: pick the cache approach', model: 'opus', effort: 'high' }
]
const result = await agent(...call)
return result
