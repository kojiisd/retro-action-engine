# ロードマップ

- 版: 設計初版
- 更新日: 2026-10-04
- 進め方: 1 サブステップ = 1 PR。受け入れ条件はすべてテストまたは CI で確認できる形で書く。受け入れ条件を満たさない PR はマージしない。

## 進め方の規約

- 各 PR は `docs/roadmap.md` のサブステップ名をタイトルに含める（例 `feat(core): M1-2 Fx / World / tile collision`）。
- PR を出す前に `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm depcruise` を通す。
- 設計と異なる実装が必要になったら、先に ADR を追加または更新する。
- M1-1 以降、すべての PR にプレビュー URL が付く。実機確認は受け入れ条件に含めない（手動）が、PR 本文に確認した端末を書く。

## M0: リポジトリ骨格（1 PR）

| 項目 | 内容 |
| --- | --- |
| 内容 | pnpm workspaces、`.nvmrc`（22）、TypeScript 6.0.x + `tsconfig.base.json` + project references、Biome 2、Vitest 5（root の `projects`）、dependency-cruiser、`ci.yml`、6 パッケージの骨格（`core` / `pack` / `input` / `renderer-phaser` / `apps/player` / `packs/sample` に空の `index.ts` とダミーテスト 1 本ずつ）、`infra` の空ディレクトリと README |
| 受け入れ条件 | CI で `lint` / `typecheck` / `test` / `depcruise` / `build` が通る。`core` から `phaser` または DOM 型を import する変更を入れると `depcruise` または `tsc` が失敗する（PR 内で一度わざと失敗させて確認し、戻す）。`core` の tsconfig に `lib: ["ES2023"]` がある |

## M1: 1 画面の縦切り

### M1-1: インフラとプレビュー配備（1 PR）

| 項目 | 内容 |
| --- | --- |
| 内容 | `infra/`（CDK TypeScript）。証明書スタック（us-east-1、ACM + DNS 検証）と、メインスタック（us-west-2）を作る。メインスタックの中身は次のとおり。<br>・非公開 S3<br>・CloudFront（OAC、`arcade.kojiisd.jp`、ディレクトリ index 補完の Function、セキュリティヘッダー、`pr-*` に `X-Robots-Tag: noindex`）<br>・既存ホストゾーンへの A / AAAA Alias<br>・GitHub OIDC プロバイダ（作成または参照）<br>・`deploy-production` と `deploy-preview` の 2 ロール<br>・出力値<br>このほか `.github/workflows/preview.yml`（拒否確認ステップを含む）、`deploy.yml`、`ci.yml` への `cdk synth` 追加、`apps/player` のプレースホルダーページ（ビルド情報と PR 番号を表示） |
| 所有者の作業 | [infra/README.md](../infra/README.md) の手順書に従う。<br>1. `config/deploy.json` を作る。<br>2. us-east-1 と us-west-2 で `cdk bootstrap` する。<br>3. 証明書スタックを deploy し、ARN を転記する。<br>4. メインスタックを deploy する。<br>5. 出力値を repository variables（`AWS_REGION`、`AWS_ROLE_ARN_PRODUCTION`、`AWS_ROLE_ARN_PREVIEW`、`S3_BUCKET`、`CF_DISTRIBUTION_ID`、`SITE_DOMAIN`）に登録する。<br>6. Environment `production` のデプロイブランチが `main` のみであることを確認する。<br>7. `main` のブランチ保護を設定する。 |
| 受け入れ条件 | 自動（CI）: CDK テスト（本番ロールの trust が `environment:production`、プレビューロールの trust が `pull_request`、プレビューロールの S3 書き込みが `pr-*` に限定、両ビヘイビアのセキュリティヘッダー、`pr-*` のみ noindex、証明書スタックが us-east-1 でメインスタックが設定のリージョン、メインに us-east-1 を指定すると検証エラー）と、認証情報なしの `cdk synth` が通る。<br>手動（所有者、手順書の 9）:<br>・PR にプレビュー URL がコメントされ、`https://arcade.kojiisd.jp/pr-<n>/` が HTTPS で見える。<br>・プレビューの応答に `X-Robots-Tag: noindex` とセキュリティヘッダーが付く。<br>・Preview ワークフローの拒否確認ステップが AccessDenied を確認する。<br>・PR を close すると `pr-<n>/` が消え、reopen で復活する。<br>・`main` へのマージで `/` に配備され、`pr-*` は消えない。<br>・fork からの PR ではワークフローがスキップされる。 |

