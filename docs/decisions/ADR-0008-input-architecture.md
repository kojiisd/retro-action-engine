# ADR-0008: 入力アーキテクチャ

- Status: Accepted
- Date: 2026-10-04
- 論点: F

## 背景

操作性最優先。キーボード、ゲームパッド、タッチ（仮想パッド）に対応し、キーコンフィグ可能で、入力ログの記録と再生で決定論的にテストできる必要がある。Phaser 4 の入力は `GamepadPlugin` が Scene の `InputEvents.UPDATE` 時（1 フレーム 1 回）に `navigator.getGamepads()` を再取得し、Keyboard は DOM イベントを `captures` で `preventDefault` する実装である（`node_modules/phaser/src/input/`）。Phaser の `Game.step` では入力マネージャが PRE_STEP で更新され、tick 直前のサンプリングを保証できない。

## 選択肢

| 論点 | 案 | 採用 |
| --- | --- | --- |
| ゲームプレイ入力の取得 | Phaser Input を使う / 自前のデバイス層 | 自前。tick 直前のサンプリングとエッジ規則を自分で制御する。Phaser 側は `input: { keyboard: false, gamepad: false }` |
| 先行入力の実装場所 | デバイス層 / シミュレーション | シミュレーション。`InputFrame` に含めるとリプレイで再現できなくなる |
| 入力の表現 | イベント列 / tick 毎の状態 | tick 毎の `InputFrame`（held / pressed / released のビットマスク） |
| キューあふれ | 最古を破棄 / 全破棄して再同期 | 全破棄して再同期（押しっぱなし事故の防止） |

## 決定

### 4 層

1. **Device**: `KeyboardDevice`（`window` の `keydown/keyup`、`event.code`、`repeat` は無視、ゲーム用キーのみ `preventDefault`）、`GamepadDevice`（RAF 毎に `navigator.getGamepads()` をポーリングし前回との差分をエッジにする。`mapping === "standard"` を M1、非標準は M2 の割当 UI）、`TouchPadDevice`（M2。DOM オーバーレイ、Pointer Events、`touch-action: none`）。各デバイスは状態遷移 `(action, down | up, seq)` をキューに積む。
2. **ActionMap**: エンジン固定の Action 語彙 `left right up down jump attack switch item pause menu confirm cancel extra1..4`。デバイス入力を Action に写像する。既定バインドはパックの `input.json`、ユーザ上書きは Settings。アナログ軸はデッドゾーン + ヒステリシスでデジタル化する。
3. **InputBuffer**: tick 直前にキューを消費し `InputFrame` を生成する（下記エッジ規則）。
4. **Simulation**: `InputFrame` を消費する。先行入力（ジャンプバッファ）とコヨーテタイムは過去 N tick の `InputFrame` と衝突フラグから判定する。

### エッジ規則

1. 同一 action の遷移は 1 tick に最大 1 つ消費する。2 つ目に当たった時点で消費を止め、以降は次 tick に持ち越す（全体の順序を保つ）。
2. `held(t)` = 消費後の状態、`pressed(t)` = down を消費した action、`released(t)` = up を消費した action。同一 action の pressed と released が同じ tick に立つことはなく、すべてのエッジはちょうど 1 回ずつ発生順に届く。
3. tick より短いタップは「tick t で pressed + held、tick t+1 で released」になる。最短 1 tick の押下を保証する。
4. 1 フレームで k tick を消化する場合も tick ごとに 1 を適用する。遷移が尽きた tick は `held = 現在状態, pressed = released = 0`。エッジは複製されない。
5. 120Hz 等で 1 tick の間に複数回ポーリングされても差分がキューに積まれるのでタップは失われない。
6. リプレイは規則適用後の `InputFrame` を記録する。

### 再同期（resync）

次のいずれかでキューを全破棄し、物理状態へ再同期する。最古破棄は行わない。

| トリガ | 条件 |
| --- | --- |
| (a) | キュー長が 256 件を超えた |
| (b) | バックログ深さが `maxBacklogTicks`（既定 6、設定可）を超えた。バックログ深さ = ある action の未消費遷移数の最大値（1 tick に 1 つしか消費しないため、消化に必要な tick 数と等しい） |
| (c) | ループドライバがフレーム時間をクランプして捨てた（ADR-0003 の `dropped`） |
| (d) | `blur` または `visibilitychange(hidden)`。このときの物理状態は「全 action 解放」とみなす |

手順: キューを空にする → 各 action について「最後に発行した `InputFrame` の held」と「現在の物理状態」（キーボードは DOM 由来の押下集合、ゲームパッドは直近ポーリング、タッチはアクティブポインタ）を比較し、異なる action にだけ遷移を 1 つ積む。次 tick でエッジは action あたり最大 1 つ、held は 1 tick 後に現実と一致する。`resyncCount` を計上し、開発ビルドでは警告を出す。再同期はライブ入力の生成にのみ影響し、記録済みフレーム列の再生には関与しない。

### 遅延の抑制

- ループは RAF に固定し、tick の消化と描画を同じフレームで行う。入力は tick 直前にサンプリングする。
- `fps.smoothStep: false`（ADR-0003）。キーリピートと IME を避ける。
- `desynchronized: true` キャンバスは試験オプション（M2 で実測して判断）。

### リプレイ

```ts
interface ReplayFile {
  version: 1;
  packId: string;
  packVersion: string;
  feelProfile: string;
  seed: number;
  start: { roomId: string; spawnId: string; party?: string[] };
  frames: Array<[count: number, held: number, pressed: number, released: number]>; // RLE
  checkpoints?: Array<{ tick: number; hash: [number, number] }>;
  final?: { tick: number; hash: [number, number] };
}
```

## 結果

- 得られるもの: デバイスとフレームレートに依存しない `InputFrame`、取りこぼしも複製もないエッジ、押しっぱなし事故の防止、リプレイによる決定論テスト。
- 失うもの: Phaser の入力機能（キーボード、ゲームパッド）は使わない。メニューも自前の Action で駆動する。
- フォローアップ: 仕様の詳細（既定バインド、仮想パッド、プロファイル）は `docs/input-and-feel.md`。

## 要確認

- `desynchronized: true` の採用可否（M2 で実測）。
- 非標準マッピングのゲームパッドの既定の扱い（M2 で割当 UI を用意するまでは未割当として扱う）。
