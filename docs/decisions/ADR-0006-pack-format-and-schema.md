# ADR-0006: パック形式とスキーマ検証

- Status: Accepted
- Date: 2026-10-04
- 論点: D

## 背景

エンジンは固有名詞と調整値を持たず、すべてをパックから読む。パックは Tiled で作ったマップ、アトラス、音声、JSON のデータ群で構成され、リポジトリ外（URL、ローカルフォルダ）からも読めなければならない。作者が間違いにすぐ気付けるよう、スキーマ検証とエディタ補完が必要。

## 選択肢

### スキーマの単一ソース

| 案 | 長所 | 短所 |
| --- | --- | --- |
| zod 4（採用） | TypeScript 型を推論できる。`z.toJSONSchema`（draft 2020-12 既定）で JSON Schema を生成できる。エラーメッセージが読みやすい | 実行時にライブラリを含む（zod mini で縮小可） |
| JSON Schema + ajv | エディタ対応が広い | TypeScript 型は別途生成。検証ロジックの二重管理になりやすい |
| TypeScript 型のみ | 依存なし | 実行時検証がない。外部パックの誤りを検出できない |

### Tiled マップの取り込み時期

| 案 | 長所 | 短所 |
| --- | --- | --- |
| ビルド時に独自形式へコンパイル | 実行時が軽い | 私的パックに CLI の実行を強いる。コードパスが 2 本になる |
| 実行時に `.tmj` を直接読む（採用） | コードパスが 1 本。フォルダを置くだけで動く | 実行時のパース時間（部屋単位なら無視できる） |

## 決定

### 構成

```
pack-root/
├─ pack.json              # manifest
├─ rooms/*.tmj            # Tiled JSON（1.11 系）
├─ tilesets/*.json, *.png # Tiled の外部タイルセット（JSON）と画像
├─ atlases/*.json, *.png  # TexturePacker / free-tex-packer の JSON Hash、または Aseprite JSON
├─ audio/*                # SFX / BGM
├─ data/
│  ├─ characters.json, enemies.json, items.json, gimmicks.json
│  ├─ rules.json, feel.json, input.json, camera.json, audio.json
│  └─ strings.<lang>.json
├─ credits.json           # 素材の出所とライセンス
└─ LICENSE
```

### manifest と検証

- `pack.json` の `formatVersion` は `major.minor`。minor は後方互換の追加のみ。major の変更は `pack/src/migrate/` に migrate 関数を必須とする。エンジン本体の semver とは独立。
- すべてのデータファイルを zod 4 で検証する。ロード時に 1 回。エラーは `file#/json/pointer: message` の形式で集約して返す。
- `pnpm schema:emit`（M4）で `schemas/*.schema.json` を生成してコミットし、Tiled と VS Code の補完、CI 検証に使う。ajv は使わない。
- 参照整合性（存在しない `roomId`、`spawnId`、`atlas`、`frame`、`itemId` の参照）はスキーマの後段で `pack` が検査する。

### Tiled 連携（1.11 系 JSON）

- タイルレイヤ名: `bg`（背景）、`main`（衝突を持つ）、`fg`（前景）。衝突は `main` のタイルのクラスから生成する。
- タイルのクラス（Tiled の `class` / 旧 `type`）とカスタムプロパティ → `TileClass`。例: `class: "oneway"`、`class: "water"` + `requiresAnyTag: "move:swim"`。
- オブジェクトレイヤ: `entities`（敵、ギミック、spawn）、`zones`（イベント領域、カメラ領域）、`exits`（出口）。オブジェクトの `class` = 種別、プロパティ = パラメータ。
- Phaser の Tiled パーサは使わない。`pack` の importer（pure TS）が `RoomData` を作り、描画層は `renderLayers` から `make.tilemap({ data })` で描く。

### アセット

- アトラス: JSON Hash（`frames` がオブジェクト）を第一、Aseprite JSON を第二にサポート。アニメーションの frame 列、tick 長、hit/hurt box はパックの JSON で定義し、Phaser の Animation は使わない。
- 音: `audio.json` で SFX / BGM と、BGM の `loopStart / loopEnd`（秒）を定義。ファイル形式は要確認（M4 の実機検証で確定）。
- 文字列: `strings.<lang>.json` に集約し、他のデータからは `@strings:key` で参照する。

### 外部パックの読み込み

- `PackSource` の 4 種: `builtin`（`/packs/sample/`）、`url`（`?pack=https://...`。CORS 必須）、`localDirectory`（File System Access API。未対応ブラウザは `<input webkitdirectory>`、iOS は zip 選択）、`cached`（IndexedDB に保存済み）。
- すべてのパスは `pack.json` からの相対パスに限定する。絶対 URL と `..` は拒否する。
- 外部パックはデータのみ（JSON、画像、音声）。コードは読み込まない（ADR-0005）。
- 初回読み込み時に出所を表示して確認を求め、読み込み後は IndexedDB に保存してオフラインでも使えるようにする。キャッシュのキーは `url + version`。

### CLI（M4 で `pack-cli` として分離）

- `validate <dir|url>`: スキーマと参照整合性の検査。
- `schema`: JSON Schema の出力。
- `bundle <dir>`: 配布用 zip の生成（任意）。

## 結果

- 得られるもの: 1 本の読み込みコードパス、型とスキーマの単一ソース、作者向けの検証と補完、リポジトリ外からの読み込み。
- 失うもの: 実行時に zod を含む（数十 KB）。Tiled の機能のうち、規約外の使い方（無限マップ、isometric）は非対応。
- フォローアップ: サンプルパックは常に `validate` を通す（CI）。pack-spec の変更は `formatVersion` の更新を伴う。

## 要確認

- 音声フォーマット（ogg + m4a の二重提供を仮置き）。M4 の実機検証で確定。
- 配布用 zip 形式を v1 で持つか（`bundle` は任意機能として M4 で判断）。
