// shell execution tool

const { exec } = require('child_process');

module.exports = {
    name: "shell",
    description: "Execute a shell command",
    parameters: {
        command: {
            type: "string",
            description: "The shell command to execute"
        }
    },
    required: ["command"],
    function: async ({ command }) => {
        return new Promise((resolve) => {
            exec(command, (error, stdout, stderr) => {
                const output = stdout || stderr || (error ? error.message : "Command executed");
                resolve({ success: !error, output });
            });
        });
    }
}