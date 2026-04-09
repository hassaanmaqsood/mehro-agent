const { z } = require("zod");

module.exports = {
  name: "string_transform",
  description: "Transform a string using various operations",
  schema: z.object({
    text: z.string(),
    operation: z.enum(["uppercase", "lowercase", "reverse", "length"])
  }),
  parameters: {
    text: {
      type: "string",
      description: "Text to transform"
    },
    operation: {
      type: "string",
      description: "Operation to perform: uppercase, lowercase, reverse, length"
    }
  },
  required: ["text", "operation"],
  function: async ({ text, operation }, context) => {
    let result;
    switch (operation) {
      case "uppercase":
        result = text.toUpperCase();
        break;
      case "lowercase":
        result = text.toLowerCase();
        break;
      case "reverse":
        result = text.split('').reverse().join('');
        break;
      case "length":
        result = text.length;
        break;
      default:
        return { success: false, error: "Unknown operation" };
    }
    console.log(`[STRING_TRANSFORM] ${operation} applied`);
    return { success: true, output: result };
  }
};
