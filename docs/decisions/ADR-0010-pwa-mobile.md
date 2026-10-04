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
