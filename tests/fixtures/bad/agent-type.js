const result = await agent('Review the diff.', {
  label: 'judge: review the diff',
  model: 'opus',
  effort: 'high',
  agentType: 'code-reviewer'
})
return result
