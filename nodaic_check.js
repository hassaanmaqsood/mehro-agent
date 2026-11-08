#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import { Process } from './engine/nodaic_minimal.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node nodaic_check.js <tool-file> [--input \'{...}\'] [--state \'{...}\']');
    process.exit(1);
  }

  const toolFilePath = args[0];
  let input = {};
  let state = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      try {
        input = JSON.parse(args[i + 1]);
      } catch (err) {
        console.error(`Invalid JSON for --input: ${err.message}`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--state' && args[i + 1]) {
      try {
        state = JSON.parse(args[i + 1]);
      } catch (err) {
        console.error(`Invalid JSON for --state: ${err.message}`);
        process.exit(1);
      }
      i++;
    }
  }

  const resolvedPath = path.resolve(toolFilePath);
  let mod;
  try {
    mod = await import(resolvedPath);
  } catch (err) {
    console.error(`Failed to load file [${resolvedPath}]: ${err.message}`);
    process.exit(1);
  }

  const exported = mod.default || mod;
  let proc = null;

  if (exported instanceof Process) {
    proc = exported;
  } else if (typeof exported === 'function') {
    proc = new Process(exported);
  } else if (exported && typeof exported === 'object') {
    if (exported.artifactType === 'process') {
      proc = Process.fromArtifact(exported);
    } else if (typeof exported.source === 'function' || typeof exported.source === 'string') {
      proc = Process.fromArtifact({
        artifactType: 'process',
        ...exported
      });
    } else if (typeof exported.function === 'function') {
      // Legacy wrapper compatibility if needed
      proc = new Process(exported.function);
    }
  }

  if (!proc) {
    console.error(`Could not create a valid Nodaic Process from [${resolvedPath}]`);
    process.exit(1);
  }

  try {
    const result = await proc.compute(input, state);
    console.log(JSON.stringify(result, null, 2));
    if (result.error && !result.output) {
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    console.error(`Process computation failed: ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