### M1-2: Fx / World / タイル衝突（1 PR）

| 項目 | 内容 |
| --- | --- |
| 内容 | `core`: `fx`（値域チェック付き）、xorshift32、`World` と `EntityStore`（SoA + tombstone）、`hash`、`TileClass` と `collision`（full / oneway、X→Y 軸分離、サブステップ、`CollisionContext`）、インライン fixture 部屋ビルダー |
| 受け入れ条件 | Unit: `fx.mul/div` の値域 assert、trunc と floor の規則（負値を含む）、`nextInt` の範囲。Property（fast-check）: ランダムな部屋とランダムな速度列で AABB が solid と重ならない、1 tick で複数タイル分動いても貫通しない、X 速度を反転した鏡像の部屋で軌道が鏡像になる、oneway は上からのみ衝突する。`hash` が同じ `World` で同じ値、1 フィールド違いで異なる値を返す |

### M1-3: キャラクター制御、2 人切替、能力タグ通行（1 PR）

| 項目 | 内容 |
| --- | --- |
| 内容 | `core`: `FeelProfile` の読み込みと `feelOverrides` の合成、`inputIntent`、`controller`（grounded / airborne、ジャンプ、可変ジャンプ、コヨーテ、先行入力、SOCD、すり抜け降下）、`party`（switch anywhere、cooldown、placement）、有効タグの計算、scenario DSL（`script().hold().tap()`） |
| 受け入れ条件 | Feel scenario（retro と modern、320×180 と 256×192 の両方）: 平地で `runSpeed` に達する、ジャンプの最高到達高さが導出式 ±1 px、崖から `coyoteTicks` 以内のジャンプは成功し `coyoteTicks + 1` では失敗、着地 `jumpBufferTicks` 前の押下で着地 tick にジャンプ、`jumpBufferTicks + 1` 前では跳ばない、壁に向かって走り続けても貫通しない、`requiresAnyTag` のタイルをタグ無しキャラは通れずタグ有りキャラは通れる、切替直後の位置が `placement` に従い cooldown 中の再切替は無視される、1 人構成では `UiState.canSwitch === false`。Property: 入力列を左右反転すると軌道が鏡像 |

### M1-4: InputBuffer、エッジ規則、リプレイ、Determinism（1 PR）

| 項目 | 内容 |
| --- | --- |
| 内容 | `core`: `loop.advance`、InputBuffer の純粋部分（キュー消費、エッジ規則、再同期）、`replay`（Recorder / Player / RLE / checkpoints）、`runReplayHeadless`。`input`: `InputBuffer` の DOM 側（物理状態の取得と再同期の配線） |
| 受け入れ条件 | Unit: input-and-feel.md 5.1 の例 1〜3 がそのまま通る、再同期トリガ (a)〜(d) それぞれで held が 1 tick 後に物理状態と一致する、`advance` の clamp と `dropped`。Property: ランダムな遷移列に対し「各遷移はちょうど 1 回消費される」「同一 tick に同一 action の pressed と released が立たない」「held は消費した遷移の累積と一致する」。Determinism: 同一リプレイを (a) 2 回実行して tick 毎 hash が一致、(b) 60Hz / 120Hz / 144Hz / スパイク入りのフレーム時間列でドライバ経由で実行して tick 毎 hash が一致 |

### M1-5: Phaser 描画、サンプルパック、キーボードとゲームパッド、Playwright smoke（1 PR）

