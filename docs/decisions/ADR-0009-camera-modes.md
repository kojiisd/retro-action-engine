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
