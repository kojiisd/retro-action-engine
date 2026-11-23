# ADR-0009: カメラの 2 モード（画面切替型とスクロール型）

- Status: Accepted
- Date: 2026-10-04
- 論点: 必須要件 4

## 背景

画面切替型（部屋をスクリーン単位で切り替える）とスクロール型の両方をパック設定で選べる必要がある。敵の活性化やスポーンはカメラ矩形に依存するため、カメラは決定論の対象に含めなければならない。

## 選択肢

| 論点 | 案 | 採用 |
| --- | --- | --- |
| カメラの所在 | 描画層（Phaser Camera の follow）/ コア | コア。活性化判定とリプレイの決定論のため |
| 画面切替のスクリーン単位 | タイル数 / ピクセル | ピクセル。解像度がタイルサイズの倍数でない場合に対応 |
| 端数スクリーン | 禁止 / 部屋境界にクランプ | クランプ |

## 決定

- `camera.json` の `mode: 'screenFlip' | 'scroll'`。カメラ位置は `World.camera`（整数 px）。描画層は Phaser の `Camera.setScroll` に補間済みの値を設定するだけで、`startFollow` と `setBounds` は使わない。
- プレイ領域 = `display` − `hudReserve`。カメラの viewport はプレイ領域に一致させる（`setViewport(0, top, width, height - top - bottom)`）。
- 敵とギミックの活性化はカメラ矩形 + `activationMarginPx` で判定する。

### screenFlip

```ts
interface ScreenFlipConfig {
  transition: 'cut' | 'scroll';
  transitionTicks: number;      // 'scroll' のときの演出長
  pauseSimulation: boolean;     // 演出中に tick を止めるか
  triggerInsetPx: number;       // 境界から何 px 入ったら切り替えるか（0 で境界）
}
```

- 部屋をプレイ領域サイズのスクリーンに分割し、操作中キャラが属するスクリーンにカメラをスナップする。部屋端の端数スクリーンは部屋境界にクランプする。
- 越境時の演出は描画層が行い、`pauseSimulation: true` なら `transitionLockTicks` の間コアは入力を無視して停止する（決定論のため tick 数で表す）。

### scroll

```ts
interface ScrollConfig {
  deadzone: { w: number; h: number };  // 中央のデッドゾーン（px）
  lookahead: { x: number; y: number }; // 進行方向への先読み（px）
  lerpShift: number;                   // 追従の強さ。差分 >> lerpShift を毎 tick 加える（整数、0 で即時）
  lockY: boolean;                      // 横スクロールのみ
  snapToTileRows: boolean;             // 縦の端数行を隠す等の用途
  followY?: 'always' | 'grounded';     // 縦の追い方（M3-2 で追加。既定 always）
}
```

- 部屋境界でクランプ。lerp は整数演算（差分の算術シフトを trunc で扱う。ADR-0002 の丸め規則に従う）。
- 描画層はカメラも prev/curr で補間する。

## 結果

- 得られるもの: 2 モードの切替、カメラ依存の挙動（活性化、スポーン）の決定論、解像度非依存。
- 失うもの: Phaser Camera の follow / deadzone 機能は使わない。
- テスト: scenario テストを両モード × 2 解像度（320×180 と 256×192）で実行する。

## 要確認

- なし。

## 改訂履歴

| 日付 | 内容 |
| --- | --- |
| 2026-11-23（M3-1） | 部屋を移るときの演出と停止を `camera.json` の `roomTransition: { effect: 'fade' \| 'cut', lockTicks }` で決める（ADR-0018）。移っている間（`lockTicks`）、コアは入力を無視して止まる。`scroll` の効果は M3-2 で決める。画面切替（`screenFlip`）の越境は部屋の中の話で、部屋の移動とは別に M3-2 で扱う |
| 2026-11-23（M3-2） | 実装に合わせて次を決めた（所有者の確認: サンプルパックはスクロール型で、横 5 × 縦 3 画面の大きな部屋にする。カメラは「少し遅れて追う」）。<br>・**状態**: `World.camera` は `x`、`y`（ビューの左上、部屋の px、整数）、画面切替の今の画面 `screenX`、`screenY`、画面切替のスクロール演出（`fromX`、`fromY`、`toX`、`toY`、`tick`、`ticks`）。hash は `roomId` の後（ADR-0002）<br>・**ビュー**: 大きさはプレイ領域（`display` − `hudReserve`）。`display` の無いパック（テスト用）はカメラが 0, 0 のまま<br>・**クランプ**: `0 ≤ x ≤ 部屋の幅 − ビューの幅`（縦も同じ）。部屋がビューより小さい向きは 0<br>・**追う点**: 体（当たり判定の箱）の中心の px（床関数）。scroll は横に `facing × lookahead.x`、縦に `lookahead.y` を足す<br>・**scroll**: 追う点がビューの中心から `deadzone` の半分を超えて離れたら、その分だけ目標を動かす。`followY: 'grounded'`（追加。既定は `'always'`）は、地上にいるときは縦の目標を追う点そのものにし（着地したら合わせる）、空中ではデッドゾーンを出たときだけ追う。`lockY` は縦を部屋に入ったときの位置に固定する。毎 tick `(目標 − 今)` を 2^`lerpShift` で割って 0 方向に切り捨てた量だけ動かす。切り捨てで 0 になっても差が残るときは 1 px 動かす（止まりきらずに残るずれを無くすため）。`snapToTileRows` は縦の位置をタイルの倍数に切り下げる<br>・**screenFlip**: 部屋をビューの大きさの画面に分け（端数の画面はクランプ）、追う点がいまの画面の境界を `triggerInsetPx` 以上越えたら隣の画面へ移る。`transition: 'cut'` はすぐ、`'scroll'` は `transitionTicks` かけて直線で動かす（整数の割り算は 0 方向に切り捨て）。`pauseSimulation: true` なら、その間は部屋の移動（ADR-0018）と同じく、シミュレーションを止めて入力を捨てる<br>・**部屋に入ったとき**（`createWorld` を含む）: カメラは目標に一度で合わせる（デッドゾーンも演出も無し）。描画は部屋が変わった tick のカメラを補間しない<br>・**活性化**: ビューの矩形を `activationMarginPx`（既定 0）広げた矩形と重なるものを活性とする判定を core に置く（使うのは M3-4 の敵とギミック）<br>・**描画**: `RenderSnapshot.camera` を prev と curr で補間して `Camera.setScroll` に渡す（補間 `none` では curr）。暗転の矩形はカメラに固定する（`setScrollFactor(0)`） |
