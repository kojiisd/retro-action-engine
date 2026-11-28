# CLAUDE.md

retro-action-engine で作業するセッションが守るルール。設計の根拠は `docs/` にある。本ファイルと docs が食い違う場合は、まず docs を直してから作業する。

## プロジェクト概要

- 2D サイドビュー探索型アクションのための「エンジン + ゲームパック」型プラットフォーム。
- TypeScript / Vite / Phaser 4 / Vitest。pnpm workspaces（Turborepo なし）。Node 22 LTS、TypeScript 6.0.x、Biome。
- コアは描画非依存の純 TypeScript。Phaser は描画アダプタに留める。
- 必読: `docs/architecture.md`、`docs/decisions/README.md`、作業対象に関係する ADR、`docs/roadmap.md` の該当サブステップ。

## 言語

- ドキュメント、ADR、コミットメッセージ、PR 本文は日本語。
- コードの識別子、コメント、ログメッセージ、テスト名は英語。

## 確認が必要な事項（進め方のポリシー）

事故を起こさないことを最優先にする。次の内容は Claude が独断で決めない。選択肢と推奨を示して所有者の確認を取るか、所有者に作業を依頼する。迷ったら確認する側に倒す。

- **セキュリティに関わる内容**: IAM と信頼ポリシー、公開範囲（バケット、配信、リポジトリ）、レスポンスヘッダー、暗号化、認証、シークレットと認証情報、CI の権限、依存パッケージの権限やスクリプト実行。
- **公開情報に関わる内容**: 公開 URL とパス、公開ページの文言と画像、DNS、PR や Issue やコミットに書く外部向けの情報、ライセンス表記。
- **決定済みの内容から外れる変更**: 上記に関わる設定値を、ADR や合意済みの値から変える場合。
- **取り消しにくい操作**: AWS への適用、公開、削除、履歴の書き換えなど。AWS への適用は所有者が手元で行う。

確認を取った内容は、該当する ADR か PR 本文に記録する。

## 層と依存方向（違反は CI の dependency-cruiser で失敗する）

```
pack → core
input → core
renderer-phaser → core, pack, phaser
apps/player → core, pack, input, renderer-phaser（packs/sample は静的コピーと fixture）
solver → core（解析ツール。どのパッケージからも import されない）
infra → aws-cdk-lib のみ（エンジンの全パッケージから独立）
apps/gallery → scripts/site（ビルド設定のみ。エンジンには依存しない）
scripts/site → なし（アプリはパッケージ名で呼ぶだけで import しない）
scripts/font → なし（メニューのフォント画像を書き出す道具。どこからも import されない）
```

| パッケージ | してはいけないこと |
| --- | --- |
| `core` | DOM、`phaser`、`pack`、`input` を import する。外部ライブラリを増やす（ADR で承認されたもの以外） |
| `pack` | DOM API を直接呼ぶ（I/O は注入する）。`input`、`renderer-phaser` を import する |
| `input` | `pack`、`renderer-phaser` を import する |
| `renderer-phaser` | `input` を import する。ゲームロジックを書く |
| `apps/player` | ゲームロジックや衝突判定を書く（配線と UI のみ） |
| `solver` | 位置や速度を自分で計算する（物理は core の `step` だけ）。検証していない経路を「到達できる」と報告する。`core` 以外を import する |

`core` の tsconfig は `lib: ["ES2023"]` で DOM 型を含めない。`window`、`document`、`performance`、`fetch` が `core` に現れたら設計違反。

## エンジンに固有値を書かない

- キャラクター名、敵名、部屋名、アイテム名、能力タグの具体値、速度や重力などの調整値、解像度、タイルサイズをエンジンのコードに書かない。すべてパックデータ（`docs/pack-spec.md`）から読む。
- エンジンが持ってよい定数は、tick レート（60）、Fx のスケール（256）、ループの上限（250ms、5 tick）、InputBuffer の上限（256 件、`maxBacklogTicks` の既定 6）のような「仕組みの定数」のみ。追加する場合は ADR に書く。
- テスト用の fixture 値はテストファイル内に閉じる。
- 「1 人構成なら切替 UI を出さない」のように、パックの構成から導ける分岐はデータ駆動で書く。キャラクター ID による分岐は禁止（能力タグで判定する）。

## 既存作品の素材・名称を含めない

