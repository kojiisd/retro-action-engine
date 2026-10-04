# ADR-0013: モノレポ構成とツール

- Status: Accepted
- Date: 2026-10-04
- 論点: J

## 背景

複数パッケージ（core / pack / input / renderer-phaser / apps/player / packs/sample / infra）を 1 リポジトリで扱う。依存方向を機械的に守りたい。M0 は軽くする（Turborepo なし）。

## 選択肢

| 論点 | 案 | 採用 | 理由 |
| --- | --- | --- | --- |
| ワークスペース | pnpm workspaces / Turborepo / Nx | pnpm workspaces のみ | 規模に対して Turborepo と Nx は過剰。`pnpm -r` と `--filter` で足りる |
| TypeScript | 6.0.x / 7.0.x | 6.0.x | 7.0 は Go 製ネイティブで高速だが、周辺ツールの対応を見てから移行する |
| Lint / Format | Biome 2 / ESLint 10 + Prettier | Biome 2 | 単一ツールで高速。型情報を使うルールは `tsc --strict` で補う |
| 依存方向の検査 | dependency-cruiser / eslint-plugin-boundaries | dependency-cruiser | Biome に境界ルールが無い。ESLint を入れずに済む |
| テスト | Vitest 5 | Vitest 5 | Vite 8 と組み合わせる。root の `projects` 設定で全パッケージを 1 コマンドで実行 |
| Node | 22 / 24 | 22 LTS | 本セッション環境と一致。Vitest 5 の要件（^22.12 または ^24）を満たす |

## 決定

- `pnpm-workspace.yaml`: `apps/*`, `packages/*`, `packs/*`, `infra`。`packageManager` に pnpm 12 を固定。
- パッケージ名は `@retro-action-engine/<name>`。`apps/player`, `packs/sample`, `infra` は `private: true`。
- TypeScript 6.0.x、`strict: true`、project references（`tsconfig.base.json` を継承）。`core` の `lib` は `["ES2023"]`。
- Biome 2 で lint と format。`biome.json` は root に 1 つ。
- dependency-cruiser の `forbidden` ルールで、`architecture.md` 3 章の表にない方向の import を禁止する。`core` から DOM 型を参照する import（`lib.dom` を要する識別子）は `tsc` が検出する。
- Vitest 5 を root に 1 つ設定し、`projects` で各パッケージを登録する。環境は node。ブラウザテストは Playwright（`apps/player/e2e`）。
- fast-check を `core` の devDependency に入れる。
- root スクリプト（M0 で確定）: `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test`, `pnpm depcruise`, `pnpm build`, `pnpm golden:update`, `pnpm e2e`。
- `.nvmrc` = 22。`engines.node >= 22.12`。
- コミットは Conventional Commits。リリースは当面 git tag。npm 公開することになったら changesets を検討する。
- CI の基本ジョブ（`ci.yml`）: `pnpm install --frozen-lockfile` → `lint` → `typecheck` → `test` → `depcruise` → `build`。Playwright は M1-5 から追加。

## 結果

- 得られるもの: 軽い M0、依存方向の機械的な保証、単一の lint / format ツール。
- 失うもの: タスクキャッシュ（Turborepo）。CI 時間が問題になったら再検討する。
- フォローアップ: TypeScript 7 への移行は Biome、vite-plugin-dts、typedoc の対応を確認してから別 ADR で判断する。

## 要確認

- なし（TS 7 の移行時期は後続判断）。