| 項目 | 内容 |
| --- | --- |
| 内容 | `pack`: 最小スキーマ（manifest、characters、rules、feel、input、camera）と Tiled importer（`main` レイヤ、`spawn`、タイルクラス）。`packs/sample`: `hub` の 1 画面相当（320×160 プレイ領域）、2 キャラ、タグ付きタイル。`renderer-phaser`: Game 設定、Scene、ループドライバ、補間描画、`make.tilemap({ data })` によるタイル描画、HUD 帯。`input`: `KeyboardDevice`、`GamepadDevice`（標準マッピング）、ActionMap。`apps/player`: 配線、`window.__engine`、Playwright 設定 |
| 受け入れ条件 | Playwright（Chromium）: 起動してサンプルパックが読み込まれる、console error がない、`window.__engine.runReplay()` の hash が Node の `runReplayHeadless` と一致（Determinism (c)）。Golden: サンプル部屋 × retro / modern の代表リプレイ 2 本の終端 hash。`GamepadDevice` のフェイクによる Unit（標準マッピングの変換、デッドゾーンのヒステリシス、切断時の解放）。プレビュー URL で PC ブラウザ（キーボード）と Android または iPhone + Bluetooth ゲームパッドで移動・ジャンプ・切替ができる（手動、PR 本文に記録） |

M1 完了時の状態: 1 画面で、2 人パーティの切替、移動、ジャンプ、タイル衝突、能力タグによる通行判定が動き、リプレイテストで検証できる。

## M2: 入力の完成と操作感の切替

| サブステップ | 内容 | 受け入れ条件 |
| --- | --- | --- |
| M2-1 | `TouchPadDevice` と既定レイアウト、表示条件、セーフエリア | Pointer Events のフェイクで D-pad の 8 方向とヒステリシス、ボタンのスライド、マルチタッチを Unit。Playwright でタッチエミュレーション時にパッドが表示される |
| M2-2 | キーコンフィグ UI、非標準ゲームパッドの割当、`Settings` の保存（IndexedDB + フォールバック） | Settings の往復テスト、割当 UI の e2e（キー割当 → 反映 → 既定に戻す） |
| M2-3 | 操作感プロファイル切替 UI、`interpolation` の on/off、デバッグ表示（AABB、遅延オーバーレイ）、`desynchronized` の実測 | プロファイル切替後の Feel scenario が両プロファイルで通る。Determinism (b) を補間 on/off の両方で実行 |
| M2-4 | 仮想パッドのレイアウト編集 | レイアウト保存の往復テスト |

## M3: ワールド

| サブステップ | 内容 | 受け入れ条件 |
| --- | --- | --- |
| M3-1 | 複数部屋、`exits`（edge / door / warp）、部屋遷移、`transitionLockTicks` | 部屋遷移を含むリプレイの Determinism (a)(b)(c)。遷移中は入力が無視される scenario |
| M3-2 | カメラ 2 モード（screenFlip / scroll）、活性化判定 | カメラ scenario を 2 モード × 2 解像度。端数スクリーンのクランプ |
| M3-3 | フラグ、イベント（トリガ / Condition / Action）、アイテムと `grants`、ゲートギミック | 「タグ無しで通れない → アイテム取得で通れる」「スイッチでフラグ → 扉が開く」の scenario。`gating.subject` の 2 値 |
| M3-4 | 敵の宣言的振る舞い（全 Primitive / Condition）、hit / hurt、ダメージ、無敵、ノックバック、ドロップ | 各 Primitive の Unit、`walker` の scenario、被弾からの復帰 |
| M3-5 | HP と所持品のスコープ、`onDeath` / `onAllDown`、セーブポイント、セーブ / ロード（3 + auto）、オートセーブ | スコープ 2 × 2 の組合せ scenario。セーブ往復（保存 → 読込 → 同じリプレイで同じ hash）。`saveCompat` 外の拒否 |

