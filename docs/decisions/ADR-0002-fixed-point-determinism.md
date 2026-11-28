# ADR-0002: 8.8 固定小数点と決定論の規則

- Status: Accepted
- Date: 2026-10-04（改訂 2026-11-14、M1-2 と M1-3）
- 論点: A-1

## 背景

入力ログの記録と再生で操作感を検証するには、同じ入力列から同じ状態が、Node（V8）、Chrome、Safari（JavaScriptCore）、Firefox（SpiderMonkey）のすべてで得られなければならない。IEEE 754 の加減乗除は環境間で一致するが、`Math.sin / cos / pow / exp` などの超越関数は実装依存で結果が異なり得る。また、原作風の操作感では「サブピクセル単位の速度表」のような整数的な挙動を直接表現できることが望ましい。

## 選択肢

| 案 | 概要 | 長所 | 短所 |
| --- | --- | --- | --- |
| 1 | 浮動小数点（`number`）のまま固定ステップ | 実装が素直 | 超越関数の非互換、サブピクセル挙動が不透明、状態 hash の比較が脆い |
| 2 | 整数固定小数点 8.8（1 px = 256 単位）、全状態を int32 | 全環境で完全一致。原作的な速度表が自然。JSON 化と比較が容易 | 丸め規則と値域を自前で定義する。描画層で px に変換する |
| 3 | BigInt | 任意精度 | 遅い、冗長 |

## 決定

案 2 を採用する。以下を `core/src/fx/` の規則とする。

### 表現

- `Fx` は int32 の整数。1 px = 256（`FX_SHIFT = 8`）。
- 位置、速度、加速度、タイマー以外の連続量はすべて `Fx`。タイマーと tick 数は整数（tick 単位）。
- 位置の有効範囲は abs(x) < 2^23 px（= 2^31 / 256）。部屋サイズはこれより十分小さい。

### 演算と値域（double の 53bit 以内で正確に計算するための前提）

| 演算 | 定義 | 前提条件 | 正確性の根拠 |
| --- | --- | --- | --- |
| 加減算 | `a + b`, `a - b` | 結果が int32 範囲 | 整数同士なので常に正確 |
| `fromPx(px)` | `px << 8` | abs(px) < 2^23 | シフトは int32 内で正確 |
| `toPxFloor(v)` | `v >> 8` | なし | 算術シフト = 床関数 |
| `mul(a, b)` | `trunc((a * b) / 256)` | abs(a) < 2^26 かつ abs(b) < 2^26 | 積 < 2^52 < 2^53 なので正確。256 は 2 のべき乗なので除算も正確 |
| `div(a, b)` | `trunc((a * 256) / b)` | abs(a) < 2^31、b ≠ 0 | `a * 256 < 2^39` で正確。商の切り捨ては IEEE 除算が正しく丸めるため環境間で一致 |
| 結果 | すべて `\| 0` で int32 に正規化し、範囲超過は assert | | |

- `mul` の前提 abs(a), abs(b) < 2^26 は、px にして ±262,144 px、速度にして ±262,144 px/tick に相当し、実用上の制約にならない。
- `div` の `a * 256` は int32 を超え得るため、`<<` ではなく乗算で書く。
- 値域 assert は `fx.setChecks(true)` で有効化する。テストでは常に有効、本番ビルドでは無効。

### 丸め規則（2 種類のみ）

| 用途 | 丸め | 理由 |
| --- | --- | --- |
| スケーリング（`mul` / `div`: 摩擦、加速度の係数、lerp、スロープの高さ補間） | 0 方向への切り捨て（trunc） | 左右対称性。右移動と左移動の減速が鏡像になる。床関数だと `v = -1` に 0.9 を掛けると -1 のまま止まらず、`v = +1` は 0 になる非対称が生じる |
| 変換（px → タイル座標、Fx → px） | 床関数（`>>`） | 負座標でもタイル境界が連続する |

これ以外の丸め（四捨五入、天井）をコアで書かない。必要になったら本 ADR を更新する。

