const w = workflow
const result = await w({ scriptPath: '/tmp/child.js' }, args)
return result
