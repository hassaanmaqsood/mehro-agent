const { z } = require("zod");
const https = require('https');
const http = require('http');

module.exports = {
  name: "http_request",
  description: "Make an HTTP request to a URL",
  schema: z.object({
    url: z.string(),
    method: z.string().optional()
  }),
  parameters: {
    url: {
      type: "string",
      description: "URL to request"
    },
    method: {
      type: "string",
      description: "HTTP method (GET, POST, etc.)"
    }
  },
  required: ["url"],
  function: async ({ url, method = "GET" }, context) => {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;

      client.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          console.log(`[HTTP_REQUEST] ${method} ${url} - Status: ${res.statusCode}`);
          resolve({
            success: true,
            output: data,
            statusCode: res.statusCode
          });
        });
      }).on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
    });
  }
};
