const research = await parallel([
  () => agent('Research the provider limits.', { label: 'decide: ovh extra ip research', model: 'opus', effort: 'high' }),
  () => agent('Design the relay.', { label: 'decide: pc1 relay design', model: 'opus', effort: 'high' }),
  () => agent('Assess readiness.', { label: 'judge: migration readiness', model: 'opus', effort: 'high' })
])
const plan = await agent('Synthesize the research into one plan.', { label: 'synth: research synthesis', model: 'opus', effort: 'high' })
return plan
