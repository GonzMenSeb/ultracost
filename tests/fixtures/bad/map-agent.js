const prompts = args.prompts
const results = await Promise.all(prompts.map(agent))
return results
