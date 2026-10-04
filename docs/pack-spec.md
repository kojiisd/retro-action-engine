# パック仕様（初版）

- formatVersion: `1.0`（本書の版。パック側の `pack.json` に書く値）
- 更新日: 2026-10-04
- 根拠: [ADR-0006](decisions/ADR-0006-pack-format-and-schema.md)、[ADR-0007](decisions/ADR-0007-party-gating-world.md)、[ADR-0005](decisions/ADR-0005-entity-model-and-pack-code.md)
- 操作感プロファイル（`feel.json`）の全パラメータは [input-and-feel.md](input-and-feel.md) を正とする

## 1. 原則

1. エンジンは固有名詞と調整値を持たない。本書に出てくる名前（`knight`、`move:swim` など）はすべてサンプルパックの値であり、エンジンはそれらを知らない。
2. パックはデータのみ（JSON、Tiled JSON、画像、音声）。コードは含まない（v1）。
3. すべてのパスは `pack.json` からの相対パス。絶対 URL と `..` は拒否する。
4. 数値の単位は px、px/tick、px/tick²、tick、秒（音声のみ）。px 系の値は小数で書いてよく、ロード時に 1 回だけ 8.8 固定小数点に丸める（`Math.round(v * 256)`）。
5. スキーマは zod 4 を単一ソースとし、`schemas/*.schema.json` を生成する（M4）。本書のスキーマ記述は TypeScript 風の抜粋であり、実装では zod の定義が正。

## 2. ディレクトリ構成

```
pack-root/
├─ pack.json
├─ rooms/
│  ├─ hub.tmj
│  └─ cave-01.tmj
├─ tilesets/
│  ├─ main.json          # Tiled 外部タイルセット（JSON）
│  └─ main.png
├─ atlases/
│  ├─ characters.json    # JSON Hash（TexturePacker / free-tex-packer）または Aseprite JSON
│  ├─ characters.png
│  ├─ enemies.json
│  └─ enemies.png
├─ audio/
│  ├─ sfx/jump.ogg (+ .m4a)   # 形式は要確認（M4 実機検証）
│  └─ bgm/hub.ogg (+ .m4a)
├─ data/
│  ├─ characters.json
│  ├─ enemies.json
│  ├─ items.json
│  ├─ gimmicks.json
│  ├─ rules.json
│  ├─ feel.json
│  ├─ input.json
│  ├─ camera.json
│  ├─ audio.json
│  ├─ strings.ja.json
│  └─ strings.en.json
├─ credits.json
└─ LICENSE
```

## 3. manifest（`pack.json`）

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `formatVersion` | `"1.0"` | ○ | パック仕様の版。`major.minor` |
| `id` | string（`[a-z0-9-]+`） | ○ | パック識別子。セーブとキャッシュのキーに使う |
| `name` | string | ○ | 表示名 |
| `version` | semver | ○ | パックの版。セーブ互換の判定に使う |
| `engine.formatVersion` | semver range | ○ | 対応するパック仕様の範囲（例 `"^1.0"`） |
| `display.width` / `display.height` | int | ○ | 表示解像度（px） |
| `display.hudReserve.top` / `.bottom` | int | ○ | HUD に確保する帯。残りがプレイ領域 |
| `display.orientation` | `"landscape" \| "portrait" \| "any"` | ○ | 推奨する画面向き |
| `tileSize` | int | ○ | タイルの一辺（px）。全部屋で共通 |
| `entry.roomId` / `entry.spawnId` | string | ○ | 新規ゲームの開始位置 |
| `files.*` | path | ○ | 各データファイルのパス（下記） |
| `saveCompat` | semver range | ○ | この版が読み込めるセーブの `packVersion` の範囲 |
| `licenses.code` / `licenses.assets` | SPDX | ○ | パック自体のライセンス |
| `credits` | path | ○ | `credits.json` |

