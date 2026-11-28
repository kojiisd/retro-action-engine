# アーキテクチャ

- 版: 設計初版（実装前）
- 更新日: 2026-10-04
- 関連: 判断の経緯は [decisions/](decisions/README.md)、パック仕様は [pack-spec.md](pack-spec.md)、入力と操作感は [input-and-feel.md](input-and-feel.md)、計画は [roadmap.md](roadmap.md)

## 1. 目的

2D サイドビュー探索型アクション（複数の主人公を切り替え、能力やアイテムで行ける範囲が広がり、拠点から複数のダンジョンを探索し、ボスを倒して進む）を、素材とデータを差し替えるだけで再現できる「エンジン + ゲームパック」型のプラットフォームを提供する。

- エンジン: 固有名詞と調整値を持たない汎用のシミュレーション、入力、描画。
- パック: マップ、タイル、スプライト、キャラクター、敵、アイテム、ルール、音、操作感をデータとして定義したもの。リポジトリにはオリジナル素材のサンプルパックのみを置く。私的なパックはリポジトリ外（URL またはローカル）から読み込む。

## 2. 設計原則

| # | 原則 | 根拠 |
| --- | --- | --- |
| 1 | コアは純 TypeScript で描画・DOM 非依存。Phaser は描画アダプタに留める | [ADR-0001](decisions/ADR-0001-core-render-boundary.md) |
| 2 | 座標は 8.8 固定小数点の整数、時間は 60Hz の tick。決定論を全環境で保証する | [ADR-0002](decisions/ADR-0002-fixed-point-determinism.md), [ADR-0003](decisions/ADR-0003-fixed-timestep-interpolation.md) |
| 3 | 入力は tick 単位の `InputFrame` に正規化し、記録と再生ができる | [ADR-0008](decisions/ADR-0008-input-architecture.md) |
| 4 | パッケージ間の依存は一方向の DAG。逆方向の import は CI で失敗させる | [ADR-0013](decisions/ADR-0013-monorepo-tooling.md) |
| 5 | エンジンに固有名詞・調整値を書かない。すべてパックから供給する | [ADR-0006](decisions/ADR-0006-pack-format-and-schema.md) |
| 6 | テストは「実行同士の比較」と「結果アサーション」を主軸にし、保存 hash の golden は少数に絞る | [ADR-0012](decisions/ADR-0012-test-strategy.md) |

## 3. パッケージ構成と依存方向

エンジンのパッケージは 6 つ。ほかに、エンジンから独立した `infra`、サイトのトップのゲーム一覧 `apps/gallery`、サイト全体を組み立てる `scripts/site` と、パックのメニューのフォント画像を書き出す `scripts/font`（M3-6a、ADR-0020。手で動かす道具で、どこからも import されない）がある（`scripts/site` は M1-1 で追加）。解析ツールの `solver`（A-1 で追加）は `core` だけに依存し、エンジンの実行時には含めない。リプレイ機能は `core` に含める。`pack-cli` は M4 で `pack` から分離する。

```mermaid
graph BT
  core["@retro-action-engine/core<br/>sim, fx, replay, hash, loop(pure)"]
  pack["@retro-action-engine/pack<br/>zod schema, loader, Tiled importer"]
  input["@retro-action-engine/input<br/>device, action map, input buffer"]
  renderer["@retro-action-engine/renderer-phaser<br/>Phaser 4 adapter"]
  player["apps/player<br/>PWA shell, integration tests"]
  sample["packs/sample<br/>data only (CC0)"]
  infra["infra<br/>AWS CDK (isolated)"]
  gallery["apps/gallery<br/>game list at the site root"]
  solver["@retro-action-engine/solver<br/>reachability analysis (not in the runtime)"]
  sitetools["scripts/site<br/>site.json, site build"]
  phaser[("phaser")]

  pack --> core
  input --> core
  renderer --> core
  renderer --> pack
  renderer --> phaser
  player --> core
  player --> pack
  player --> input
  player --> renderer
  player -. "static copy / test fixture" .-> sample
  gallery -- "build config only" --> sitetools
  solver --> core
```

