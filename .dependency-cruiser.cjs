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
  // Analysis tool. Uses the simulation as a library; nothing imports it.
  solver: { dir: 'packages/solver', name: '@retro-action-engine/solver', allowed: ['core'] },
  player: {
    dir: 'apps/player',
    name: '@retro-action-engine/player',
    allowed: ['core', 'pack', 'input', 'renderer-phaser'],
  },
  // The game list at the top of the site. Its build config reads site.json through site-tools.
  gallery: {
    dir: 'apps/gallery',
    name: '@retro-action-engine/gallery',
    allowed: ['site-tools'],
  },
  // Builds the whole site from site.json. Knows the app packages by name only, never imports them.
  'site-tools': { dir: 'scripts/site', name: '@retro-action-engine/site-tools', allowed: [] },
  // Isolated from the engine in both directions.
  infra: { dir: 'infra', name: '@retro-action-engine/infra', allowed: [] },
};

// Vitest tests (*.test.ts) and Playwright tests (*.e2e.ts).
const TEST_FILE = '\\.(test|e2e)\\.ts$';
// Files that are never part of a runtime bundle: tests, tool configs (vite.config.ts,
// vitest.config.ts) and type declarations. They may use devDependencies and root tooling.
const BUILD_TIME_FILE = '(\\.test\\.ts|\\.e2e\\.ts|\\.config\\.ts|\\.d\\.ts)$';
// Any module that belongs to this repository, in resolved or unresolved form.
const REPO_INTERNAL = '^(packages|apps|packs|infra|scripts)/|^@retro-action-engine/';

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
        'Test files have their own rule below; build-time config files (vitest.config.ts) are exempt.',
      from: { path: '^packages/core/', pathNot: BUILD_TIME_FILE },
      to: { dependencyTypesNot: ['local'] },
    },
    {
      name: 'core-test-external',
      severity: 'error',
      comment:
        'Core test files may import only vitest, fast-check and Node built-ins (the determinism ' +
        'guard reads the sources) from outside the package.',
      from: { path: `^packages/core/.*${TEST_FILE}` },
      to: {
        dependencyTypesNot: ['local', 'core'],
        pathNot: [
          '^node_modules/\\.pnpm/(vitest|fast-check)@',
          '^(vitest|fast-check)$',
          REPO_INTERNAL,
        ],
      },
    },
    {
      name: 'core-testing-only-in-tests',
      severity: 'error',
      comment:
        'The core test fixtures (@retro-action-engine/core/testing) are for test files only. ' +
        'A package may build its own fixtures on them in src/test-support.ts (or test-setup.ts).',
      from: { pathNot: [TEST_FILE, '^packages/[^/]+/src/test-(support|setup)\\.ts$'] },
      to: {
        path: ['^packages/core/src/test-support\\.ts$', '^@retro-action-engine/core/testing$'],
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
      comment:
        'Source files may import only packages declared in their own package.json. ' +
        'Tests, tool configs and type declarations may also use root tooling.',
      from: { pathNot: BUILD_TIME_FILE },
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment:
        'Source files must not import devDependencies. Tests, tool configs and type ' +
        'declarations may.',
      from: { pathNot: BUILD_TIME_FILE },
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
    exclude: {
      path: [
        '^(packages|apps|packs|scripts)/[^/]+/dist(-e2e)?/',
        '^infra/(dist|cdk\\.out)/',
        '^dist-site/',
      ],
    },
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