```json
{
  "formatVersion": "1.0",
  "id": "sample",
  "name": "Sample Pack",
  "version": "0.1.0",
  "engine": { "formatVersion": "^1.0" },
  "display": {
    "width": 320,
    "height": 180,
    "hudReserve": { "top": 20, "bottom": 0 },
    "orientation": "landscape"
  },
  "tileSize": 16,
  "entry": { "roomId": "hub", "spawnId": "start" },
  "files": {
    "rooms": ["rooms/hub.tmj", "rooms/cave-01.tmj"],
    "tilesets": ["tilesets/main.json"],
    "atlases": { "characters": "atlases/characters.json", "enemies": "atlases/enemies.json" },
    "characters": "data/characters.json",
    "enemies": "data/enemies.json",
    "items": "data/items.json",
    "gimmicks": "data/gimmicks.json",
    "rules": "data/rules.json",
    "feel": "data/feel.json",
    "input": "data/input.json",
    "camera": "data/camera.json",
    "audio": "data/audio.json",
    "strings": { "ja": "data/strings.ja.json", "en": "data/strings.en.json" }
  },
  "saveCompat": ">=0.1.0 <0.2.0",
  "licenses": { "code": "MIT", "assets": "CC0-1.0" },
  "credits": "credits.json"
}
```

プレイ領域は 320×160 px（20×10 タイル）。`display.height` がタイルサイズの倍数でなくても、プレイ領域をタイルの倍数に合わせることで screenFlip の端数問題を避けられる。

## 4. データファイル

### 4.1 `characters.json`

```ts
interface CharacterDef {
  id: string;
  name: string;                       // "@strings:key" 可
  abilityTags: string[];              // 基本の能力タグ
  hp: { max: number };
  collider: { w: number; h: number; ox: number; oy: number }; // px。位置（足元中央）からの相対
  sprite: { atlas: string; animations: Record<string, AnimationDef> };
  feelOverrides?: Partial<FeelMotion>; // 操作感プロファイルの一部をキャラ別に上書き
}

interface AnimationDef {
  frames: Array<{ frame: string; ticks: number; hurtbox?: Box; hitbox?: Box }>;
  loop: boolean;
}
type Box = { x: number; y: number; w: number; h: number }; // px。足元中央からの相対
```

アニメーション名はエンジンが参照する固定の集合（`idle`, `run`, `jump`, `fall`, `attack`, `hurt`, `climb`, `dead`）と、振る舞いの `setAnim` から参照する任意の名前。

```json
{
  "characters": [
    {
      "id": "knight",
      "name": "@strings:char.knight",
      "abilityTags": ["attack:melee", "break:rock"],
      "hp": { "max": 6 },
      "collider": { "w": 12, "h": 14, "ox": -6, "oy": -14 },
      "sprite": {
        "atlas": "characters",
        "animations": {
          "idle": { "frames": [{ "frame": "knight/idle-0", "ticks": 60 }], "loop": true },
          "run": { "frames": [{ "frame": "knight/run-0", "ticks": 6 }, { "frame": "knight/run-1", "ticks": 6 }], "loop": true },
          "jump": { "frames": [{ "frame": "knight/jump-0", "ticks": 1 }], "loop": false },
          "fall": { "frames": [{ "frame": "knight/fall-0", "ticks": 1 }], "loop": false },
          "attack": {
            "frames": [
              { "frame": "knight/attack-0", "ticks": 4 },
              { "frame": "knight/attack-1", "ticks": 6, "hitbox": { "x": 6, "y": -12, "w": 14, "h": 8 } },
              { "frame": "knight/attack-2", "ticks": 4 }
            ],
            "loop": false
          },
          "hurt": { "frames": [{ "frame": "knight/hurt-0", "ticks": 1 }], "loop": false }
        }
      },
      "feelOverrides": { "runSpeed": 1.25 }
    },
    {
      "id": "scout",
      "name": "@strings:char.scout",
      "abilityTags": ["size:small", "move:swim"],
      "hp": { "max": 4 },
      "collider": { "w": 10, "h": 10, "ox": -5, "oy": -10 },
      "sprite": { "atlas": "characters", "animations": { "idle": { "frames": [{ "frame": "scout/idle-0", "ticks": 60 }], "loop": true } } },
      "feelOverrides": { "runSpeed": 1.75, "jumpVelocity": 4.75 }
    }
  ]
}
```