| パッケージ | 依存してよいもの | 依存してはいけないもの | 責務 |
| --- | --- | --- | --- |
| `core` | なし（外部ライブラリも原則なし） | DOM、`phaser`、`pack`、`input` | シミュレーション全体。`Fx`、`World`、衝突、キャラ制御、パーティ、振る舞い、イベント、カメラ、リプレイ、hash、ループの純粋部分。tsconfig の `lib` は `["ES2023"]` で DOM 型を含めない |
| `pack` | `core`（型）、`zod` | DOM API への直接依存（I/O は `FetchLike` を注入） | パックファイルの検証、Tiled JSON の取り込み、`PackRuntime` の構築、外部パックの取得 |
| `input` | `core`（`InputFrame`、`ActionId`） | `pack`、`renderer-phaser` | キーボード、ゲームパッド、タッチの各デバイス、Action マップ、InputBuffer（エッジ規則、再同期） |
| `renderer-phaser` | `core`、`pack`（アセット記述型）、`phaser` | `input` | Phaser Scene、ループドライバ、補間描画、タイル描画、音の再生、HUD |
| `apps/player` | 上記すべて | なし | 配線、設定 UI、PWA、`window.__engine` テストフック、サンプルパックを使う統合テスト |
| `packs/sample` | なし（データのみ） | コードを置かない | サンプルパック。ワークスペースのパッケージではなく、JSON と画像だけのディレクトリ（M1-5）。`apps/player` のビルドで `dist/packs/sample/` にコピーされ（開発サーバでも同じ URL で配信）、`pack` と `apps/player` のテスト fixture になる。データ以外のファイルが無いことは `pack` のテストで検査する。dependency-cruiser の `LAYERS` には含めない |
| `solver` | `core` | `pack`、`input`、`renderer-phaser`、DOM。どのパッケージからも import されない | 到達可能性の解析（どの足場に行けるか、どこから戻れないか）。物理は core の `step` だけを使い、報告する経路は `runReplayHeadless` で検証する。[ADR-0015](decisions/ADR-0015-reachability-solver.md) |
| `apps/gallery` | `scripts/site`（`vite.config.ts` からのみ） | エンジンの全パッケージ | サイトのトップ（`/`）のゲーム一覧。`site.json` からカードを作る。[ADR-0014](decisions/ADR-0014-deploy-and-infra.md) |
| `scripts/site` | なし | エンジンと各アプリ（パッケージ名で呼ぶだけ） | `site.json` の検証と、サイト全体の組み立て（`pnpm site:build`。一覧をルートに、各ゲームを `play/<slug>/` に） |
| `scripts/font` | なし | すべて | BDF のフォントから、パックのメニューのフォント画像と `ui.json` の文字の一覧を書き出す（ADR-0020） |
| `infra` | `aws-cdk-lib`、`constructs` | エンジンの全パッケージ | 証明書スタック（us-east-1、ACM）とメインスタック（S3 + CloudFront、Route 53 の Alias、OIDC、IAM ロール 2 本）。[ADR-0014](decisions/ADR-0014-deploy-and-infra.md) |

`core` のテスト用 fixture（`packages/core/src/test-support.ts`）は `@retro-action-engine/core/testing` として公開し、ほかのパッケージのテストから再利用できる。テスト以外のファイルからの import は dependency-cruiser で禁止する。

`core` のテストはインラインの小さな fixture のみを使う。`packs/sample` を読むテストは `pack` と `apps/player` に置く。

## 4. 実行時のデータフロー

### 4.1 起動

```mermaid
flowchart LR
  src["PackSource<br/>builtin / url / localDirectory / cached"] --> load["pack.loadPack()"]
  load --> validate["zod で検証"]
  validate --> tiled["Tiled importer<br/>(.tmj → RoomData)"]
  tiled --> runtime["PackRuntime<br/>(読み取り専用)"]
  runtime --> assets["renderer.loadAssets()<br/>atlas / tileset / audio"]
  runtime --> world["sim.createWorld(runtime, start)"]
  world --> loop["ループ開始"]
  assets --> loop
```

### 4.2 1 フレーム（requestAnimationFrame 1 回）の処理

