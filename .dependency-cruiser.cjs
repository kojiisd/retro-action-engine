/**
 * Dependency rules for the monorepo.
 *
 * The source of truth is docs/architecture.md section 3 (package DAG and dependency table).
 * Keep this file and that table in sync.
 *
 * Every layer rule is an allow-list: a layer may import only itself, the layers listed in
 * LAYERS, and (for external packages) what its package.json declares. Imports can show up in
 * two forms, so each rule matches both:
 *   - resolved:   "packages/pack/src/index.ts" (the workspace package is linked in node_modules)
 *   - unresolved: "@retro-action-engine/pack"  (the package is not declared as a dependency)
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */

/** Layer id -> { dir, name, allowed: layer ids it may import }. */
const LAYERS = {
  core: { dir: 'packages/core', name: '@retro-action-engine/core', allowed: [] },
  pack: { dir: 'packages/pack', name: '@retro-action-engine/pack', allowed: ['core'] },
  input: { dir: 'packages/input', name: '@retro-action-engine/input', allowed: ['core'] },
  'renderer-phaser': {
    dir: 'packages/renderer-phaser',
    name: '@retro-action-engine/renderer-phaser',
    allowed: ['core', 'pack'],
  },
  player: {
    dir: 'apps/player',
    name: '@retro-action-engine/player',
    allowed: ['core', 'pack', 'input', 'renderer-phaser'],
  },
  // Data only. The sample pack is copied statically; it never imports engine code.
  sample: { dir: 'packs/sample', name: '@retro-action-engine/sample-pack', allowed: [] },
  // Isolated from the engine in both directions.
  infra: { dir: 'infra', name: '@retro-action-engine/infra', allowed: [] },
};

const TEST_FILE = '\\.test\\.ts$';
// Any module that belongs to this repository, in resolved or unresolved form.
const REPO_INTERNAL = '^(packages|apps|packs|infra)/|^@retro-action-engine/';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

const layerRules = Object.entries(LAYERS).map(([id, layer]) => {
  const allowedTargets = layer.allowed.map((a) => LAYERS[a]);
  return {
    name: `layer-${id}`,
    severity: 'error',
    comment:
      `${layer.dir} may import only itself and: ` +
      `${layer.allowed.length > 0 ? layer.allowed.join(', ') : '(no other workspace package)'}. ` +
      'See docs/architecture.md section 3.',
    from: { path: `^${layer.dir}/` },
    to: {
      path: REPO_INTERNAL,
      pathNot: [
        `^${escapeRegex(layer.dir)}/`,
        ...allowedTargets.map((t) => `^${escapeRegex(t.dir)}/`),
        ...allowedTargets.map((t) => `^${escapeRegex(t.name)}$`),
      ],
    },
  };
});

module.exports = {
  forbidden: [
    ...layerRules,

    {
      name: 'core-no-external',
      severity: 'error',
      comment:
        'packages/core must be pure TypeScript: no npm packages and no Node built-ins in source files. ' +
        'Only vitest and fast-check are allowed in test files.',
      from: { path: '^packages/core/', pathNot: TEST_FILE },
      to: { dependencyTypesNot: ['local'] },
    },
    {
      name: 'core-test-external',
      severity: 'error',
      comment: 'Core test files may import only vitest and fast-check from outside the package.',
      from: { path: `^packages/core/.*${TEST_FILE}` },
      to: {
        dependencyTypesNot: ['local'],
        pathNot: [
          '^node_modules/\\.pnpm/(vitest|fast-check)@',
          '^(vitest|fast-check)$',
          REPO_INTERNAL,
        ],
      },
    },
    {
      name: 'phaser-only-in-renderer',
      severity: 'error',
      comment: 'Phaser is a rendering detail. Only packages/renderer-phaser may import it.',
      from: { pathNot: '^packages/renderer-phaser/' },
      to: { path: ['^node_modules/\\.pnpm/phaser@', '^phaser($|/)'] },
    },

    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make the dependency direction ambiguous.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment:
        'The import cannot be resolved. With pnpm this usually means the package is not declared ' +
        'in the importing package.json.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-non-package-json',
      severity: 'error',
      comment: 'Source files may import only packages declared in their own package.json.',
      from: { pathNot: TEST_FILE },
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment: 'Source files must not import devDependencies. Test files may.',
      from: { pathNot: TEST_FILE },
      to: { dependencyTypes: ['npm-dev'] },
    },
    {
      name: 'not-to-test',
      severity: 'error',
      comment: 'Source files must not import test files.',
      from: { pathNot: TEST_FILE },
      to: { path: TEST_FILE },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Only this repository's own build output. A plain "dist" pattern would also hide
    // node_modules/<pkg>/dist/*, which is where packages like vitest resolve to.
    exclude: { path: '^(packages|apps|packs)/[^/]+/dist/' },
    // Count `import type` and imports that TypeScript erases, too.
    tsPreCompilationDeps: true,
    // Workspace packages expose their TypeScript source through package.json "exports".
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