### 4.2 `enemies.json`

```ts
interface EnemyDef {
  id: string;
  hp: number;
  damage: number;                 // 接触ダメージ
  collider: Box;
  sprite: { atlas: string; animations: Record<string, AnimationDef> };
  behavior: BehaviorSpec;         // ADR-0005
  drops?: Array<{ itemId: string; chance: number }>; // chance は 0..1。World.rng で判定
  gravity: boolean;
}
```

Primitive と Condition の一覧（エンジン同梱。追加時は本書と ADR-0005 を更新する）:

| Primitive | パラメータ | 動作 |
| --- | --- | --- |
| `idle` | なし | 何もしない |
| `patrol` | `speed` | 向いている方向へ移動 |
| `turnAtEdge` | なし | 足元の先に床が無ければ反転 |
| `turnAtWall` | なし | 壁に当たったら反転 |
| `chase` | `speed`, `range` | 範囲内のプレイヤーへ水平移動 |
| `flee` | `speed`, `range` | 範囲内のプレイヤーから離れる |
| `jumpEvery` | `ticks`, `velocity` | 周期的にジャンプ |
| `shootEvery` | `ticks`, `projectile`, `direction: "facing" \| "player"` | 周期的に弾を出す |
| `sineFloat` | `amplitude`, `periodTicks`, `table` | 整数テーブルで上下動 |
| `bounce` | `velocity` | 着地で跳ねる |
| `faceTarget` | なし | プレイヤーの方を向く |
| `setAnim` | `name` | アニメーション切替 |
| `emit` | `event` | イベント発火 |

| Condition | パラメータ |
| --- | --- |
| `always` | なし |
| `playerWithin` / `playerBeyond` | `px` |
| `hpBelow` | `ratio` |
| `timer` | `ticks`（状態に入ってからの経過） |
| `onGround` / `touchingWall` / `hit` | なし |
| `flag` | `key`, `equals` |
| `not` / `all` / `any` | 入れ子 |

```json
{
  "enemies": [
    {
      "id": "walker",
      "hp": 2, "damage": 1, "gravity": true,
      "collider": { "x": -6, "y": -12, "w": 12, "h": 12 },
      "sprite": { "atlas": "enemies", "animations": { "walk": { "frames": [{ "frame": "walker/0", "ticks": 8 }, { "frame": "walker/1", "ticks": 8 }], "loop": true } } },
      "behavior": {
        "initial": "walk",
        "states": {
          "walk": {
            "actions": [{ "type": "patrol", "speed": 0.5 }, { "type": "turnAtEdge" }, { "type": "turnAtWall" }],
            "transitions": [{ "when": { "type": "playerWithin", "px": 48 }, "to": "rush" }]
          },
          "rush": {
            "actions": [{ "type": "chase", "speed": 1.0, "range": 96 }, { "type": "turnAtWall" }],
            "transitions": [{ "when": { "type": "playerBeyond", "px": 96 }, "to": "walk" }]
          }
        }
      }
    }
  ]
}
```

### 4.3 `items.json`

```ts
interface ItemDef {
  id: string;
  name: string;
  kind: 'key' | 'consumable' | 'equipment' | 'upgrade';
  grants?: string[];        // 所持中に付与する能力タグ
  effect?: { heal?: number; hpMaxDelta?: number };
  stack: number;            // 最大所持数
  sprite: { atlas: string; frame: string };
}
```

