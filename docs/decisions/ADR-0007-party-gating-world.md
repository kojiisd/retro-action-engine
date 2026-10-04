# ADR-0007: パーティ、能力ゲーティング、ワールド構造

- Status: Accepted
- Date: 2026-10-04
- 論点: E

## 背景

1〜N 人のパーティ、切替ルールのデータ定義、キャラクター ID ではなく能力タグによる通行判定、HP と所持品のスコープをパックで選べること、部屋グラフと部屋遷移が要件。

## 選択肢

| 論点 | 案 | 採用 |
| --- | --- | --- |
| 通行判定の主体 | キャラクター ID / 能力タグ | 能力タグ。ID 分岐はエンジンに固有名を持ち込むため禁止 |
| ゲートの評価対象 | 操作中キャラのみ / パーティの誰か | ルールで選択可（`rules.gating.subject`）。サンプルは操作中キャラ |
| HP と所持品 | 共有 / キャラ別 | ルールで選択可。サンプルは HP キャラ別、所持品共有 |
| 切替 | いつでも / 特定地点 / 不可 | ルールで選択可 |
| ワールド | 1 枚の巨大マップ / 部屋グラフ | 部屋グラフ（screenFlip と scroll の両方に対応しやすい） |

## 決定

### 能力タグ

- 有効タグ（キャラごと）= `Character.abilityTags` ∪ 所持アイテムの `grants` ∪ フラグによる `grants` − フラグによる `revokes`。所持品が共有スコープなら全員に、キャラ別なら持ち主にのみ付く。
- タグは `名前空間:値` の文字列（例: `move:swim`, `size:small`, `attack:melee`, `break:rock`）。エンジンはタグの意味を知らず、集合演算だけを行う。
- ゲートの評価対象は `rules.gating.subject: 'active' | 'anyInParty'`。
- 通行判定（タイル）は `CollisionContext.abilityTags` に有効タグを渡す（ADR-0004）。ゲートギミックも同じ集合で評価する。

### パーティとスコープ

```ts
interface RulesDef {
  party: {
    members: string[];                       // 初期メンバー。1 人でもよい
    switch: {
      mode: 'anywhere' | 'atPoints' | 'never';
      cooldownTicks: number;
      requireGrounded: boolean;
      placement: 'same' | 'spawn';          // 切替後の位置: 同位置 / 直近の spawn
    };
  };
  hp: {
    scope: 'shared' | 'perCharacter';
    onDeath: 'gameOver' | 'switchToAlive' | 'respawnAtSavePoint';
    onAllDown: 'gameOver' | 'respawnAtSavePoint';
  };
  inventory: { scope: 'shared' | 'perCharacter' };
  gating: { subject: 'active' | 'anyInParty' };
  save: { slots: number; autosave: { onRoomTransition: boolean } };
  respawn: { enemies: 'onEnter' | 'never' | 'onReload' };
}
```

- 1 人構成または `mode: 'never'` では `UiState.canSwitch = false` となり、描画層は切替 UI を出さない。
- パーティ構成はイベントの `setPartyMember` で増減できる。
- サンプルパック: HP perCharacter、所持品 shared、`onDeath: switchToAlive`、`onAllDown: respawnAtSavePoint`、切替 anywhere。

### フラグとイベント

- フラグは `Record<string, number | boolean>`。名前空間は `global.*` と `room.<roomId>.*`。
- イベント = トリガ × Condition × Action。

| トリガ | 発火 |
| --- | --- |
| `onEnterRoom` | 部屋に入った tick |
| `onInteract` | 操作中キャラが対象に重なって `confirm`（または `up`）を押した |
| `onDefeat` | 敵 / ボスの HP が 0 になった |
| `onPickup` | アイテムを拾った |
| `onZoneEnter` / `onZoneExit` | ゾーンに入った / 出た |
| `onFlagChange` | 指定フラグが変化した |

Condition は ADR-0005 の集合に `hasTag`, `hasItem`, `partyIncludes` を加える。Action: `setFlag`, `giveItem`, `removeItem`, `openGate`, `spawn`, `despawn`, `warp`, `playSfx`, `playBgm`, `showText`, `setPartyMember`, `heal`, `damage`。すべて tick 内で同期的に処理し、Action 列は配列順に実行する。

### ワールド構造

- `rooms` が頂点、`exits` が辺の有向グラフ。拠点（城など）も通常の room。
- `ExitDef = { id, kind: 'edge' | 'door' | 'warp', rect, toRoomId, spawnId, effect: 'cut' | 'fade' | 'scroll', requiresAnyTag?, requiresFlag? }`。`edge` は部屋外周の領域、`door` は `confirm` で入る、`warp` は接触で発動。
- 部屋遷移はコアが `TransitionRequest` を出し、ドライバが `sim.enterRoom()` を呼ぶ。遷移演出の間の tick 停止数（`transitionLockTicks`）は `camera.json` で定義し決定論を保つ。
- 敵の再出現は `rules.respawn.enemies`。ボスの撃破は `room.<id>.boss.<entityId>` フラグに自動記録し、`never` 扱いにする。開いた扉などの永続状態もフラグで表す。

## 結果

- 得られるもの: キャラ固有名のないエンジン、パックごとのルール差し替え、部屋単位の決定論的な遷移。
- 失うもの: 1 枚の巨大シームレスマップは非対応（部屋を大きくすることで代替）。
- フォローアップ: サンプルパックに「タグが無いと通れない」「アイテムでタグが付く」「フラグで扉が開く」の 3 パターンを必ず入れ、scenario テストの題材にする。

## 要確認

- `onInteract` のボタンを `confirm` にするか `up` にするか（原作風は `up` が多い）。パックの `input.json` で選べるようにする前提で、既定値は M3 で決める。
