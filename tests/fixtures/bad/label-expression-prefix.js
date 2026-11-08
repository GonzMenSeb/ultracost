const topic = 'cache layer'
const result = await agent(`Pick the approach for the ${topic}.`, {
  label: `${topic}decide: pick the approach`,
  model: 'opus',
  effort: 'high'
})
return result