```json
{
  "items": [
    { "id": "swim-charm", "name": "@strings:item.swim-charm", "kind": "equipment", "grants": ["move:swim"], "stack": 1, "sprite": { "atlas": "enemies", "frame": "items/charm" } },
    { "id": "small-key", "name": "@strings:item.small-key", "kind": "key", "stack": 9, "sprite": { "atlas": "enemies", "frame": "items/key" } },
    { "id": "herb", "name": "@strings:item.herb", "kind": "consumable", "effect": { "heal": 2 }, "stack": 5, "sprite": { "atlas": "enemies", "frame": "items/herb" } }
  ]
}
```

### 4.4 `gimmicks.json`

エンジン組込みのギミック種別にパラメータを与えて名前を付ける。部屋のオブジェクトからは `gimmickId` で参照する。

| 種別 | パラメータ |
| --- | --- |
| `door` | `toRoomId`, `spawnId`, `effect` |
| `gate` | `requiresAnyTag?`, `requiresFlag?`, `consumesItem?`, `opensFlag` |
| `switch` | `setsFlag`, `once` |
| `savePoint` | なし |
| `warp` | `toRoomId`, `spawnId`, `effect` |
| `pickup` | `itemId`, `count`, `onceFlag?` |
| `text` | `key` |
| `breakable` | `requiresAnyTag`, `drops?` |
| `spawner` | `enemyId`, `everyTicks`, `max` |
| `bossDoor` | `bossFlag` |
| `movingPlatform`（M5） | `path`, `speed`, `loop` |

```json
{
  "gimmicks": [
    { "id": "locked-door", "type": "gate", "consumesItem": "small-key", "opensFlag": "room.hub.door-east" },
    { "id": "rock", "type": "breakable", "requiresAnyTag": ["break:rock"] },
    { "id": "save", "type": "savePoint" }
  ]
}
```

### 4.5 `rules.json`

型は ADR-0007 の `RulesDef`。サンプル:

```json
{
  "party": {
    "members": ["knight", "scout"],
    "switch": { "mode": "anywhere", "cooldownTicks": 20, "requireGrounded": false, "placement": "same" }
  },
  "hp": { "scope": "perCharacter", "onDeath": "switchToAlive", "onAllDown": "respawnAtSavePoint" },
  "inventory": { "scope": "shared" },
  "gating": { "subject": "active" },
  "save": { "slots": 3, "autosave": { "onRoomTransition": true } },
  "respawn": { "enemies": "onEnter" },
  "interact": { "action": "up" },
  "physics": { "entityPush": false }
}
```

### 4.6 `feel.json`

複数の操作感プロファイルと既定を定義する。パラメータの意味と例値は [input-and-feel.md](input-and-feel.md) の表を正とする。

```json
{
  "default": "retro",
  "profiles": {
    "retro": { "...": "input-and-feel.md の retro 列" },
    "modern": { "...": "input-and-feel.md の modern 列" }
  }
}
```

### 4.7 `input.json`

```ts
interface InputDefaults {
  keyboard: Partial<Record<ActionId, string[]>>;      // KeyboardEvent.code
  gamepad: { standard: Partial<Record<ActionId, GamepadInputId[]>> };
  analog: { deadzone: number; release: number };     // 0..1。release < deadzone（ヒステリシス）
  touch: { layout: string };                          // 既定レイアウト名
}
type GamepadInputId =
  | `button${number}`
  | 'dpadUp' | 'dpadDown' | 'dpadLeft' | 'dpadRight'
  | 'leftStickUp' | 'leftStickDown' | 'leftStickLeft' | 'leftStickRight';
```

