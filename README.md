# retro-action-engine

2D サイドビュー探索型アクションゲームのための「エンジン + ゲームパック」型プラットフォーム。素材とデータ（パック）を差し替えるだけで、複数の主人公を切り替えながら能力やアイテムで探索範囲を広げていく種類のゲームを再現できることを目標にしています。

## 設計目標

- コアは描画非依存の純 TypeScript。Phaser 4 は描画アダプタに留める。
- 8.8 固定小数点と 60Hz 固定 tick による決定論。入力ログの記録と再生で、画面のない環境でも操作感を検証できる。
- 1〜N 人のパーティ、能力タグによる通行判定、画面切替型とスクロール型のカメラをパック設定で選べる。
- キーボード、ゲームパッド、タッチ（仮想パッド）に対応。操作感プロファイルで原作風の固い操作と現代的な操作を切り替えられる。
- Web / PWA ファースト（PC ブラウザ、Android、iPhone）。配信は S3 + CloudFront。

## 技術スタック

TypeScript / Vite / Phaser 4 / Vitest、pnpm workspaces、Biome、Playwright、AWS CDK（配信基盤）。

## 現在の状態

M0（リポジトリ骨格）まで実装済みです。各パッケージは空のエントリとダミーテストだけで、ゲームのロジックはまだありません。次は [docs/roadmap.md](docs/roadmap.md) の M1-1（インフラとプレビュー配備）です。

## 開発

Node 22 と pnpm 12（`package.json` の `packageManager` で固定）を使います。

```sh
pnpm install
pnpm lint        # Biome
pnpm typecheck   # tsc -b（project references）
pnpm test        # Vitest
pnpm depcruise   # 依存方向の検査
pnpm build
```

パッケージ構成と依存方向は [docs/architecture.md](docs/architecture.md) の 3 章を参照してください。

## 設計ドキュメントの読む順序

| 順 | ドキュメント | 内容 |
| --- | --- | --- |
| 1 | [docs/architecture.md](docs/architecture.md) | 全体構成、パッケージと依存方向、データフロー、境界 API の型スケッチ |
| 2 | [docs/decisions/README.md](docs/decisions/README.md) | ADR の一覧。主要な判断の背景、選択肢、決定、結果 |
| 3 | [docs/pack-spec.md](docs/pack-spec.md) | パックの形式。manifest、データファイル、Tiled の規約、外部パックの読み込み |
| 4 | [docs/input-and-feel.md](docs/input-and-feel.md) | 入力層、エッジ規則、操作感プロファイルのパラメータ、リプレイ形式 |
| 5 | [docs/roadmap.md](docs/roadmap.md) | マイルストーンと受け入れ条件 |
| 6 | [CLAUDE.md](CLAUDE.md) | 開発セッションが守るルール（依存方向、固有値禁止、決定論、テスト） |

ADR のうち最初に読むもの: [ADR-0001 コアと描画の境界](docs/decisions/ADR-0001-core-render-boundary.md)、[ADR-0002 固定小数点と決定論](docs/decisions/ADR-0002-fixed-point-determinism.md)、[ADR-0008 入力アーキテクチャ](docs/decisions/ADR-0008-input-architecture.md)、[ADR-0012 テスト戦略](docs/decisions/ADR-0012-test-strategy.md)。

## パックとライセンス

- リポジトリにはオリジナル素材のサンプルパックのみを置きます。既存作品の素材、キャラクター名、楽曲は含めません。
- 私的なパックはリポジトリ外（URL またはローカルフォルダ）から読み込む設計です。
- ライセンスはエンジン本体が MIT です（[LICENSE](LICENSE)）。サンプル素材は CC0 とする予定です。
