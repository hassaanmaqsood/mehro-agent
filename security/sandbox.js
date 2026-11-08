import path from 'path';

export function validatePath(targetPath, workspaceDir = './workspace') {
  if (!targetPath || typeof targetPath !== 'string') {
    return { valid: false, error: 'path_violation', resolvedPath: null };
  }

  const resolvedTarget = path.resolve(targetPath);
  const resolvedWorkspace = path.resolve(workspaceDir);

  const relative = path.relative(resolvedWorkspace, resolvedTarget);
  const isInside = !relative.startsWith('..') && !path.isAbsolute(relative);

  if (!isInside && resolvedTarget !== resolvedWorkspace) {
    return { valid: false, error: 'path_violation', resolvedPath: resolvedTarget };
  }

  return { valid: true, error: null, resolvedPath: resolvedTarget };
}

export default {
  validatePath
};
