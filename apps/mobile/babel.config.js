module.exports = function (api) {
  // WEB ONLY: zustand's ESM build reads `import.meta.env`, which a classic
  // (non-module) web script cannot parse. Native bundles are unchanged.
  const isWeb = api.caller((caller) => caller?.platform === 'web');
  return {
    presets: [['babel-preset-expo', isWeb ? { unstable_transformImportMeta: true } : {}]],
  };
};
