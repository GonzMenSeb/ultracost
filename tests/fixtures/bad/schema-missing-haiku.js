const result = await agent('List every TODO comment in src/.', {
  label: 'grunt: list todos',
  model: 'haiku',
  effort: 'xhigh'
})
return result