```mermaid
sequenceDiagram
  participant RAF as Phaser Scene.update(time, delta)<br/>(renderer-phaser)
  participant App as apps/player の frame 関数
  participant Pad as GamepadDevice (input)
  participant Ses as GameSession (core)
  participant Drv as LoopDriver / advance (core, pure)
  participant Buf as InputBuffer (input)
  participant Rec as replay.Recorder (core)
  participant Sim as sim.step (core)
  participant Rnd as Phaser 表示

  RAF->>App: frame(delta)
  App->>Pad: poll()（差分を InputBuffer へ）
  App->>Ses: frame(delta)
  Ses->>Drv: frame(delta)
  Drv-->>Ses: ticks (0..5), alpha, dropped
  alt dropped == true（リプレイ中は除く）
    Ses->>Buf: droppedTime()（再同期）
  end
  loop ticks 回
    Ses->>Buf: nextFrame()（リプレイ中は replay.Player）
    Buf-->>Ses: InputFrame
    Ses->>Rec: push(InputFrame)
    Ses->>Sim: step(world, InputFrame, runtime)
    Sim-->>Ses: StepOutput (render, ui)
  end
  Ses-->>App: FrameView (prev, curr, alpha, ui)
  App-->>RAF: FrameView
  RAF->>Rnd: 補間して Sprite に書く、HUD を更新
```

- tick を回すのは core の `GameSession`（M1-5）。`renderer-phaser` は `input` を import できないため、Scene の `update` は `apps/player` が渡す `frame` 関数を呼ぶだけで、返った `FrameView`（スナップショット 2 つと `alpha` と `ui`）を描く。描画側は `World` に触れない。
- `StepOutput` の `audio` は M3 で追加する。`transition`（部屋の移動の段階、M3-1）は描画の演出のための情報で、部屋の移動そのものは `step` の中で完結する（ADR-0018）。ドライバは何もしない。
- `ticks == 0` のフレーム（120Hz 以上の表示で起こる）は `alpha` だけが進み、前回と今回の `RenderSnapshot` の間を補間して描く。
- `dropped == true` はフレーム時間をクランプして時間を捨てたことを意味し、InputBuffer の再同期トリガになる（[input-and-feel.md](input-and-feel.md) のエッジ規則 7）。

### 4.3 1 tick 内のシステム実行順

実行順は決定論の一部であり、固定する。

| 順 | システム | 内容 |
| --- | --- | --- |
| 1 | `inputIntent` | `InputFrame` と操作感プロファイルから操作意図（移動方向、ジャンプ要求、攻撃要求、切替要求）を作る。先行入力はここで過去 N tick を参照する |
| 2 | `party` | 切替要求を `rules.party.switch` に従って処理する。cooldown、接地条件、配置 |
| 3 | `controller` | 操作中キャラクターの状態機械（grounded / airborne / climb / hitstun）と速度の更新 |
| 4 | `behavior` | 敵とギミックの宣言的状態機械（BehaviorSpec）を 1 ステップ進める |
| 5 | `movement` | 全エンティティの移動と衝突解決（X 軸 → Y 軸、サブステップ、能力タグによる通行判定） |
| 6 | `interaction` | hit/hurt の重なり、拾得、ゾーン進入。触れると HP が減るタイルと、HP が 0 になったときの交代と入口からのやり直し（M2-5、ADR-0016）。その後に出口接触（M3-1、ADR-0018）。HP の前に、仕掛けを拾う・壊す・押す（M3-3、ADR-0021） |
| 7 | `events` | トリガから Action 列を実行し、フラグ・所持品・パーティ・spawn を更新（M3-3 はゾーンの出入りとフラグ・所持品、ADR-0021） |
| 8 | `camera` | カメラモードに従って位置を更新（screenFlip / scroll）。その後に、体の中心がある画面を地図の「行った画面」に記録する（M3-6b、ADR-0020 の改訂） |
| 9 | `timers` | 無敵時間、アニメーションフレーム、cooldown の減算 |
| 10 | `output` | `RenderSnapshot`、`AudioCue[]`、`UiState`、`TransitionView` を生成 |

部屋の移動中（`World.transition` の段階が `out` か `in`、ADR-0018）は、1〜9 を行わずに段階の tick を進め、`output` だけを行う。消える段階が終わった tick に部屋を移る。画面切替のスクロール演出で `pauseSimulation` のときも同じく、カメラの演出だけを進める（M3-2、ADR-0009 の改訂履歴）。

## 5. コアの内部モジュール（`packages/core/src/`）