```json
{
  "keyboard": {
    "left": ["ArrowLeft", "KeyA"], "right": ["ArrowRight", "KeyD"], "up": ["ArrowUp", "KeyW"], "down": ["ArrowDown", "KeyS"],
    "jump": ["KeyZ", "Space"], "attack": ["KeyX"], "switch": ["KeyC", "ShiftLeft"], "item": ["KeyV"],
    "pause": ["Escape"], "menu": ["Enter"], "confirm": ["KeyZ", "Enter"], "cancel": ["KeyX", "Escape"]
  },
  "gamepad": {
    "standard": {
      "left": ["dpadLeft", "leftStickLeft"], "right": ["dpadRight", "leftStickRight"], "up": ["dpadUp", "leftStickUp"], "down": ["dpadDown", "leftStickDown"],
      "jump": ["button0"], "attack": ["button2"], "switch": ["button1"], "item": ["button3"],
      "pause": ["button9"], "menu": ["button8"], "confirm": ["button0"], "cancel": ["button1"]
    }
  },
  "analog": { "deadzone": 0.35, "release": 0.25 },
  "touch": { "layout": "default" }
}
```

### 4.8 `camera.json`

型は ADR-0009。サンプル:

```json
{
  "mode": "scroll",
  "activationMarginPx": 32,
  "scroll": { "deadzone": { "w": 48, "h": 32 }, "lookahead": { "x": 24, "y": 0 }, "lerpShift": 3, "lockY": false, "snapToTileRows": false },
  "screenFlip": { "transition": "scroll", "transitionTicks": 30, "pauseSimulation": true, "triggerInsetPx": 0 },
  "roomTransition": { "effect": "fade", "lockTicks": 20 }
}
```

### 4.9 `audio.json`

```ts
interface AudioDef {
  sfx: Record<string, { src: string[]; volume?: number }>;         // 複数形式を優先順に
  bgm: Record<string, { src: string[]; loopStart?: number; loopEnd?: number; volume?: number }>; // 秒
  events: { jump?: string; land?: string; hit?: string; pickup?: string; switch?: string; menuMove?: string; menuConfirm?: string };
}
```

```json
{
  "sfx": {
    "jump": { "src": ["audio/sfx/jump.ogg", "audio/sfx/jump.m4a"] },
    "hit": { "src": ["audio/sfx/hit.ogg", "audio/sfx/hit.m4a"] }
  },
  "bgm": {
    "hub": { "src": ["audio/bgm/hub.ogg", "audio/bgm/hub.m4a"], "loopStart": 4.0, "loopEnd": 36.0 }
  },
  "events": { "jump": "jump", "hit": "hit" }
}
```

`loopStart / loopEnd` を使う BGM は、Phaser の `SoundConfig` にループ点が無いため、描画層が `sound.context` を共有する自前の `AudioBufferSourceNode` で再生する。

### 4.10 `strings.<lang>.json`

フラットなキーと文字列。他のデータからは `@strings:key` で参照する。言語の選択は app 層。

```json
{ "char.knight": "騎士", "char.scout": "斥候", "item.swim-charm": "泳ぎのお守り", "text.hub.welcome": "ここが拠点だ。" }
```

## 5. 部屋（Tiled 1.11 系 JSON）

### 5.1 制約

- 直交（orthogonal）、有限マップ、`tilewidth = tileheight = tileSize`。無限マップ、isometric、hexagonal は非対応。
- タイルセットは外部 JSON（`tilesets/*.json`）。埋め込みタイルセットも読めるが、タイルクラスの共有のため外部を推奨。
- 1 部屋のサイズに上限はないが、`collision` は `Uint16Array` なので tileClassId は 65535 まで。

### 5.2 レイヤ規約

| レイヤ名 | 種別 | 役割 |
| --- | --- | --- |
| `bg` | tile | 背景。衝突なし |
| `main` | tile | 衝突を生成する唯一のタイルレイヤ |
| `fg` | tile | 前景。衝突なし |
| `entities` | object | 敵、ギミック、spawn |
| `zones` | object | イベント領域、カメラ領域 |
| `exits` | object | 出口 |

規約外のレイヤ名は警告付きで無視する（`parallax-*` は将来の拡張用に予約）。

### 5.3 タイルクラス（タイルセットの `class` とプロパティ）

