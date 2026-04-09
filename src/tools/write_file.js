const { z } = require("zod");
const fs = require('fs').promises;

module.exports = {
  name: "write_file",
  description: "Write content to a file",
  schema: z.object({
    filepath: z.string(),
    content: z.string()
  }),
  parameters: {
    filepath: {
      type: "string",
      description: "Path to the file to write"
    },
    content: {
      type: "string",
      description: "Content to write to the file"
    }
  },
  required: ["filepath", "content"],
  function: async ({ filepath, content }, context) => {
    try {
      await fs.writeFile(filepath, content, 'utf-8');
      console.log(`[WRITE_FILE] Wrote to ${filepath}`);
      return { success: true, output: `File written: ${filepath}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};
