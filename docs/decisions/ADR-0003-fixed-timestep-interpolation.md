# ADR-0003: 固定タイムステップと補間描画

- Status: Accepted
- Date: 2026-10-04
- 論点: A-3

## 背景

操作性の要件として「固定タイムステップ（60Hz）、先行入力、コヨーテタイム、高リフレッシュレート環境でも挙動不変」が求められている。Phaser 4 の `Core.TimeStep`（`node_modules/phaser/src/core/TimeStep.js`）は requestAnimationFrame（以下 RAF）1 回につき `step(time, delta)` を 1 回呼ぶだけで、固定ステップの機構は持たない。既定で delta の平滑化（`fps.smoothStep: true`、直近 10 フレームの平均）が有効で、`fps.limit` と `fps.forceSetTimeOut` も設定できる。

## 選択肢

| 案 | 概要 | 長所 | 短所 |
| --- | --- | --- | --- |
| 1 | 可変 dt（Phaser の delta をそのまま物理に使う） | 実装が単純 | 決定論なし。リプレイ不能。120Hz で挙動が変わる |
| 2 | `scene.update` 内で自前のアキュムレータを回し、60Hz の tick を消化。描画は補間 | 決定論。表示レートに依存しない。補間で滑らか | tick と表示の間に最大 1 tick の表示遅延（補間時） |
| 3 | Phaser の `fps.limit: 60` でステップ全体を 60Hz に制限 | 設定だけで済む | 描画も 60Hz に落ちる。制限はタイマー精度に依存しジッタが出る。120Hz の利点を捨てる |
| 4 | `fps.forceSetTimeOut` で `setTimeout` ループ | RAF 非依存 | 描画と同期せずティアリングと遅延が増える |

## 決定

案 2 を採用する。

### アキュムレータ（`core/src/loop/`、純粋関数）

- 単位は `ms × tickRate`。1 tick = 1000 units。`frameMs` が整数のときは誤差ゼロで、小数でも tick 数の判定にしか使わないため決定論に影響しない。
- 手順:
  1. `frameMs = min(frameMs, maxFrameMs = 250)`。切り捨てた場合は `dropped = true`。
  2. `accUnits += frameMs * 60`。
  3. `ticks = floor(accUnits / 1000)`。`ticks > maxTicksPerFrame (= 5)` なら `ticks = 5` とし、余剰の `accUnits` を捨てて `dropped = true`。
  4. `accUnits -= ticks * 1000`。`alpha = accUnits / 1000`。
- `dropped = true` は InputBuffer の再同期トリガ（ADR-0008）。スローモーションにはせず時間を捨てる。リプレイは tick 列で記録されるため、どちらでも決定論は保たれるが、応答性のために捨てる。
- タブ非表示からの復帰は Phaser の PAUSE / RESUME を経て巨大な `frameMs` が来るので、上記 1 で自然に `dropped` になる。

### Phaser 側の設定

- `fps: { smoothStep: false }` にして平滑化を無効化し、`scene.update(time, delta)` の `delta` を `frameMs` として使う。
- `fps.limit` と `forceSetTimeOut` は使わない。

### 入力のサンプリング

- `InputFrame` は tick 直前に生成する（ADR-0008）。1 フレームで複数 tick を消化する場合も tick ごとに生成する。

### 補間描画

- コアは tick 毎に `RenderSnapshot` を出す。描画層は直前の tick の snapshot（prev）と最新（curr）を保持し、`pos = prev + (curr - prev) * alpha` で Sprite の位置とカメラの scroll を決める。
- `ticks == 0` のフレーム（120Hz 以上）は `alpha` だけが進み、同じ prev/curr の間を補間する。
- 操作感プロファイルの `interpolation: 'none'` では curr をそのまま使う（原作風）。`'linear'` が既定（現代的）。
- エンティティが同一 tick 内でワープした場合（部屋遷移、`warp` アクション、spawn 直後）は補間しない。`RenderSprite` に `teleported: true` を立てる。
- ピクセルスナップ: 補間後の座標を床関数で整数 px にし、Phaser 側も `roundPixels: true` と `camera.setRoundPixels(true)` にする（v4 では `roundPixels` の既定が false。MIGRATION-GUIDE 16 節）。

## 結果

- 得られるもの: 60/120/144Hz で同一の tick 列、補間による滑らかな表示、原作風では補間なしの硬い表示。
- 失うもの: 補間時は最大 1 tick（約 16.7ms）の表示遅延。原作風プロファイルではゼロ。
- フォローアップ: Determinism テスト (b)（フレーム時間列の違いで tick 毎 hash が一致）を M1-4 で導入する。

## 要確認

- `frameMs` を Phaser の `delta` から取るか `performance.now()` の差分で自前計測するか。`smoothStep: false` なら `delta` は raw 値になるはずで、M1-5 の実装時に `TimeStep.js` で確認する。
- 補間ではなく外挿（extrapolation）で表示遅延をゼロにする案は、壁衝突時のオーバーシュートが目立つため採らない。要望があれば M2 で再検討する。
