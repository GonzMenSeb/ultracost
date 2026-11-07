async function ask(agent, prompt) {
  return agent(prompt, {
    label: 'decide: pick the cache approach',
    model: 'opus',
    effort: 'high'
  })
}
return ask