| `class` | 追加プロパティ | 生成される `TileClass` |
| --- | --- | --- |
| （空） | なし | `solid: 'none'` |
| `solid` | なし | `solid: 'full'` |
| `oneway` | なし | `solid: 'oneway'` |
| `slope` | `heights: "0,1,2,...,15"`（文字列。tileSize 個） | `solid: 'slope'`（M5） |
| `ladder` | なし | `ladder: true` |
| `hazard` | `damage: int` | `hazard: damage` |
| 任意 | `requiresAnyTag: "move:swim,size:small"` | `requiresAnyTag`（カンマ区切り） |

例: 水タイルは `class: "solid"` + `requiresAnyTag: "move:swim"` とすると、泳げるキャラだけが通れる。狭い通路は `class: "solid"` + `requiresAnyTag: "size:small"`。

### 5.4 オブジェクト規約

| レイヤ | `class` | プロパティ |
| --- | --- | --- |
| `entities` | `spawn` | `name` = spawnId |
| `entities` | `enemy` | `enemyId`, `facing: "left" \| "right"` |
| `entities` | `gimmick` | `gimmickId`, 種別ごとの追加（`toRoomId`, `spawnId`, `itemId`, `key` など。`gimmicks.json` の定義を上書きできる） |
| `zones` | `event` | `trigger: "onZoneEnter" \| "onZoneExit"`, `conditions`（JSON 文字列）, `actions`（JSON 文字列） |
| `zones` | `camera` | `lockY: bool` などの部屋内オーバーライド（M3） |
| `exits` | `exit` | `kind: "edge" \| "door" \| "warp"`, `toRoomId`, `spawnId`, `effect`, `requiresAnyTag?`, `requiresFlag?` |

- オブジェクトの位置は Tiled の矩形左上。エンティティの初期位置は矩形の底辺中央に変換する。
- `name` は Tiled 上の識別に使い、エンジンは `spawn` 以外では参照しない。
- 部屋外周は solid。`kind: "edge"` の exit は外周に接する矩形として置く。

### 5.5 タイルセット JSON

Tiled の外部タイルセット形式をそのまま使う。`image` はタイルセット JSON からの相対パス。1 部屋で複数タイルセットを使ってよいが、`TilemapGPULayer` を使うには 1 レイヤ 1 タイルセットである必要がある（描画層が自動判定し、複数なら通常レイヤにフォールバックする）。

## 6. アトラスとアニメーション

- アトラスは JSON Hash（`frames` がフレーム名をキーにしたオブジェクト）を第一にサポートする。Aseprite の JSON 出力も同じ形式で読める。
- フレーム名は `<group>/<name>-<index>` を推奨。エンジンは文字列として扱うだけで規約を強制しない。
- アニメーションの進行はコアが tick 単位で行う。1 フレームの `ticks` は 1 以上の整数。
- hit / hurt ボックスはフレームごとに持てる。省略時は `collider` を hurtbox として使う。

## 7. 単位と座標系

| 量 | 単位 | 備考 |
| --- | --- | --- |
| 位置、サイズ | px（小数可） | ロード時に Fx へ丸める。原点は部屋の左上、Y は下向き |
| 速度 | px/tick | 60 tick = 1 秒 |
| 加速度 | px/tick² | |
| 時間 | tick | 秒で書かない |
| 音声のループ点 | 秒 | 音声だけは秒 |
| エンティティの位置 | 足元中央 | `collider` と `Box` はこの点からの相対 |

## 8. 参照解決と検証

1. `pack.json` を読み、`formatVersion` が対応範囲か確認する。
2. 各ファイルを zod で検証する。エラーは `data/enemies.json#/enemies/0/behavior/states/walk: ...` の形式で集約する。
3. 参照整合性を検査する: `roomId`, `spawnId`, `atlas`, `frame`（アトラス JSON に存在するか）, `itemId`, `enemyId`, `gimmickId`, `@strings:key`, `feel.default`, `entry`。
4. Tiled JSON を `RoomData` に変換する。規約違反は行番号ではなくオブジェクト名とレイヤ名で報告する。
5. すべて通ったら `PackRuntime` を返す。1 つでもエラーがあれば読み込まない（警告のみなら読み込む）。

