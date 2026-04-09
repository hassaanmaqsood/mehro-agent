const { z } = require("zod");
const { evaluate } = require("mathjs");

module.exports = {
  name: "calculate",
  description: "Evaluate a mathematical expression safely using mathjs",
  schema: z.object({
    expression: z.string()
  }),
  parameters: {
    expression: {
      type: "string",
      description: "Mathematical expression to evaluate (e.g., '2 + 2', '10 * 5')"
    }
  },
  required: ["expression"],
  function: async ({ expression }, context) => {
    try {
      const result = evaluate(expression);
      console.log(`[CALCULATE] ${expression} = ${result}`);
      return { success: true, output: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};
