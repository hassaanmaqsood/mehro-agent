export function isCommandAllowed(command, allowlist = [], blocklist = []) {
  if (!command || typeof command !== 'string') {
    return { allowed: false, reason: 'Empty or invalid command' };
  }

  const trimmed = command.trim();
  const binary = trimmed.split(/\s+/)[0];

  // 1. Check blocklist: if command contains any blocklisted substring or command name
  for (const blocked of blocklist) {
    if (trimmed.includes(blocked) || binary === blocked) {
      return { allowed: false, reason: `Command matches blocklist: ${blocked}` };
    }
  }

  // 2. Check allowlist: if allowlist is defined, binary must be listed
  if (Array.isArray(allowlist) && allowlist.length > 0) {
    if (!allowlist.includes(binary)) {
      return { allowed: false, reason: `Command '${binary}' is not in shell allowlist` };
    }
  }

  return { allowed: true, reason: null };
}

export default {
  isCommandAllowed
};