| モジュール | 内容 |
| --- | --- |
| `fx/` | 8.8 固定小数点の演算、値域チェック、PRNG（xorshift32）（M1-2） |
| `world/` | `World` の型、エンティティ表（`EntityStore`。SoA + tombstone、M1-2）、`snapshot/restore` |
| `hash/` | `World` の決定論的 hash（FNV-1a を 2 レーン、`[hi, lo]`、M1-2） |
| `collision/` | 衝突グリッド、AABB、軸分離スイープ、oneway、`CollisionContext`、`movement` システム（M1-2）。slope は M5 |
| `input/` | `InputFrame` と Action 語彙のビット（M1-3）、`EdgeBuffer`（InputBuffer の純粋部分。エッジ規則と再同期、M1-4） |
| `sim/` | `createWorld`、`step`（システムを 4.3 の固定順で実行）、`inputIntent`、`controller`（キャラクター状態機械、操作感プロファイルの適用）、`party`（有効タグの計算、切替）（M1-3）。HP と所持品のスコープは M3 |
| `behavior/` | BehaviorSpec の評価、Primitive と Condition の実装 |
| `events/` | トリガ、Condition、Action、フラグストア |
| `camera/` | screenFlip と scroll |
| `replay/` | `Recorder`（RLE）、`Player`、checkpoint、`runReplayHeadless`（M1-4）。Feel scenario 用の合成 DSL `script()`（M1-3） |
| `loop/` | アキュムレータの純粋部分（`advance`）と `LoopDriver`（フレームごとに tick を消化する純粋部分、M1-4）。DOM に触れない |
| `runtime/` | `PackRuntime` の型（`pack` が構築し、`core` が消費する）。M1-3 時点は `TileClass`、`FeelProfile`（Fx に変換済み）、`CharacterDef`、`RulesDef.party`、`RoomData`、`StartState` |

## 6. 境界 API の型スケッチ

実装ではなく契約の下書き。識別子は英語、フィールド名は pack-spec と一致させる。