- 参考にした既存作品のタイトル、キャラクター名、地名、楽曲名、画像、音声、マップデータを、コード、docs、コミット、Issue、PR、テスト名のいずれにも書かない・入れない。
- リポジトリに置く素材はオリジナルのサンプルパック（CC0）のみ。例外は所有者が確認した自由なライセンスのフォント（M+ BITMAP FONTS、M+ FONT LICENSE。ADR-0020）で、CC0 とは書かず、`credits.json` に権利者とライセンスの全文を、`pack.json` の `licenses.assets` に例外を書く。私的な再現パックはリポジトリ外から読み込む設計であり、リポジトリに追加しない。
- 新しい素材を追加するときは `packs/sample/credits.json` に出所とライセンスを記録する。

## 決定論（`core` の禁止事項）

- 使用禁止: `Math.random`、`Date`、`performance`、`Math.sin/cos/tan/atan2/pow/exp/log/sqrt`、浮動小数点の累積（位置・速度・タイマーは必ず `Fx` または整数）。
- 乱数は `World.rng`（xorshift32）だけを使う。三角関数が必要なら整数テーブルをデータとしてコミットする。
- エンティティの走査は id 昇順。`sort` には id のタイブレークを付ける。`Map`/`Set` の反復順に依存しない。
- 丸めは 2 種類のみ: スケーリング（`fx.mul/div`）は 0 方向切り捨て、座標からタイル座標などへの変換は床関数（`>>`）。それ以外の丸めを書かない。
- `fx.mul` の前提（abs(a), abs(b) < 2^26）を破る計算を書かない。疑わしい箇所はテストで `fx.setChecks(true)` を有効にして実行する。
- システムの実行順（`docs/architecture.md` 4.3）を変える場合は ADR を追加する。

## テスト

- ロジックの変更には必ずテストを付ける。優先順位は (1) 結果アサーションの Feel scenario、(2) 実行同士の比較による Determinism テスト、(3) Property テスト、(4) Unit テスト。
- 保存済み hash の golden は 2〜3 本に限定する。golden の更新手順:
  1. `pnpm golden:update` で再生成する。
  2. PR 本文に「更新理由」と「対応する feel / rules / 物理 / システム順の変更」を書く。
  3. それらの変更を伴わない golden 更新は差し戻す。
- 操作感パラメータの調整では golden 以外のテストが壊れないこと。壊れる場合はテストが閾値を固定値で持っている疑いがある。閾値はプロファイル値から導出する。
- 「flake だから」という理由でテストをスキップ・無効化しない。決定論テストが不安定なら、それ自体が決定論の欠陥。
- 新しい Phaser API や CDK API を使う前に、下記の一次情報で存在と引数を確認する。

## 外部 API は記憶に頼らず型定義で確認する

- Phaser: `node_modules/phaser/types/phaser.d.ts`、`node_modules/phaser/skills/*/SKILL.md`（Phaser Studio 製のガイド）、`node_modules/phaser/changelog/v4/4.0/MIGRATION-GUIDE.md`。Phaser 3 の記憶で書かない（Pipeline、FX、BitmapMask、Geom.Point は v4 に無い）。
- AWS CDK: `node_modules/aws-cdk-lib` の `.d.ts`。
- Vite / Vitest / vite-plugin-pwa: 各パッケージの `README` と型定義。
- 確認した事実は PR 本文かコメントに「どのファイルで確認したか」を一言添える。

## 作業の進め方

- `docs/roadmap.md` のサブステップ単位で作業し、1 サブステップ = 1 PR。受け入れ条件のテストが通ってから PR を出す。
- PR を出す前にローカルで `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm depcruise`、`pnpm build` を通す（CI の `ci.yml` と同じ順序）。
- 設計と異なる実装が必要になったら、先に ADR を追加または更新してから実装する。
- 実装の型やフィールド名は `docs/architecture.md` と `docs/pack-spec.md` のスケッチに合わせる。変えるときは docs も同じ PR で直す。
- コミットは Conventional Commits（`feat(core): ...`、`fix(input): ...`、`docs: ...`、`chore(infra): ...`）。
- シークレットをコミットしない。AWS のロール ARN やバケット名は GitHub の repository variables に置く。`infra/` の `cdk deploy` はリポジトリ所有者が手元で実行し、CI からは実行しない。

## コマンドとツール構成

pnpm は `packageManager`（pnpm 12）で固定されている。Node は `.nvmrc`（22）に合わせる。

