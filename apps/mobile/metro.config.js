// Metro configured for the pnpm monorepo: watch the workspace root and
// resolve packages from both the app's and the root node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// pnpm symlinks: let Metro follow them instead of duplicating modules.
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