```ts
// ---- core/fx ----
export type Fx = number; // int32。1 px = 256（8 fractional bits）
export const FX_SHIFT = 8;
export const FX_ONE = 1 << FX_SHIFT;

export interface FxOps {
  fromPx(px: number): Fx;        // px << 8。|px| < 2^23
  toPxFloor(v: Fx): number;      // v >> 8（床関数）
  mul(a: Fx, b: Fx): Fx;         // trunc((a * b) / 256)。|a|, |b| < 2^26
  div(a: Fx, b: Fx): Fx;         // trunc((a * 256) / b)。b != 0
  setChecks(enabled: boolean): void; // テスト時のみ値域 assert を有効化
}

// ---- core/input contract ----
export type ActionId =
  | 'left' | 'right' | 'up' | 'down'
  | 'jump' | 'attack' | 'switch' | 'item'
  | 'pause' | 'menu' | 'confirm' | 'cancel'
  | 'extra1' | 'extra2' | 'extra3' | 'extra4';

export interface InputFrame {
  held: number;     // ActionId のビットマスク（16 bit）
  pressed: number;  // この tick で down エッジを消費した action
  released: number; // この tick で up エッジを消費した action
  command?: number; // メニューなどからのコマンド（ADR-0020）
}

// ---- core/runtime（pack が構築、core が消費） ----
export interface PackRuntime {
  id: string;
  version: string;
  display: { width: number; height: number; hudReserve: { top: number; bottom: number } };
  tileSize: number;
  rooms: Record<string, RoomData>;
  characters: Record<string, CharacterDef>;
  enemies: Record<string, EnemyDef>;
  items: Record<string, ItemDef>;
  gimmicks: Record<string, GimmickDef>;
  rules: RulesDef;
  feel: Record<string, FeelProfile>;
  camera: CameraConfig;
  assets: AssetManifest; // renderer-phaser が読む。core は参照しない
}

export interface RoomData {
  id: string;
  widthTiles: number;
  heightTiles: number;
  collision: Uint16Array;       // tileClassId（row-major）
  tileClasses: TileClass[];
  renderLayers: RenderLayerData[]; // 描画専用。core は中身を解釈しない
  spawns: Record<string, { x: Fx; y: Fx }>;
  entities: EntitySpawn[];
  zones: ZoneDef[];
  exits: ExitDef[];
}

export interface TileClass {
  id: number;
  solid: 'none' | 'full' | 'oneway' | 'slope';
  heights?: number[];        // slope: 列ごとの高さ（px）。tileSize 要素
  ladder?: boolean;
  hazard?: string;           // 触れると HP が減る種類（rules.hazards のキー。ADR-0016）
  medium?: string;           // 媒体（feel の media のキー。水中の動きなど。ADR-0016）
  requiresAnyTag?: string[]; // いずれかの能力タグが無ければ solid 扱い
}

// ---- core/world ----
// M1-5 時点は tick, rng, roomId, party, controller, animation, flags, entities。残りは使うシステムと同じ PR で追加する（ADR-0002 の hash 順に挿入）。
// controller は操作中キャラクターの状態機械の記憶（接地 tick、ジャンプバッファ、SOCD の押下 tick など）。
export interface World {
  tick: number;
  rng: number;               // xorshift32 の状態
  roomId: string;
  camera: CameraState;       // ビューの左上（整数 px）と画面切替の状態（M3-2、ADR-0009）
  party: PartyState;         // members, activeIndex, cooldownTicks, perCharacter HP など
  controller: ControllerState;
  animation: AnimationState; // 操作中キャラクターのスプライトの name, frame, ticks（M1-5）
  inventory: InventoryState; // scope に応じて shared または characterId ごと
  flags: Record<string, number | boolean>;
  entities: EntityStore;     // id 昇順で走査できるコンポーネント表
  transition: TransitionState; // 部屋の移動の段階（M3-1、ADR-0018）
  disarmedExits: number[];     // 部屋に着いたときに重なっていて、一度離れるまで入れない出口の番号
}

// ---- core/sim ----
export interface StartState {
  roomId: string;
  spawnId: string;
  party?: string[];
  seed: number;
  feelProfile: string;
}

export interface Simulation {
  createWorld(runtime: PackRuntime, start: StartState): World;
  step(world: World, input: InputFrame, runtime: PackRuntime): StepOutput; // world を in-place 更新
  enterRoom(world: World, runtime: PackRuntime, roomId: string, spawnId: string, keepVelocity: boolean): void; // step が出口で呼ぶ（ADR-0018）
  snapshot(world: World): WorldSnapshot;
  restore(snapshot: WorldSnapshot): World;
  hash(world: World): WorldHash; // [hi, lo]
}

export type WorldHash = readonly [number, number];

// M1-5 時点の StepOutput は ui（activeCharacterId と canSwitch）と render。audio と transition は M3。
export interface StepOutput {
  render: RenderSnapshot;
  audio: AudioCue[];
  ui: UiState;
  transition: TransitionView | null; // 部屋の移動中だけ（M3-1）
}

export interface RenderSnapshot {
  tick: number;
  room: string;                     // 部屋 ID（M3-1。変わったら描画はタイルを作り直す）
  camera: { x: number; y: number }; // ビューの左上の px（M3-2。World.camera の値）
  sprites: RenderSprite[];          // id 昇順
}

export interface RenderSprite {
  id: number;
  atlas: string;
  frame: string;
  x: number;        // px（足元中央、床関数済み）
  y: number;        // px
  flipX: boolean;
  depth: number;
  visible: boolean;
  teleported: boolean; // この tick で移動せずに位置が変わった（補間しない。ADR-0003）
}

export interface AudioCue {
  kind: 'sfx' | 'bgm' | 'stopBgm';
  key: string;
}

export interface UiState {
  activeCharacterId: string;
  canSwitch: boolean;           // 1 人構成や mode: 'never' では false
  party: Array<{ id: string; hp: number; hpMax: number; alive: boolean }>;
  inventory: Array<{ itemId: string; count: number }>;
  message: string | null;       // showText の表示要求（キーは strings で解決）
}

// 部屋の移動（M3-1、ADR-0018）。移動は step の中で完結し、描画はこれで暗転を描くだけ。
export interface TransitionView {
  effect: 'cut' | 'fade';
  phase: 'out' | 'in';
  tick: number;  // その段階の何 tick 目か（1 から）
  ticks: number; // その段階の長さ
}

export interface TransitionState {
  phase: 'none' | 'out' | 'in';
  tick: number;
  outTicks: number;
  inTicks: number;
  toRoomId: string;
  spawnId: string;
  kind: '' | 'edge' | 'door' | 'warp';
  effect: '' | 'cut' | 'fade';
}

export interface ExitDef {
  kind: 'edge' | 'door' | 'warp';
  rect: { x: Fx; y: Fx; w: Fx; h: Fx };
  toRoomId: string;
  spawnId: string;
  effect: 'cut' | 'fade';        // パックで省略すると camera.json の roomTransition.effect
  requiresAnyTag?: string[];
  // requiresFlag は M3-3
}

// ---- core/loop（純粋） ----
export interface LoopConfig {
  tickRate: 60;          // tick/s
  maxFrameMs: 250;       // これを超えるフレーム時間は切り捨てる
  maxTicksPerFrame: 5;   // これを超える分の時間は捨てる
}

export interface LoopState {
  accUnits: number;      // ms * tickRate の単位。1 tick = 1000 units
}

export interface AdvanceResult {
  ticks: number;         // このフレームで消化する tick 数
  alpha: number;         // 0..1。補間係数
  dropped: boolean;      // 時間を捨てた（再同期トリガ）
}

export function advance(state: LoopState, frameMs: number, cfg: LoopConfig): AdvanceResult;
```