| コマンド | 内容 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 依存の導入（CI と同じ） |
| `pnpm lint` / `pnpm format` | Biome の検査 / 整形 |
| `pnpm typecheck` | `tsc -b`（各パッケージ。宣言のみを gitignore 済みの `dist/` に出力）に続けて、テストファイルを `tsconfig.test.json` で検査 |
| `pnpm test` | Vitest。root の `vitest.config.ts` の `projects` で全パッケージを実行 |
| `pnpm depcruise` | 依存方向の検査（`.dependency-cruiser.cjs`） |
| `pnpm build` | 各パッケージの `build` スクリプト（現状は `apps/player` の `vite build` のみ） |
| `pnpm site:build` | サイト全体を `dist-site/` に組み立てる（ルートに一覧、`play/<slug>/` に各ゲーム）。`SITE_BASE` で base を指定（既定 `/`、プレビューは `/pr-<n>/`） |
| `pnpm --filter @retro-action-engine/infra synth` | CDK の 2 スタックをプレースホルダー設定で synth（認証情報不要、CI と同じ） |
| `pnpm golden:update` | golden の再生成（`apps/player` の `vitest run src/golden --update`）。更新の手順は上の「テスト」 |
| `pnpm e2e` | Playwright（`apps/player`）。`VITE_E2E_HOOKS=1` で `dist-e2e/` にビルドし、`vite preview` で配信して Chromium で実行する。この環境では Chromium が入っているので、そのまま動く |

- ワークスペースのパッケージは `package.json` の `exports` で TypeScript のソース（`src/index.ts`）を直接公開する。パッケージ間の import にビルドは要らない。
- テストは各パッケージの `src/**/*.test.ts`。パッケージ用の tsconfig からは除外し、`tsconfig.test.json` がまとめて検査する。
- `tsc --noEmit -b` は参照先プロジェクトが emit を無効にできないため使えない。`tsc -b` を使う。
- infra の設定値（アカウント ID、ホストゾーン ID、証明書 ARN）は gitignore 済みの `infra/config/deploy.json` に置き、コミットしない。見本は `infra/config/deploy.example.json`（プレースホルダー）。`fromLookup` などの AWS ルックアップは使わない（synth とテストを認証情報なしで通すため）。
- `infra/bin/app.ts` は Node の型除去で直接実行する。infra の相対 import には `.ts` 拡張子を付け、enum などの型除去できない構文は使わない。
- サイトの構成（一覧に載せるゲーム、各ゲームの slug、表示名、説明、画像）はリポジトリ直下の `site.json` だけで管理する。slug を変えるときもこのファイルだけを書き換える。内容は公開情報なので、変更は所有者の確認を取る。
- 依存方向のルールを変えるときは `docs/architecture.md` の表と `.dependency-cruiser.cjs` の `LAYERS` を同じ PR で直す。パッケージを追加するときも同様。

## 現在の状態

- M1-1（infra とプレビュー配備）は完了。AWS に適用済みで、受け入れ確認も済んでいる（2026-11-14）。
  - 本番は `https://arcade.kojiisd.jp/`。トップは一覧（`apps/gallery`）、ゲームは `/play/2dsample/`（`apps/player`。サンプルパックのゲーム）。一覧のカード画像はプレイ画面のキャプチャ（`apps/gallery/public/images/2dsample.png`）。
  - PR を作ると `/pr-<番号>/` にプレビューが出て、PR に URL がコメントされる。close で消え、reopen で戻る。`main` へのマージで本番に配信される。
  - `main` はルールセットで保護されている（PR 必須、`ci` 必須、force push と削除を禁止）。
  - infra（`infra/`）を変えたときだけ、所有者が手元で `cdk deploy` する。CloudFront Function を変えたら、手順書 9-0 の `test-function` で確認する。
