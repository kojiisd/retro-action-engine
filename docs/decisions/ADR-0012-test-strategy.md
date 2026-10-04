# ADR-0012: テスト戦略

- Status: Accepted
- Date: 2026-10-04
- 論点: I

## 背景

操作感は頻繁に調整される。保存済みの終端 hash や World 状態 JSON を主軸にすると、パラメータを変えるたびに全 fixture が壊れて、テストが「変更の検知」にしか使えなくなる。決定論の検証と操作感の検証を分け、それぞれに適した手法を使う。

## 選択肢

| 目的 | 案 | 採用 |
| --- | --- | --- |
| 決定論 | 保存 hash と比較 / 実行同士を比較 | 実行同士の比較を主とする |
| 操作感 | 保存状態と比較 / 結果アサーション | 結果アサーション。閾値はプロファイル値から導出 |
| 意図しない変化の検知 | 多数の golden / 少数の golden | 少数（2〜3 本）の golden と更新手順 |

## 決定

### 層と役割

| 層 | 目的 | 内容 | ツール | 実行 |
| --- | --- | --- | --- | --- |
| Unit | 部品の正しさ | `Fx`（値域・丸め）、衝突プリミティブ、FSM、ゲーティング、Tiled importer、zod スキーマ、InputBuffer のエッジ規則と再同期 | Vitest（node） | 毎 PR |
| Property | 不変条件 | solid に埋まらない、サブステップで貫通しない、入力を鏡像にすると軌道も鏡像、速度上限、エッジは複製も消失もしない | fast-check | 毎 PR |
| Determinism | 決定論 | 同一リプレイを (a) 同プロセスで 2 回、(b) 60 / 120 / 144Hz とスパイクを含むフレーム時間列でドライバ経由、(c) Node とブラウザ（Playwright で `window.__engine.runReplay()`）で実行し、tick 毎の hash が一致する。保存済み hash とは比較しない | Vitest + Playwright | 毎 PR |
| Feel scenario | 操作感の仕様 | 小さな fixture 部屋 + 合成 `InputFrame` 列で結果を検証する。例: 「N tick 以内に足場 P に到達」「壁を貫通しない」「崖から `coyoteTicks` 以内のジャンプは成功し、+1 tick では失敗」「着地 `jumpBufferTicks` 前の押下で着地時にジャンプ」「最高到達高さがプロファイルから計算した範囲内」「タグが無いと通れず、あれば通れる」 | Vitest（node） | 毎 PR。プロファイル 2 種 × 解像度 2 種（320×180、256×192） |
| Golden | 意図しない変化の検知 | サンプル部屋 × プロファイル 2 種 × 代表リプレイ 1 本の終端 hash（計 2〜3 本） | Vitest | 毎 PR |
| Browser smoke | 統合 | 起動、パック読込、リプレイ hash が Node と一致、console error なし、M4 以降は manifest と SW | Playwright（Chromium） | 毎 PR |
| Visual | 描画回帰 | 少数のスクリーンショット（許容差あり） | Playwright | nightly / 手動 |
| 実機 | モバイル固有 | 音解錠、サイレントスイッチ、向き、セーフエリア、音声フォーマット | 手動チェックリスト | M4、リリース前 |

### Feel scenario の書き方

- 閾値は固定値で書かず、プロファイルから導出する。例: 最高到達高さの期待値は `jumpVelocity` と `gravity` から等差級数で計算し、±1 px の許容幅を持たせる。
- シナリオの入力は `InputFrame` の合成 DSL（`hold('right', 30)`, `tap('jump', at: 10)`）で書く。デバイス層は介在しない。
- fixture 部屋は数タイル規模のインラインデータで作る。サンプルパックには依存しない。

### Golden の運用

- 更新は `pnpm golden:update`。PR 本文に更新理由と、対応する feel / rules / 物理 / システム順の変更を書く。それらを伴わない golden 更新は差し戻す（CLAUDE.md に記載）。
- golden が変わり、かつ Feel scenario が通っている状態が「意図した調整」。golden が変わり Feel scenario も落ちる場合は仕様違反の疑い。

### ゲームパッド

- 実ブラウザでは e2e できないため、Gamepad API のフェイク（`navigator.getGamepads` の差し替え）で `GamepadDevice` を単体テストする。

### CI

- 毎 PR: Unit、Property、Determinism (a)(b)、Feel scenario、Golden、Browser smoke（Determinism (c) を含む）。
- nightly: Visual、Determinism (c) を Firefox と WebKit でも実行（Playwright）。

## 結果

- 得られるもの: パラメータ調整に強いテスト、環境間の決定論の直接検証、少数の golden による安全網。
- 失うもの: 保存 hash による網羅的な回帰検知。意図しない変化は Determinism と Feel scenario で捕まえる。
- フォローアップ: scenario DSL と fixture 部屋ビルダーを M1-3 で用意し、以降のテストはそれを使う。

## 要確認

- なし。
