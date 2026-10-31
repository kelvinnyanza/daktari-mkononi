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

// Exactly one React in the bundle: the app's own (19.1.x, pinned by RN 0.81).
// A package that imports `react` without declaring it resolves through pnpm's
// hoisted fallback, which can be the WEB app's React 19.2 — two Reacts and
// "Invalid hook call" (seen with @daily-co/react-native-daily-js 0.89). The
// real fix is packageExtensions in pnpm-workspace.yaml; this pin makes any
// future offender harmless by resolving react/* from this app, whoever asks.
const PINNED = /^react(\/.*)?$/;
const appOrigin = path.join(projectRoot, 'package.json');
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest;
  if (PINNED.test(moduleName)) {
    return resolve({ ...context, originModulePath: appOrigin }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
