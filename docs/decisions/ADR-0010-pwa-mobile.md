# ADR-0010: PWA とモバイルの制約

- Status: Accepted
- Date: 2026-10-04
- 論点: G

## 背景

Web・PWA ファースト（PC ブラウザ、Android、iPhone）。iOS Safari には音声の解錠、フルスクリーン、画面向きのロック、ストレージ消去に固有の制約がある。将来の Capacitor 配布はオプション。

## 選択肢と決定

| 論点 | 選択肢 | 決定 |
| --- | --- | --- |
| 音声の解錠（iOS） | Phaser の解錠に任せる / 自前 | Phaser の `WebAudioSoundManager.unlock()` と `Sound.Events.UNLOCKED` を使い、最初の `pointerup / touchend / keydown` で解錠。解錠前の BGM 要求はキューに溜め、`UNLOCKED` 後に再生。`visibilitychange` で `AudioContext` を suspend / resume |
| フルスクリーン | Fullscreen API / PWA standalone | Android と PC は `scale.startFullscreen()`。iPhone は Fullscreen API が使えないため `FULLSCREEN_UNSUPPORTED` を受けて「ホーム画面に追加」を案内。manifest の `display` は `standalone` |
| 画面向き | `lockOrientation` / CSS オーバーレイ | `lockOrientation` は Android のフルスクリーン時のみ有効。iOS では不可のため、パックの `orientation` と異なる向きのときは「回転してください」オーバーレイを表示 |
| セーフエリア | 無視 / `env()` | `viewport-fit=cover` と `env(safe-area-inset-*)`。仮想パッドと DOM の UI はセーフエリア内に置く |
| スケーリング | FIT / 整数倍 | 整数倍（`ScaleManager.getMaxZoom()` + `setZoom()`）を優先し、入らなければ `Scale.FIT`。設定で切替可。`pixelArt: true`, `antialias: false` |
| オフライン | 手書き SW / vite-plugin-pwa | vite-plugin-pwa 2（Workbox、`registerType: 'prompt'`）。アプリシェルとサンプルパックを precache。外部パックは Cache API + IndexedDB に保存 |
| ストレージ消去 | 無視 / 対策 | iOS の未インストール Web アプリは 7 日間未使用でストレージが消去され得る。`navigator.storage.persist()` を要求し、インストールを促し、セーブのエクスポートを提供する（ADR-0011） |
| 性能 | Canvas / WebGL | WebGL 前提（v4 で Canvas は非推奨）。1 タイルセットのレイヤは `TilemapGPULayer`。DPR の上限を設定可 |
| ハプティクス | なし / `navigator.vibrate` | 任意。Android のみ有効。設定で切替 |

### プレビュー配備との関係

- `base` が `/pr-<n>/` のときも Service Worker のスコープがプレフィックス配下になることを smoke テストで確認する（M4）。

## 結果

- 得られるもの: 3 プラットフォームで動く PWA、オフライン動作、モバイル固有の制約への対処。
- 失うもの: iPhone でのブラウザ内フルスクリーンと向きロックは諦め、PWA インストールで代替する。
- フォローアップ: 実機チェックリスト（音の解錠、サイレントスイッチ、向き、セーフエリア、音声フォーマット）を M4 の受け入れ条件にする。

## 要確認

- iOS のサイレントスイッチと WebAudio の関係（HTML5 Audio 要素の併用で挙動が変わる報告がある）。M4 実機検証。
- 音声フォーマット（ogg + m4a 二重提供の仮置き）。M4 実機検証。

## 改訂履歴

| 日付 | 内容 |
| --- | --- |
| 2026-11-21 | スケーリングを実装した（それまでは常に `Scale.FIT` で、PC の大きなウィンドウでは画面いっぱいに広がっていた）。所有者の確認を取って次を決めた。<br>・**PC（`pointer: coarse` でない端末）**: 整数倍で、上限は 3 倍（320×180 のパックで 960×540）。ウィンドウが小さければ入る最大の整数倍（1 倍未満にはしない）。ウィンドウの大きさが変わるたびに付け直す（`Scale.NONE` と `setZoom`。Phaser の `MAX_ZOOM` は起動時に一度だけ決まるため使わない）<br>・**タッチ画面（`pointer: coarse`）**: これまでどおり `Scale.FIT`（小さな画面を使い切る。整数倍にならないことがある）<br>・設定の歯車は、ゲーム画面の右上（HUD 帯）に置く（画面がウィンドウより小さく中央に置かれても、ウィンドウの隅に離れない）<br>・上の表の「設定で切替可」は、まだ実装していない（必要になったら設定画面に足す。文言は所有者の確認を取る）。上限の 3 倍はアプリ（`apps/player`）の表示の方針で、エンジンとパックのデータには持たせない |