- M1-2（Fx / World / タイル衝突）は `core` に実装済み: `fx`（値域チェック付き）、xorshift32、`World` と `EntityStore`、`hash`、衝突グリッドと `movement`。core のテストの fixture は `packages/core/src/test-support.ts`（`buildRoom` など）。
- M1-3（キャラクター制御、2 人切替、能力タグ通行）は `core` に実装済み: `createWorld` と `step`、`inputIntent`、`controller`、`party`、シナリオ DSL `script()`。Feel scenario は `packages/core/src/sim/feel.test.ts`（retro と modern、320×180 と 256×192）。
- M1-4（InputBuffer、エッジ規則、リプレイ、Determinism）は実装済み: `core` の `loop`（`advance`、`LoopDriver`）、`EdgeBuffer`、`replay`（`Recorder`、`Player`、`runReplayHeadless`）。`input` の `InputBuffer`（物理状態の集約とフォーカス喪失の再同期）。
- A-1（到達可能性ソルバー、キャラクター 1 人ずつ）は `solver` に実装済み: `solveRoom`（足場の列挙、着地状態の幅優先探索、マクロ入力、証拠リプレイの再生による検証、上限と統計）。設計は ADR-0015。
- A-2 も実装済み: 切替とパーティ全体の探索、上昇量の上限（`measureRiseBound`）、証明つきの到達できない理由（`enclosed`、`tooHigh`）と推定の理由（`EstimatedBlocker`）、戻れるかどうか（`verified`、`provenNo`、`notFound`）、操作感の Property テスト。M3 への拡張設計は ADR-0015 にある。次の A-3（鍵と扉のグラフ、M3-3 の後）への引き継ぎは `docs/solver-handoff.md`。
  - 証明（`packages/solver/src/proofs.ts`）は、行ける範囲を広く見積もる側にだけ倒す。根拠を ADR に書けない規則では証明を出さない。推定を証明の型（`ProvenBlocker`、`provenNo`）に混ぜない。
  - solver のテストの fixture は `packages/solver/src/test-support.ts`（`roomRuntime` など）。core の fixture は `@retro-action-engine/core/testing` から使う（テスト専用）。
- M1-5（Phaser 描画、サンプルパック、キーボードとゲームパッド、Playwright smoke）は実装済み:
  - `pack`: zod のスキーマ、Tiled の取り込み、`loadPack(fetchLike, baseUrl)`（エラーは `file#/pointer: message` でまとめて報告、パック外のパスは拒否）。
  - `packs/sample`: データだけのディレクトリ（ワークスペースのパッケージではない）。部屋 `hub`、キャラクター `explorer`（タグなし）と `diver`（`move:swim`）。画像は所有者の確認済み（作者 `kojiisd`、CC0-1.0。生成に使ったプロンプトや下絵はリポジトリに置かない）。
  - `input`: `ActionMap`、`KeyboardDevice`、`GamepadDevice`、`InputBuffer.sourceChanged()`。
  - `renderer-phaser`: `startRenderer`。Phaser に触れない部分（補間、タイルレイヤ、HUD）は別モジュールでテストする。
  - `apps/player`: 配線（`boot.ts`）、`window.__engine`（開発時と `VITE_E2E_HOOKS=1` のビルドだけ）、golden 2 本（`src/golden/`）、e2e（`e2e/`）。
  - core の追加: スプライトのアニメーション（`World.animation`）、`RenderSnapshot`（`output` システム）、`GameSession`。
