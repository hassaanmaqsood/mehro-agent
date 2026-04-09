const { z } = require("zod");

module.exports = {
  name: "log",
  description: "Log a message to console",
  schema: z.object({
    message: z.string()
  }),
  parameters: {
    message: {
      type: "string",
      description: "message to log"
    }
  },
  required: ["message"],
  function: async ({ message }, context) => {
    console.log(`[LOG] ${message}`);
    return { success: true, output: message };
  }
};