## 7. 描画アダプタ（`renderer-phaser`）

### 7.1 責務

- Phaser の `Game` と `Scene` を生成し、`scene.update(time, delta)` からループドライバを呼ぶ。
- `RenderSnapshot` を prev/curr の 2 世代保持し、`alpha` で線形補間して Sprite の位置とカメラの scroll を設定する。操作感プロファイルの `interpolation: 'none'` では curr をそのまま使う。
- `RoomData.renderLayers` から `make.tilemap({ data })` で Tilemap を作り、`createLayer` で描く。1 タイルセットのレイヤは `gpu: true`（`TilemapGPULayer`）を選べる。
- `AudioCue` を Phaser の Sound で再生する。iOS の解錠（`sound.unlock()`、`Sound.Events.UNLOCKED`）を扱う。
- HUD はプレイ領域外（`hudReserve`）に `scrollFactor 0` のレイヤで描く。カメラの viewport は `setViewport(0, hudReserve.top, width, height - top - bottom)`。
- アセットの取得: URL パックは `load.setBaseURL` と `load.atlas/image/audio`、ローカルディレクトリパックは Blob から `textures.addAtlas` / `textures.addImage` / `sound.decodeAudio` で登録する。

### 7.2 使用する Phaser 4 API（`node_modules/phaser/types/phaser.d.ts` で確認済み）

| 用途 | API | 備考 |
| --- | --- | --- |
| Game 設定 | `Phaser.Types.Core.GameConfig`: `type: Phaser.WEBGL`, `pixelArt: true`, `antialias: false`, `roundPixels: true`, `fps: { smoothStep: false }`, `input: { keyboard: false, gamepad: false }`, `scale`, `audio` | Canvas レンダラは v4 で非推奨。キーボードとゲームパッドは自前の入力層で扱うため Phaser 側を無効化 |
| ループ | `Scene.update(time, delta)` | Phaser の `TimeStep` は RAF 1 回に 1 回呼ぶだけ。固定ステップは自前のアキュムレータで行う |
| タイル描画 | `scene.make.tilemap({ data, tileWidth, tileHeight })`, `Tilemap.addTilesetImage`, `Tilemap.createLayer(0, tileset, 0, 0, gpu)`, `TilemapGPULayer.generateLayerDataTexture()` | GPU レイヤは直交マップと 1 タイルセットのみ。タイル編集後は再生成が必要 |
| スプライト | `scene.add.sprite`, `setTexture`, `setFrame`, `setFlipX`, `setPosition`, `setDepth`, `setVisible`, `vertexRoundMode` | Phaser の Animation は使わず、コアのフレーム状態をそのまま設定する |
| カメラ | `Camera.setScroll`, `setRoundPixels`, `setViewport`, `fadeIn/fadeOut` | 境界クランプはコアが行うため `setBounds` は使わない |
| 音 | `WebAudioSoundManager.unlock()`, `locked`, `Sound.Events.UNLOCKED`, `sound.add(key, { loop })`, `sound.decodeAudio(key, arrayBuffer)`, `sound.context` | `SoundConfig` に `loopStart/loopEnd` は無い。ループ点付き BGM が必要なら `sound.context` を共有する自前の `AudioBufferSourceNode` で再生する（要確認: サンプルパックで必要か） |
| ローダ | `load.setBaseURL`, `load.setCORS`, `load.atlas`, `load.image`, `load.audio`, `textures.addAtlas`, `textures.addImage`, `textures.addSpriteSheet` | 外部パックは CORS が必要 |
| スケール | `Scale.FIT`, `ScaleManager.getMaxZoom()`, `setZoom()`, `startFullscreen()`, `lockOrientation()`, `Scale.Events.FULLSCREEN_UNSUPPORTED`, `ORIENTATION_CHANGE` | 整数倍スケール優先、入らなければ FIT |