### パックデータからの変換

- パックデータは px 単位の小数で書いてよい（例: `runSpeed: 1.5`）。`pack` がロード時に 1 回だけ `Math.round(v * 256)` で `Fx` に変換する。この変換は IEEE の乗算と丸めのみで決定論的である。
- tick 毎の計算にはこの変換後の整数だけを使う。

### 禁止事項と乱数

- `core` では `Math.random`、`Date`、`performance`、`Math.sin/cos/tan/atan2/pow/exp/log/sqrt` を使わない。
- 三角関数的な動き（sine-float など）が必要な場合は、整数の周期テーブル（例: 256 要素）をデータとしてコミットし、コアは参照するだけにする。
- 乱数は xorshift32（シフト 13 / 17 / 5）を `World.rng`（非ゼロの uint32）として持つ。シードは `>>> 0` で uint32 にし、0 になる場合は固定の非ゼロ値（`0x9e3779b9`）に置き換える。`nextInt(n)` は `n ≤ 2^20` を前提に `floor((x >>> 0) / 2^32 * n)` で計算する（`x / 2^32` は正確、`× n` も 52bit 以内で正確）。
- エンティティの走査は id 昇順。`sort` は id でタイブレーク。`Map`/`Set` の反復順に依存しない。
- 時間は tick のみ。壁時計時間をコアに入れない。

### hash

- `hash(world)` は FNV-1a 32bit を 2 レーン（異なる offset basis）で計算し `[hi, lo]` を返す。
- 走査順は固定: `tick`、`rng`、`roomId`（UTF-16 code unit）、`camera`、`party`、`controller`、`animation`、`transition`、`inventory`、`flags`（キーをソート）、`entities`（id 昇順、各コンポーネントはフィールド順固定）。
- 文字列は code unit を、真偽値は 0/1 を、`Fx` と整数は int32 の 4 バイトを投入する。
- 入力のバイト列は次のとおり固定する（M1-2 で実装）。
  - int32: 4 バイト、リトルエンディアン。`rng` のような uint32 も同じビット列で投入する。
  - 真偽値: 1 バイト（0 / 1）。
  - 文字列: 長さを int32 で投入してから、各 UTF-16 code unit を 2 バイト（リトルエンディアン）で投入する。長さを先に入れることで、`"a" + "b"` と `"ab" + ""` を区別する。
  - `flags`: 件数（int32）、続いてキーの昇順に「キー（文字列）、型タグ 1 バイト（0 = 数値、1 = 真偽値）、値」。
  - `entities`: 生存数（int32）、続いて生存エンティティを id 昇順に、コンポーネントの列を固定順で投入する。tombstone とスロット位置は結果に影響しない（`compact` で hash は変わらない）。
- レーンの offset basis: hi は FNV-1a 標準の `0x811c9dc5`、lo は ASCII 文字列 `retro-action-engine` の FNV-1a（`0xea4bc20d`）。どちらも一度決めたら変えない。
- `World` のフィールドは、それを使うシステムと同じ PR で追加し、上の走査順の位置に挿入する（M1-5 時点は `tick`、`rng`、`roomId`、`party`、`controller`、`animation`、`flags`、`entities`。`party` の中身は M2-5 で `hp`、`hazardId`、`hazardTicks` を足した。改訂履歴を参照）。
  - `party`: メンバー数と各 id（文字列）、`activeIndex`、`cooldownTicks`、`entityId`、`spawnX`、`spawnY`。
  - `controller`: `feelProfileId`（文字列）、`facing`、`lastGroundedTick`、`jumpedSinceGrounded`（真偽値）、`jumpPressedTick`、`jumpStartTick`、`jumpCut`（真偽値）、`dropThroughUntilTick`、`landingLagUntilTick`、`leftPressedTick`、`rightPressedTick`。「まだ起きていない」tick は `NEVER`（`-0x7fffffff`）。
  - `animation`: 操作中キャラクターのスプライトのアニメーション。`name`（文字列）、`frame`、`ticks`。

## 結果

