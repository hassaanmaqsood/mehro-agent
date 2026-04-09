const { z } = require("zod");

module.exports = {
  name: "delay",
  description: "Wait for specified milliseconds",
  schema: z.object({
    milliseconds: z.number()
  }),
  parameters: {
    milliseconds: {
      type: "number",
      description: "Number of milliseconds to wait"
    }
  },
  required: ["milliseconds"],
  function: async ({ milliseconds }, context) => {
    await new Promise(resolve => setTimeout(resolve, milliseconds));
    console.log(`[DELAY] Waited ${milliseconds}ms`);
    return { success: true, output: `Delayed ${milliseconds}ms` };
  }
};
