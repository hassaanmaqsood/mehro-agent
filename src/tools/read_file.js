const { z } = require("zod");
const fs = require('fs').promises;

module.exports = {
  name: "read_file",
  description: "Read contents of a file",
  schema: z.object({
    filepath: z.string()
  }),
  parameters: {
    filepath: {
      type: "string",
      description: "Path to the file to read"
    }
  },
  required: ["filepath"],
  function: async ({ filepath }, context) => {
    try {
      const content = await fs.readFile(filepath, 'utf-8');
      console.log(`[READ_FILE] Read ${filepath}`);
      return { success: true, output: content };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};