Phaser 4 の変更点（Pipeline→RenderNode、FX→Filters、`roundPixels` 既定 false、Camera 行列の再設計）は `node_modules/phaser/changelog/v4/4.0/MIGRATION-GUIDE.md` と `node_modules/phaser/skills/` に一次情報がある。

## 8. 入力層とアプリ層

- `input` は DOM と Gamepad API を扱い、`InputFrame` を tick 直前に生成する。詳細は [input-and-feel.md](input-and-feel.md)。
- `apps/player` は配線のみを持つ: パックの選択、設定 UI（DOM）、PWA 登録、`window.__engine`（`runReplay(file)` と `hash()` を公開するテストフック）。
- メニューやキーコンフィグも Action 語彙（`confirm` / `cancel` / `menu`）で操作し、Phaser の Input には依存しない。

## 9. ディレクトリ構成（計画）

```
retro-action-engine/
├─ apps/player/              # ゲーム本体（/play/<slug>/）。PWA シェル、統合テスト、Playwright
├─ apps/gallery/             # サイトのトップのゲーム一覧（/）
├─ packages/core/            # 純 TS シミュレーション
├─ packages/pack/            # スキーマ、ローダ、Tiled importer（M4 で pack-cli を分離）
├─ packages/input/           # デバイス、Action マップ、InputBuffer
├─ packages/renderer-phaser/ # Phaser 4 アダプタ
├─ packages/solver/          # 到達可能性ソルバー（解析ツール。実行時には含めない）
├─ packs/sample/             # サンプルパック（データのみ、CC0）
├─ infra/                    # AWS CDK（ACM、S3 + CloudFront、Route 53、OIDC、IAM）。手順書は infra/README.md
├─ scripts/site/             # site.json の検証とサイト全体の組み立て（pnpm site:build）
├─ scripts/font/             # メニューのフォント画像の書き出し（手で動かす。ADR-0020）
├─ site.json                 # 一覧に載せるゲームと各ゲームの slug（公開情報。変更は所有者が確認）
├─ schemas/                  # zod から生成した JSON Schema（M4）
├─ docs/                     # 本書、ADR、仕様
├─ .github/workflows/        # ci.yml, preview.yml, deploy.yml
├─ pnpm-workspace.yaml / package.json / biome.json / tsconfig.base.json
├─ .dependency-cruiser.cjs / .nvmrc
└─ CLAUDE.md
```

## 10. 非目標（v1）

- オンライン対戦、同期マルチプレイ。
- 剛体物理（Matter 等）を使う物理パズル。
- 外部パックに含まれるコードの実行（[ADR-0005](decisions/ADR-0005-entity-model-and-pack-code.md) で Deferred）。
- クラウドセーブ。
- 専用のマップエディタ GUI（Tiled を使う）。

## 11. 用語集

| 用語 | 意味 |
| --- | --- |
| tick | シミュレーションの 1 ステップ。60Hz 固定 |
| フレーム | ブラウザの描画 1 回（RAF 1 回）。tick とは独立 |
| Fx | 8.8 固定小数点の整数値。1 px = 256 |
| InputFrame | 1 tick 分の入力。`held / pressed / released` のビットマスク |
| 操作感プロファイル（FeelProfile） | ジャンプ軌道、空中制御、猶予フレームなどのパラメータ集合。パックが複数定義し、切り替えられる |
| 能力タグ | `move:swim` のような文字列。通行判定とゲートの条件に使う。キャラクター ID は使わない |
| PackRuntime | 検証・変換済みの読み取り専用パックデータ |
| World | 可変のシミュレーション状態 |
| RenderSnapshot | 1 tick 分の描画指示。描画層が補間して表示する |
| screenFlip / scroll | カメラの 2 モード。画面切替型とスクロール型 |
| hudReserve | 表示解像度のうち HUD に確保する上下の帯。残りがプレイ領域 |
