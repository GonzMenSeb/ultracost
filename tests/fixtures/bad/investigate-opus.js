export const meta = {
  name: 'investigate-on-opus',
  description: 'An investigation stage on opus, which only sonnet may run',
  phases: [{ title: 'Investigate', detail: 'one mapper' }]
}

phase('Investigate')
return agent('Map every caller of loadConfig under src and report the file and line of each.', {
  label: 'investigate: map loadConfig callers',
  phase: 'Investigate',
  model: 'opus',
  effort: 'high'
})