- M2-1（タッチ操作）は実装済み: 配置はパックのデータ（`input.json` の `touch.layouts`）、`input` の `TouchPadDevice`（幾何は `touch-geometry.ts`、DOM 表示は `mountTouchPad`）。横向きはゲーム画面に半透明で重ね、縦向きはゲーム画面の下に置く（`apps/player/index.html` の CSS）。表示は `pointer: coarse` でゲームパッド未接続のとき。決定の記録は ADR-0008 の改訂履歴（2026-11-18）。
- M2-2（キーコンフィグ、非標準ゲームパッド、設定の保存）は実装済み: 設定画面は `apps/player/src/settings-panel.ts`（HUD 帯の右端の歯車か `menu` で開き、開いている間はゲームを止める）、文言は `ui-strings.ts`（ブラウザの言語で日英。公開情報なので変更は所有者の確認を取る）、保存は `settings.ts` と `settings-idb.ts`（`idb-keyval` 6.3.0、`settings:global` と `settings:<packId>`）。`input` の `ActionMap` はユーザの上書きを重ね、`GamepadDevice` は非標準パッドを `Gamepad.id` ごとの割当で読む。決定の記録は ADR-0008 と ADR-0011 の改訂履歴（2026-11-19）。
- M2-3（操作感の切替、補間の上書き、デバッグ表示）は実装済み: 設定画面で操作感を選ぶと部屋の入口からやり直す（パックごとに保存）。補間は「操作感に合わせる / 滑らか / なし」。デバッグ表示（当たり判定の枠、入力から描画までの遅延などの数値、`desynchronized` の切替）は開発と PR のプレビューだけ（`apps/player/src/debug.ts` の `debugAllowed`）。`desynchronized` の採否は所有者が実機で測ってから決める（ADR-0008 の要確認）。決定の記録は ADR-0008、ADR-0011、ADR-0004 の改訂履歴（2026-11-19）。
- M2-4（仮想パッドの配置の編集）は実装済み: 設定画面の「配置を変える」から開き、パッドをドラッグして動かす。横向きと縦向きで別々に保存する（`settings:<packId>` の `touchLayouts`）。編集の純粋な計算は `input` の `touch-layout-edit.ts`、編集の帯は `apps/player/src/touch-layout-editor.ts`。決定の記録は ADR-0008 と ADR-0011 の改訂履歴（2026-11-20）。
- M2-5 の前半（HP、HP の表示、触れると HP が減るタイル、水中の動き）は実装済み: 設計は ADR-0016。core の `sim/hp.ts`（`interaction` での HP の減少、倒れたら生きているメンバーへ交代、全員倒れたら部屋の入口に全快で戻る）、媒体の操作感は `runtime/feel.ts` の `activeFeel`。パックは `rules.hp`、`rules.hazards`（能力タグで減る速さを変える）、`characters` の `hp`、`feel` の `media`、タイルの `hazard` と `medium`。HUD はアイコンの右に HP のゲージ（`renderer-phaser/src/hud.ts` の `hudLayout`。HP は細かく、サンプルパックは最大 120）。サンプルパックの水は全員が入れて HP が減る（`move:swim` は遅い）。
- ゲーム画面の大きさ（ADR-0010 の改訂履歴、2026-11-21）: PC は整数倍で 3 倍まで、タッチ画面は画面に合わせる（`apps/player/src/index.ts` の `scaling`、`renderer-phaser` の `scaling.ts`）。外部ライブラリは `vendor-*.js` に分けている（ADR-0014 の改訂履歴）。
- M2-5 の後半（剣を振る攻撃）は実装済み（ADR-0017）: `attack` アニメーションを持つキャラクターが振れる（長さはコマの合計、各コマの `hitbox`）。地上でも歩きながら振れる（操作感の `attackOnGround`、既定は `move`）。`World.controller.attackUntilTick`、`RenderSnapshot.hitboxes`（デバッグ表示）。攻撃のコマは 32×24（体は待機の絵のまま、腕と剣を描き足した。ADR-0017 の改訂履歴）。当たったときの処理（敵、ダメージ）は M3-4。解析ツールの次（A-3）は M3-3 の後。
- M3-1（部屋の出口と部屋の移動）は実装済み（ADR-0018）: 出口は Tiled の `exits` レイヤ（`edge`、`door` は地上で上、`warp`）。移動は `step` の中で完結し（暗転して止まる `World.transition`、入力は捨てる）、ドライバは何もしない。長さと効果は `camera.json` の `roomTransition`。着いたときに重なっていた出口は離れるまで入れない（`disarmedExits`）。描画は部屋が変わるとタイルを作り直し、`fadeAmount` で暗くする。操作感の切替は、いる部屋の入口（`GameSession.roomEntrance`）からやり直す。サンプルパックは M3-2 で `hub`（大きな 1 枚）→ `cellar`（右下の扉）→ `hub`（ワープ）になった（`edge` の例はテストだけ）。扉とワープの絵は所有者の Gemini の絵を見本に 16×32 に描き直したもの（ADR-0018 の改訂履歴）。ソルバーは解く部屋の出口を取り除いて探索する。所有者の判断で、マップは大きな 1 枚 + 建物などは別の部屋を基本にし、はしごは M3-2 の後（M3-2b）に前倒しする。
- M3-2（カメラ）は実装済み（ADR-0009 の改訂履歴）: `World.camera`（ビューの左上、整数 px）、`sim/camera.ts`（`scroll` はデッドゾーン、先読み、`lerpShift` で少し遅れて追い、`followY: 'grounded'` で着地してから縦を合わせる。`screenFlip` は `cut` と `scroll`、`pauseSimulation` で止める）、部屋境界のクランプ、部屋に入ったときのスナップ、活性化判定 `isActive`（M3-4 で使う）。core はプレイ領域の大きさだけ `display` から読む。描画はカメラを補間して `setScroll`。サンプルパックの `hub` は横 5 × 縦 3 画面（100×30 タイル）のスクロール（所有者の判断）。
- M3-2b（はしご）は実装済み（ADR-0019）: タイルのクラス `ladder`（最上段は core がすり抜け床として扱う）、操作感の `climbSpeed` と `climbJumpVelocity`（無ければつかめない）、`sim/ladder.ts`（`controller` の前の `climbStep`、移動の後の `climbAfterMove`、部屋に入ったときの `climbOnEnter`）、`World.controller.climbing`。上か下でつかみ、ジャンプで離れ、つかまったまま振れる。ソルバーははしごを使わず、はしごのある部屋では高さの証明を出さない。サンプルパックの `hub` は中段から上段の棚へ左右に 1 本ずつ。はしごのタイル（16×16）と `climb` のコマ（16×24）は、所有者の Gemini の絵を見本に描き直したもの（ADR-0019 の改訂履歴）。
- M3-2c（攻撃の連打）は実装済み（ADR-0017 の改訂）: 先行入力（操作感の `attackBufferTicks`、`World.controller.attackPressedTick`、`sim/attack.ts` の `attackStep` を `controller` とはしごで共有）。振りの終わりの `attackBufferTicks` 前からの押下で振り終わりに次を振る。押しっぱなしでは振り続けない。サンプルパックは振りを 2、5、3 tick（10 tick）に短くし、`attackBufferTicks: 5`（所有者の判断）。
- M3-6a（ゲーム内のメニュー）は実装済み（ADR-0020）: `menu` と HUD の歯車で開き（設定画面はメニューの「せってい」から）、開いている間は止まる。パーティ（選んで交代）、せってい、とじる。表示モデルと操作は `apps/player/src/menu.ts`（純粋な関数）、文言は `menu-strings.ts`（日英、公開情報）、描画は renderer-phaser の overlay（専用のカメラ）。交代は入力のコマンド（`InputFrame.command`、リプレイの version 2、core の `switchCheck`、`GameSession.queueCommand`）。閉じた時点で押していたボタンは離すまでゲームに渡さない（`HoldGate`）。パックは `strings.<lang>.json`（キャラクターの名前は 6 文字まで。サンプルはソラト / ミナモ）と `ui.json`（フォント画像と窓の色）。サンプルのフォントは M+ BITMAP FONTS の 12 px から使う文字だけを `scripts/font` で書き出したもの（M+ FONT LICENSE。BDF はリポジトリに置かない）。地図は M3-6b。
- M3-3（フラグ、所持品とアイテムの能力、仕掛け、イベント）は実装済み（ADR-0021）: `World.inventory`（共有、`stack` まで）、有効な能力タグ = 自身のタグ ∪ 持っているアイテムの `grants`（`sim/items.ts` の `tagsOf`）、`rules.gating.subject`（`active` / `anyInParty`）。仕掛けは `pickup`（触れると拾う）、`breakable`（剣で壊す）、`switch`（剣で叩く）、`gate`（フラグで開く）で、状態はフラグ（既定は `obj:<roomId>:<objectId>`）。閉じた仕掛けは `CollisionContext.blocked` で壁になる（`sim/blocking.ts`）。ゾーンのイベント（`sim/events.ts`）、出口の `requiresFlag`。`StepOutput.notices` で拾ったことを知らせ、app が画面の下に約 2 秒出す（`toast.ts`）。メニューの 2 行目に「もちもの」。パックは `items.json`、`gimmicks.json`、`entities` の `gimmick` と `zones` の `event`（使えない種類とパラメータは読み込み時に拒否）。サンプルパックは上段の棚のつるはし → 扉の手前の岩 → 地下の格子（スイッチ）→ ワープ。絵（`atlases/objects`）は所有者の Gemini の絵を見本に描き直したもの（ADR-0021 の改訂履歴）。ソルバーは閉じた仕掛けを壁として扱い、その部屋では証明を出さない。
- M3-6b（メニューの地図）は実装済み（ADR-0020 の改訂）: 部屋をプレイ領域の大きさの画面に区切り、体の中心があった画面を `World.visited` に覚える（`sim/map.ts`。`camera` の後と部屋に入ったとき。hash に入る）。`roomMap` / `GameSession.roomMap()` がメニューに渡す。メニューの 3 行目「ちず」: 行った画面を塗り、`revealsMap` のアイテムを持てば行っていない画面も薄く、いまいる画面と出口の印。色は `ui.json` の `colors.map`（任意）。サンプルパックの「ちず」は上段の右の棚（絵は仮、所有者の絵を待つ）。
- 素材（はしご、メニューなど）の進め方（所有者の要望、2026-11-23）: 所有者が Gemini で作り、Claude は指示文と下絵を用意して、届いた絵を決めた大きさに整える。