## M4: パック基盤と配布

| サブステップ | 内容 | 受け入れ条件 |
| --- | --- | --- |
| M4-1 | zod スキーマの完成、`z.toJSONSchema` で `schemas/` 生成、参照整合性検査、`pack-cli` の分離（`validate` / `schema`） | サンプルパックが `validate` を通る。壊したサンプルが期待どおりのパスでエラーになる Unit。生成した JSON Schema で VS Code 補完が効く（手動） |
| M4-2 | 外部パック読み込み（`url` / `localDirectory` / `cached`）、確認ダイアログ、IndexedDB キャッシュ | Playwright で別オリジンのサンプルパックを `?pack=` から読み込める。`..` と http を拒否する Unit |
| M4-3 | 音（SFX / BGM、iOS 解錠、ループ点）、`audio.json` | 解錠前の BGM 要求がキューされ `UNLOCKED` 後に再生される Unit（Sound のフェイク） |
| M4-4 | PWA（vite-plugin-pwa、precache、更新プロンプト）、`base` 配下のスコープ | Playwright でプレビュー URL 配下に SW が登録され、オフラインで再読み込みできる |
| M4-6 | Content-Security-Policy の検討と導入（Phaser の WebGL とシェーダ、Service Worker、外部パックの URL 読み込みとの兼ね合い）。CloudFront の ResponseHeadersPolicy に追加する | CSP を付けた状態でプレビューの Playwright smoke（パック読込、SW 登録、外部パック読込）が通る。CDK テストで両ビヘイビアの CSP を検証 |
| M4-5 | 実機検証 | チェックリスト（音の解錠、サイレントスイッチ、音声フォーマット、向き、セーフエリア、フルスクリーン）を iPhone / Android / PC で実施し結果を docs に記録。音声フォーマットを確定して pack-spec を更新 |

## M5: 拡張

| サブステップ | 内容 | 受け入れ条件 |
| --- | --- | --- |
| M5-1 | 坂（`heights`）、`slopeSnapPx` | 坂の昇降 scenario、坂上での鏡像 Property |
| M5-2 | 梯子、`climb` 状態 | 梯子の昇降と上端の oneway scenario |
| M5-3 | 移動床（carrier / rider）、`movingPlatform` | 乗ったまま運ばれる scenario、床から落ちる scenario |
| M5-4 | ボス（`bossDoor`、複数フェーズの BehaviorSpec）、`cave-boss` 部屋 | ボス撃破 → フラグ → 扉のリプレイ |
| M5-5 | パック同梱コードの再検討（ADR-0005 の Deferred を解除するか判断） | ADR の更新 |
| M5-6 | Capacitor スパイク（`SaveStorage` の差し替え、ビルド確認） | Android ビルドが起動する（手動） |

## 後続で判断する事項

| 事項 | 判断時期 |
| --- | --- |
| 音声フォーマット、iOS サイレントスイッチ | M4-5 |
| Content-Security-Policy | M4-6 |
| 外部パックのコード実行 | M5-5 |
| TypeScript 7 への移行 | 周辺ツール対応後 |
| `desynchronized: true` | M2-3 |
| カスタムドメイン | 任意 |

## リスクと緩和

| リスク | 緩和 |
| --- | --- |
| Phaser 4 の API が記憶と異なる | 実装前に `node_modules/phaser/types/phaser.d.ts` と `skills/` で確認する（CLAUDE.md） |
| 固定小数点の値域超過 | テストで `fx.setChecks(true)` を常時有効化。Property テストで大きな値域を含める |
| iOS 固有の挙動 | M4-5 の実機チェックリスト。プレビュー配備で早期から実機確認 |
| 操作感調整でテストが壊れる | 閾値をプロファイルから導出。golden は 2〜3 本に限定 |
| プレビューの権限事故 | ロール 2 本と `pr-*` 限定の権限。CDK テストで静的に、Preview ワークフローの拒否確認で毎 PR 動的に検証 |