## 9. バージョニングと互換

- `formatVersion` の minor 更新は後方互換の追加のみ（新しい任意フィールド、新しい Primitive）。major 更新では `pack/src/migrate/` に変換関数を置く。
- `engine.formatVersion` はパックが要求する仕様範囲。エンジンが範囲外なら理由を表示して拒否する。
- `saveCompat` はパックが読み込めるセーブの `packVersion` の範囲。範囲外のセーブは読み込みを拒否し、エクスポートを案内する。

## 10. 外部パックの読み込み

| ソース | 指定方法 | 備考 |
| --- | --- | --- |
| `builtin` | 既定 | `apps/player/public/packs/sample/` |
| `url` | `?pack=https://example.net/my-pack/` | 末尾 `/` のディレクトリ URL。CORS（`Access-Control-Allow-Origin`）が必要。http は拒否 |
| `localDirectory` | 設定画面の「フォルダを開く」 | File System Access API。未対応ブラウザは `<input webkitdirectory>`。iOS は zip を選択 |
| `cached` | 設定画面の一覧 | 読み込み済みパックを IndexedDB から復元 |

- 初回読み込み時に出所（URL またはフォルダ名）、`name`、`version`、`licenses` を表示して確認を求める。
- 読み込んだ外部パックは `url + version` をキーに IndexedDB に保存し、オフラインでも選べる。
- 外部パックのコードは読み込まない。`scripts/` があっても無視し警告する。

## 11. ライセンスとクレジット

- リポジトリ同梱のサンプルパックは、コード MIT、素材 CC0。
- `credits.json` に素材ごとの出所、作者、ライセンス、改変の有無を記録する。

```json
{
  "assets": [
    { "path": "atlases/characters.png", "author": "project", "license": "CC0-1.0", "source": "original" },
    { "path": "audio/bgm/hub.ogg", "author": "project", "license": "CC0-1.0", "source": "original" }
  ]
}
```

- 既存作品の素材、キャラクター名、楽曲をパックに含めない。私的な再現パックはリポジトリ外に置く。

## 12. パック作成チェックリスト

1. `pack.json` の `display`、`tileSize`、`entry` を決める。プレイ領域がタイルの倍数になるよう `hudReserve` を調整する。
2. タイルセットにクラス（`solid` / `oneway` / `ladder` / `hazard`）と `requiresAnyTag` を付ける。
3. Tiled で部屋を作る。レイヤ名は規約どおり。`spawn` を少なくとも 1 つ置く。
4. `characters.json` に能力タグとアニメーションを定義する。1 人でもよい。
5. `rules.json` でパーティ、HP、所持品、切替を選ぶ。
6. `feel.json` にプロファイルを 1 つ以上書く。
7. `pnpm pack:validate <dir>`（M4 で `pack-cli validate`）で検証する。
8. `credits.json` を埋める。

## 13. 付録: サンプルパックの部屋構成（M1〜M3 の題材）

| 部屋 | 役割 | 検証する機能 |
| --- | --- | --- |
| `hub` | 拠点。セーブポイント、東の施錠扉（`small-key`）、西の低い通路（`size:small`）、下の水路（`move:swim`） | 能力タグ通行、ゲート、セーブ、2 人切替 |
| `cave-01` | 最初のダンジョン。`walker` 数体、`breakable`（`break:rock`）、すり抜け床、`swim-charm` の宝箱 | 敵の振る舞い、hit/hurt、アイテムによるタグ付与、oneway |
| `cave-boss`（M3） | ボス部屋。`bossDoor`、撃破で `small-key` ドロップ | ボスフラグ、ドロップ、部屋遷移 |

M1 では `hub` の 1 画面相当（320×160 px のプレイ領域 1 枚）だけを使う。
