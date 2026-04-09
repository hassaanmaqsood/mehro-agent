# Mehro Local Agent

Mehro Local Agent is a tool for executing tasks locally using Ollama. It uses Directed Acyclic Graphs (DAGs) to process multi-step requests.

## Features

- **TUI**: Terminal interface for monitoring and triggering tasks manually.
- **Local Execution**: Uses Ollama for processing.
- **DAG Engine**: Breaks requests into sequential or parallel steps (visible as text).
- **Toolbox**: Includes math, file I/O, and HTTP capabilities.
- **History**: Automatically saves tasks to `history.json`.

## Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Setup Environment**:
   ```bash
   cp .env.example .env
   ```

3. **Run**:
   ```bash
   npm start
   ```

## Usage

- **Add Task (T)**: Enter a natural language request.
- **Run Task (Enter)**: Manually start a pending task.
- **Delete (D)**: Remove a task from history.
- **Quit (Q)**: Exit the agent.

## Project Structure

- `src/index.js`: Main agent loop.
- `src/tui.js`: Interface logic.
- `src/tools/`: Tool definitions.
- `src/core/`: Validation logic.

## Future Plans

- Add more tools like web search, pdf reader, etc. 
- Use Nodaic for graph computation
- Adding api for remote access
- Generally just making it more autonmous