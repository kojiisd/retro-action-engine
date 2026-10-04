# ADR-0001: コアと描画の境界

- Status: Accepted
- Date: 2026-10-04
- 論点: A-2, A-4

## 背景

操作感を画面のない環境で検証するには、シミュレーションを Phaser と DOM から切り離す必要がある。Phaser 4 は描画エンジンが全面的に刷新されており（Pipeline → RenderNode、FX → Filters、Camera 行列の再設計。`node_modules/phaser/changelog/v4/4.0/MIGRATION-GUIDE.md`）、描画 API への依存を 1 箇所に閉じ込めることで将来の更新に耐える構造にしたい。

## 選択肢

| 案 | 概要 | 長所 | 短所 |
| --- | --- | --- | --- |
| 1 | Phaser の Scene にゲームロジックを書く（一般的な作法） | 最短で動く | Node でテストできない。Phaser の更新がロジックに波及する。決定論を保証しにくい |
| 2 | コアを純 TypeScript にし、Phaser は `RenderSnapshot` を描くだけのアダプタにする | ヘッドレスで全ロジックをテストできる。Phaser の破壊的変更の影響がアダプタに閉じる | 描画に必要な情報（スプライトキー、フレーム、向き）をコアが持つ必要がある |
| 3 | コアを Web Worker で動かし、メッセージで描画側へ渡す | メインスレッドが軽くなる | `postMessage` で入力と描画に 1 フレームの遅延が加わる。操作性最優先の要件に反する |

## 決定

案 2 を採用する。

- コアの入力は `InputFrame` と読み取り専用の `PackRuntime` のみ。出力は `StepOutput { render, audio, ui, transition }`。描画・音・DOM の情報をコアに流さない。
- `World` はプレーンなデータ（クラスメソッドを持たない、構造化複製と JSON 化が可能）。`step(world, input, runtime)` は in-place 更新。`snapshot / restore / hash` を提供する。
- 可変の `World` と不変の `PackRuntime` を分離する。`PackRuntime` は `pack` が構築し、`core` は型だけを所有する。
- `core` の tsconfig は `lib: ["ES2023"]` とし DOM 型を含めない。`phaser` を import しない。違反は dependency-cruiser と `tsc` の双方で検出する。
- アニメーションのフレーム進行はコアが行う（hit/hurt ボックスがフレームに紐づくため）。描画層は `RenderSprite.frame` をそのまま `setFrame` する。Phaser の Animation 機能は使わない。
- HUD とメニューの状態は `UiState`（コア）と app 層で持ち、操作は入力層の Action 語彙で行う。Phaser の Input プラグインには依存しない。
- 案 3 は採らないが、コアが純 TS であるため後から Worker 化は可能である。

## 結果

- 得られるもの: Node での完全なテスト、決定論の検証、Phaser バージョン更新時の影響範囲の限定。
- 失うもの: Phaser の便利機能（Arcade 物理、Animation、Input）を使わない分の実装量。
- フォローアップ: `RenderSnapshot` の内容は描画に必要な最小限に保ち、描画層が「解釈」を必要とする情報を増やさない。

## 要確認

- メニュー UI に Phaser のポインタ入力を使うかどうか。現方針は「Phaser の keyboard / gamepad を無効化し、UI も Action 語彙で駆動。設定画面は DOM」。M2 のキーコンフィグ UI 実装時に確定する。
