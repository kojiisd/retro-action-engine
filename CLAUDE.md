# CLAUDE.md

retro-action-engine で作業するセッションが守るルール。設計の根拠は `docs/` にある。本ファイルと docs が食い違う場合は、まず docs を直してから作業する。

## プロジェクト概要

- 2D サイドビュー探索型アクションのための「エンジン + ゲームパック」型プラットフォーム。
- TypeScript / Vite / Phaser 4 / Vitest。pnpm workspaces（Turborepo なし）。Node 22 LTS、TypeScript 6.0.x、Biome。
- コアは描画非依存の純 TypeScript。Phaser は描画アダプタに留める。
- 必読: `docs/architecture.md`、`docs/decisions/README.md`、作業対象に関係する ADR、`docs/roadmap.md` の該当サブステップ。

## 言語

- ドキュメント、ADR、コミットメッセージ、PR 本文は日本語。
- コードの識別子、コメント、ログメッセージ、テスト名は英語。

## 層と依存方向（違反は CI の dependency-cruiser で失敗する）

```
pack → core
input → core
renderer-phaser → core, pack, phaser
apps/player → core, pack, input, renderer-phaser（packs/sample は静的コピーと fixture）
infra → aws-cdk-lib のみ（エンジンの全パッケージから独立）
```

| パッケージ | してはいけないこと |
| --- | --- |
| `core` | DOM、`phaser`、`pack`、`input` を import する。外部ライブラリを増やす（ADR で承認されたもの以外） |
| `pack` | DOM API を直接呼ぶ（I/O は注入する）。`input`、`renderer-phaser` を import する |
| `input` | `pack`、`renderer-phaser` を import する |
| `renderer-phaser` | `input` を import する。ゲームロジックを書く |
| `apps/player` | ゲームロジックや衝突判定を書く（配線と UI のみ） |

`core` の tsconfig は `lib: ["ES2023"]` で DOM 型を含めない。`window`、`document`、`performance`、`fetch` が `core` に現れたら設計違反。

## エンジンに固有値を書かない

- キャラクター名、敵名、部屋名、アイテム名、能力タグの具体値、速度や重力などの調整値、解像度、タイルサイズをエンジンのコードに書かない。すべてパックデータ（`docs/pack-spec.md`）から読む。
- エンジンが持ってよい定数は、tick レート（60）、Fx のスケール（256）、ループの上限（250ms、5 tick）、InputBuffer の上限（256 件、`maxBacklogTicks` の既定 6）のような「仕組みの定数」のみ。追加する場合は ADR に書く。
- テスト用の fixture 値はテストファイル内に閉じる。
- 「1 人構成なら切替 UI を出さない」のように、パックの構成から導ける分岐はデータ駆動で書く。キャラクター ID による分岐は禁止（能力タグで判定する）。

## 既存作品の素材・名称を含めない

- 参考にした既存作品のタイトル、キャラクター名、地名、楽曲名、画像、音声、マップデータを、コード、docs、コミット、Issue、PR、テスト名のいずれにも書かない・入れない。
- リポジトリに置く素材はオリジナルのサンプルパック（CC0）のみ。私的な再現パックはリポジトリ外から読み込む設計であり、リポジトリに追加しない。
- 新しい素材を追加するときは `packs/sample/credits.json` に出所とライセンスを記録する。

## 決定論（`core` の禁止事項）

- 使用禁止: `Math.random`、`Date`、`performance`、`Math.sin/cos/tan/atan2/pow/exp/log/sqrt`、浮動小数点の累積（位置・速度・タイマーは必ず `Fx` または整数）。
- 乱数は `World.rng`（xorshift32）だけを使う。三角関数が必要なら整数テーブルをデータとしてコミットする。
- エンティティの走査は id 昇順。`sort` には id のタイブレークを付ける。`Map`/`Set` の反復順に依存しない。
- 丸めは 2 種類のみ: スケーリング（`fx.mul/div`）は 0 方向切り捨て、座標からタイル座標などへの変換は床関数（`>>`）。それ以外の丸めを書かない。
- `fx.mul` の前提（abs(a), abs(b) < 2^26）を破る計算を書かない。疑わしい箇所はテストで `fx.setChecks(true)` を有効にして実行する。
- システムの実行順（`docs/architecture.md` 4.3）を変える場合は ADR を追加する。

## テスト

- ロジックの変更には必ずテストを付ける。優先順位は (1) 結果アサーションの Feel scenario、(2) 実行同士の比較による Determinism テスト、(3) Property テスト、(4) Unit テスト。
- 保存済み hash の golden は 2〜3 本に限定する。golden の更新手順:
  1. `pnpm golden:update` で再生成する。
  2. PR 本文に「更新理由」と「対応する feel / rules / 物理 / システム順の変更」を書く。
  3. それらの変更を伴わない golden 更新は差し戻す。
- 操作感パラメータの調整では golden 以外のテストが壊れないこと。壊れる場合はテストが閾値を固定値で持っている疑いがある。閾値はプロファイル値から導出する。
- 「flake だから」という理由でテストをスキップ・無効化しない。決定論テストが不安定なら、それ自体が決定論の欠陥。
- 新しい Phaser API や CDK API を使う前に、下記の一次情報で存在と引数を確認する。

## 外部 API は記憶に頼らず型定義で確認する

- Phaser: `node_modules/phaser/types/phaser.d.ts`、`node_modules/phaser/skills/*/SKILL.md`（Phaser Studio 製のガイド）、`node_modules/phaser/changelog/v4/4.0/MIGRATION-GUIDE.md`。Phaser 3 の記憶で書かない（Pipeline、FX、BitmapMask、Geom.Point は v4 に無い）。
- AWS CDK: `node_modules/aws-cdk-lib` の `.d.ts`。
- Vite / Vitest / vite-plugin-pwa: 各パッケージの `README` と型定義。
- 確認した事実は PR 本文かコメントに「どのファイルで確認したか」を一言添える。

## 作業の進め方

- `docs/roadmap.md` のサブステップ単位で作業し、1 サブステップ = 1 PR。受け入れ条件のテストが通ってから PR を出す。
- PR を出す前にローカルで `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm depcruise` を通す（M0 でスクリプト名を確定する）。
- 設計と異なる実装が必要になったら、先に ADR を追加または更新してから実装する。
- 実装の型やフィールド名は `docs/architecture.md` と `docs/pack-spec.md` のスケッチに合わせる。変えるときは docs も同じ PR で直す。
- コミットは Conventional Commits（`feat(core): ...`、`fix(input): ...`、`docs: ...`、`chore(infra): ...`）。
- シークレットをコミットしない。AWS のロール ARN やバケット名は GitHub の repository variables に置く。`infra/` の `cdk deploy` はリポジトリ所有者が手元で実行し、CI からは実行しない。

## 現在の状態

- 設計フェーズ。`src/` 配下の実装はまだ無い。最初の実装は `docs/roadmap.md` の M0 から始める。