- 得られるもの: Node とブラウザ間での tick 毎 hash 一致、原作風の速度表の直接記述、golden と determinism テストの単純化。
- 失うもの: `Math` を使った曲線的な加速などは、整数テーブルか区分線形で表現する必要がある。
- 描画層は `toPxFloor` で px に変換して `RenderSnapshot` を作る。補間は描画層が浮動小数点で行ってよい（決定論の対象外）。
- `World` の JSON 化は整数のみになり、golden の差分が読みやすい。

## 改訂履歴

| 日付 | 内容 |
| --- | --- |
| 2026-11-23（M3-2b） | `controller` の `attackUntilTick` の後に `climbing`（真偽値）を追加した（ADR-0019） |
| 2026-11-23（M3-2c） | `controller` の `climbing` の後に `attackPressedTick`（int32）を追加した（ADR-0017 の改訂） |
| 2026-11-28（M3-6b） | `zonesInside` の後に `visited`（部屋の id の順に id、行ったマスの個数と番号。ADR-0020 の改訂） |
| 2026-11-25（M3-3） | `flags` の後に `inventory`（id の順に id と個数）と、いる部屋のゾーンの中にいるかどうかの列を追加した（ADR-0021） |
| 2026-11-23（M3-2） | `roomId` の後に `camera`（`x`、`y`、`screenX`、`screenY`、画面切替の演出の `fromX`、`fromY`、`toX`、`toY`、`tick`、`ticks`。すべて int32）を追加した（ADR-0009 の改訂履歴） |
| 2026-11-23（M3-1） | `party` の最後（`hazardTicks` の後）に、部屋に入った spawn の id（`spawnId`、文字列）を追加した。`animation` の後に `transition`（部屋の移動の段階 `phase`（文字列）、段階内の tick、消える段階と明るくなる段階の長さ、行き先の部屋と spawn、出口の種類、効果（文字列））と、入れない出口の番号の列（件数と各値）を追加した（ADR-0018） |
| 2026-11-21（M2-5 後半） | `controller` の `rightPressedTick` の後に `attackUntilTick` を追加した（ADR-0017） |
| 2026-11-21（M2-5） | `party` の `spawnY` の後に、`hp`（件数と各値）、`hazardId`（文字列）、`hazardTicks` を追加した（ADR-0016） |
| 2026-11-17（M1-5） | 走査順に `animation`（操作中キャラクターのスプライトのアニメーション。名前、コマ番号、コマ内の tick）を `controller` の直後に追加した。アニメーションのコマ送りは core が tick 単位で行う（ADR-0001） |
| 2026-11-14（M1-3） | 走査順に `controller`（操作中キャラクターの状態機械の記憶）を `party` の直後に追加した。各フィールドの順序を上に明記した |
| 2026-11-14 | M1-2 の実装で次を決めた。<br>・`Fx` は `number` の型エイリアスにする（下記）<br>・xorshift32 のシフト量とゼロシードの扱い、hash に投入するバイト列とレーンの offset basis を明記した<br>・値域 assert は `FxRangeError` を投げる。テストでは `packages/core/vitest.config.ts` の setup で常に有効にする<br>・core のソースに禁止 API（`Math.random`、`Date`、`performance`、超越関数、`**`、DOM のグローバル）が無いことを、テスト（`determinism-guard.test.ts`）で検査する |

## `Fx` の型（2026-11-14 に決定）

`number` の型エイリアス（`type Fx = number`）にする。branded type は採らない。

- ホットなコンポーネントは `Int32Array` の SoA（ADR-0005）で持つ。配列の要素は `number` として読み書きされ、ブランドは配列の境界で失われるため、取り違えを防ぐ効果が小さい。
- 取り違えは、px を受け取る関数名（`fromPx`、`toPxFloor`）と、引数名の `Px` 接尾辞（`xPx`）で区別する。衝突の Property テスト（鏡像、貫通しない）が単位の誤りを検出する。

## 要確認

- なし（`Fx` の型は 2026-11-14 に決定）。
