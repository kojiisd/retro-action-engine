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
| `files.*` | path | ○ | 各データファイルのパス（下記）。`rooms`、`tilesets`、`atlases`、`characters`、`rules`、`feel`、`input` は必須。`camera`、`enemies`、`items`、`gimmicks`、`audio`、`strings`、`ui` は任意（敵やアイテムの無いパックもある。M1-5 の時点で読むのは必須のものだけで、`camera` は形だけ検査する） |
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
    "strings": { "ja": "data/strings.ja.json", "en": "data/strings.en.json" },
    "ui": "data/ui.json"
  },
  "saveCompat": ">=0.1.0 <0.2.0",
  "licenses": { "code": "MIT", "assets": "CC0-1.0" },
  "credits": "credits.json"
}
```

パス（`files.*`、`credits`、タイルセットとアトラスの `image`、マップの `tilesets[].source`）は、それを書いたファイルからの相対パス。`..` でパックのルートの外に出るもの、絶対パス、URL は読み込み時にエラーにする。

プレイ領域は 320×160 px（20×10 タイル）。`display.height` がタイルサイズの倍数でなくても、プレイ領域をタイルの倍数に合わせることで screenFlip の端数問題を避けられる。

## 4. データファイル

### 4.1 `characters.json`

```ts
interface CharacterDef {
  id: string;
  name: string;                       // "@strings:key" 可。1〜6 文字（メニューに出す。M3-6、ADR-0020）
  abilityTags: string[];              // 基本の能力タグ
  hp?: { max: number };               // rules.hp があるパックでは必須（M2-5、ADR-0016）
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

`attack` アニメーションを持つキャラクターは攻撃できる（M2-5、ADR-0017）。攻撃の長さは `attack` のコマの長さの合計で、`attack` は `loop: false` にする。`hitbox` は右向きのときの値で、左向きでは左右を反転する。コマの絵の大きさはコマごとに違ってよい（足元中央を基準に描く）。

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
  effect?: { heal?: number; hpMaxDelta?: number }; // 使うアイテムと一緒に読む（M3-3 では読み込み時に拒否、ADR-0021）
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

エンジン組込みのギミック種別にパラメータを与えて名前を付ける。部屋のオブジェクトからは `gimmickId` で参照する。各定義に絵 `sprite: { atlas, frame }`（`switch` は押した後の `frameOn` も。`pickup` はアイテムの絵）。M3-3 で動くのは `pickup`、`breakable`、`switch`、`gate`（`requiresFlag` だけ）で、ほかの種類と `gate` の `requiresAnyTag`、`consumesItem`、`breakable` の `drops` は読み込み時に拒否する。フラグを書かない仕掛けの状態は `obj:<roomId>:<objectId>` のフラグで持つ（ADR-0021）。

| 種別 | パラメータ |
| --- | --- |
| `door` | `toRoomId`, `spawnId`, `effect` |
| `gate` | `requiresFlag`（M3-3。立ったら開く）、`requiresAnyTag?` と `consumesItem?`（後で） |
| `switch` | `setsFlag`（剣で叩いて一度だけ立てる） |
| `savePoint` | なし |
| `warp` | `toRoomId`, `spawnId`, `effect` |
| `pickup` | `itemId`, `count`, `onceFlag?`（触れると拾う） |
| `text` | `key` |
| `breakable` | `requiresAnyTag`、`flag?`、`drops?`（後で） |
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
  "hazards": {
    "water": { "damage": 1, "intervalTicks": 60, "byTag": [{ "anyTag": ["move:swim"], "intervalTicks": 300 }] }
  },
  "inventory": { "scope": "shared" },
  "gating": { "subject": "active" },
  "save": { "slots": 3, "autosave": { "onRoomTransition": true } },
  "respawn": { "enemies": "onEnter" },
  "interact": { "action": "up" },
  "physics": { "entityPush": false }
}
```

`inventory.scope` は M3-3 では `shared` だけを読む（`perCharacter` は M3-5）。`gating.subject`（無ければ `active`）は、仕掛けと出口の能力タグの条件を、操作中のキャラクター（`active`）か倒れていないメンバーのだれか（`anyInParty`）の有効なタグで判定する。有効なタグはキャラクターのタグと、持っているアイテムの `grants`（ADR-0021）。

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

各プロファイルに `media` を書くと、媒体（タイルの `medium`）の中だけ操作感を上書きできる（M2-5、ADR-0016）。値の単位はプロファイルの本体と同じ。`swim: true` の媒体の中では、接地していなくても何度でもジャンプ（水をかく）できる。

```json
"media": {
  "water": { "runSpeed": 0.8, "gravity": 0.05, "maxFallSpeed": 0.8, "jumpVelocity": 1.6, "airControl": 1, "airAccel": 0.1, "airDecel": 0.05, "swim": true }
}
```

操作感は「プロファイル → キャラクターの `feelOverrides` → 媒体の上書き」の順に重ねる（後ろが優先）。

各プロファイルの `climbSpeed?`（px/tick）と `climbJumpVelocity?`（px/tick）は、はしごの昇り降りの速さと、跳んで離れるときの上向きの速さ（M3-2b、ADR-0019）。`climbSpeed` の無いプロファイルでははしごにつかめない。

各プロファイルの `attackOnGround?: 'stop' | 'move'`（無ければ `move`）は、地上で攻撃している間にその場で止まるか、歩きながら振れるか（M2-5、ADR-0017）。`attackBufferTicks?`（tick、無ければ 0）は攻撃の先行入力で、振り終わりの何 tick 前までの押下を覚えて次の振りにつなぐか（M3-2c、ADR-0017 の改訂）。

`rules.json` の `hp` と `hazards`（M2-5、ADR-0016）:

- `hp: { scope: 'perCharacter', onDeath: 'switchToAlive' | 'respawnAtSavePoint', onAllDown: 'respawnAtSavePoint' }`。無ければ HP は無い。`shared` と `gameOver` は M3-5。
- `hazards: Record<string, { damage, intervalTicks, byTag?: Array<{ anyTag, damage?, intervalTicks? }> }>`。触れ続けて `intervalTicks` tick ごとに `damage` 減る。`byTag` は上から順に見て、操作中のキャラクターの有効タグにどれかが含まれる最初の要素で上書きする。
- `hazards` があるのに `hp` が無い、タイルの `hazard` が `hazards` に無い、`hp` があるのにパーティのメンバーに `hp.max` が無い、は読み込み時のエラーにする。タイルの `medium` がプロファイルの `media` に無いのは正しい（その媒体では動きが変わらない）。

### 4.7 `input.json`

```ts
interface InputDefaults {
  keyboard: Partial<Record<ActionId, string[]>>;      // KeyboardEvent.code
  gamepad: { standard: Partial<Record<ActionId, GamepadInputId[]>> };
  analog: { deadzone: number; release: number };     // 0..1。release < deadzone（ヒステリシス）
  touch: TouchDefaults;                               // 仮想パッド（M2-1）
}
interface TouchDefaults {
  layout: string;                                     // 既定で使うレイアウトの名前（layouts のキー）
  layouts: Record<string, TouchLayout>;
}
interface TouchLayout {
  handedness: 'right' | 'left';                       // left は cx を左右反転して置く
  opacity: number;                                    // 0..1。横向きでゲーム画面に重ねるときの不透明度
  dpad: { cx: number; cy: number; radius: number; deadzoneRatio: number; floating: boolean };
  buttons: Array<{ action: ActionId; cx: number; cy: number; radius: number }>;
}
// cx, cy はパッド領域内の相対座標（0..1）。radius はパッド領域の短辺に対する比率。
// 円（押下領域は見た目の 1.2 倍）がパッド領域からはみ出す位置は、内側に寄せて置く。ボタンのアイコンは action からエンジンが決める。
type GamepadInputId =
  | `button${number}`
  | 'dpadUp' | 'dpadDown' | 'dpadLeft' | 'dpadRight'
  | 'leftStickUp' | 'leftStickDown' | 'leftStickLeft' | 'leftStickRight'
  | `axis${number}+` | `axis${number}-`;            // 軸の向き（M2-2。非標準パッドとほかの軸）
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
  "touch": {
    "layout": "default",
    "layouts": {
      "default": {
        "handedness": "right",
        "opacity": 0.5,
        "dpad": { "cx": 0.13, "cy": 0.72, "radius": 0.22, "deadzoneRatio": 0.25, "floating": false },
        "buttons": [
          { "action": "jump", "cx": 0.9, "cy": 0.76, "radius": 0.12 },
          { "action": "switch", "cx": 0.76, "cy": 0.56, "radius": 0.09 }
        ]
      }
    }
  }
}
```

- `touch.layout` は `touch.layouts` にある名前でなければならない（読み込み時に検査する）。
- パックで使わない action のボタンは置かない（例: 攻撃の無いパックに `attack` を置かない）。

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

- `roomTransition?: { effect: "fade" | "cut", lockTicks: int >= 0 }`（M3-1、ADR-0018）: 部屋を移るときの演出と、その間に入力を無視して止める tick 数。`fade` は前半で暗くなり、後半で明るくなる。`cut` は演出なしで、`lockTicks` の間だけ止まる。無ければ `{ "effect": "cut", "lockTicks": 0 }`。
- カメラ（M3-2、ADR-0009 の改訂履歴）: `mode` が `scroll` なら `scroll`、`screenFlip` なら `screenFlip` が必要。`activationMarginPx?`（既定 0）は敵とギミックを活性にする範囲の広げ幅（M3-4 で使う）。
- `scroll.followY?: "always" | "grounded"`（既定 `always`）: `grounded` は、地上にいるときだけ縦を合わせ、空中ではデッドゾーンを出たときだけ追う。
- `scroll.snapToTileRows: true` はまだ使えない（読み込み時に拒否する）。
- 部屋はビュー（プレイ領域）より大きくてよい。カメラは部屋の境界の内側に収める。

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

フラットなキーと文字列。他のデータからは `@strings:key` で参照する。言語の選択は app 層（ブラウザの言語。パックに無い言語なら `files.strings` の最初の言語）。M3-6a でキャラクターの `name` から使い始めた（ADR-0020）。参照したキーがどれかの言語に無ければ読み込み時のエラー。

```json
{ "char.knight": "騎士", "char.scout": "斥候", "item.swim-charm": "泳ぎのお守り", "text.hub.welcome": "ここが拠点だ。" }
```

### 4.11 `ui.json`（M3-6、ADR-0020）

メニューのフォントと色。無いパックではメニューを開かない（`menu` と歯車は設定画面を開く）。

```jsonc
{
  "font": {
    "image": "../ui/font.png",      // このファイルからの相対パス
    "cellW": 12, "cellH": 13,       // 1 文字のセル（px）。画像の左上から行ごとに並べる
    "ascent": 11,                   // セルの上端からベースラインまで
    "glyphs": [["A", 6], ["あ", 12]] // 文字と描くときの幅（px）。並びは画像のセルの順。"?" は必須
  },
  "colors": {
    "border": "#ffffff", "fill": "#182860", "text": "#ffffff", "accent": "#ffe678",
    "dim": "#7880a0", "cursor": "#ffffff", "gauge": "#f05a50", "gaugeBack": "#1c1216"
  }
}
```

- フォントに無い文字は `?` の字形で描く。

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
| `ladder` | なし | `ladder: true`。最上段（真上がはしごでない）は上に立てるすり抜け床として扱う（M3-2b、ADR-0019） |
| 任意 | `requiresAnyTag: "move:swim,size:small"` | `requiresAnyTag`（カンマ区切り） |
| 任意 | `hazard: "water"` | `hazard`（触れると HP が減る種類。`rules.json` の `hazards` のキー。ADR-0016） |
| 任意 | `medium: "water"` | `medium`（媒体。`feel.json` の各プロファイルの `media` のキー。ADR-0016） |

例: 全員が入れて HP が減る水は、クラス空 + `hazard: "water"` + `medium: "water"`。泳げるキャラだけが通れる水は `class: "solid"` + `requiresAnyTag: "move:swim"`。狭い通路は `class: "solid"` + `requiresAnyTag: "size:small"`。

`hazard` と `medium` は、体（当たり判定の箱）の中心の点があるタイルで判定する。接触ダメージのクラス `hazard`（`damage: int`）は廃止した（敵や棘の接触ダメージは M3-4）。

### 5.4 オブジェクト規約

| レイヤ | `class` | プロパティ |
| --- | --- | --- |
| `entities` | `spawn` | `name` = spawnId |
| `entities` | `enemy` | `enemyId`, `facing: "left" \| "right"` |
| `entities` | `gimmick` | `gimmickId`, 種別ごとの追加（`toRoomId`, `spawnId`, `itemId`, `key` など。`gimmicks.json` の定義を上書きできる） |
| `zones` | `event` | `trigger: "onZoneEnter" \| "onZoneExit"`, `conditions`（JSON 文字列。`{ "flag", "is" }`、`{ "hasItem", "count"? }`、`{ "notItem" }`）, `actions`（JSON 文字列。`{ "setFlag", "value"? }`、`{ "giveItem", "count"? }`、`{ "takeItem", "count"? }`）（M3-3、ADR-0021） |
| `zones` | `camera` | `lockY: bool` などの部屋内オーバーライド（M3） |
| `exits` | `exit` | `kind: "edge" \| "door" \| "warp"`, `toRoomId`, `spawnId`, `effect?: "fade" \| "cut"`, `requiresAnyTag?`, `requiresFlag?`（M3-3） |

- オブジェクトの位置は Tiled の矩形左上。エンティティの初期位置は矩形の底辺中央に変換する。
- `name` は Tiled 上の識別に使い、エンジンは `spawn` 以外では参照しない。
- 部屋外周は solid。`kind: "edge"` の exit は外周（左右上下のどれか）に接する矩形として置く（読み込み時に検査する）。抜けられるように、出口の部分の `main` のタイルは空けておく。
- 出口（M3-1、ADR-0018）: 体が矩形と重なると入る。`edge` と `warp` は重なっただけで、`door` は地上で `up` を押したとき。`requiresAnyTag` があれば、そのどれかのタグを持つキャラクターだけが入れる。部屋に着いたときに体と重なっていた出口は、一度離れるまで入れない。`effect` が無ければ `camera.json` の `roomTransition.effect`。`effect: "scroll"` は M3-2 で、それまでは読み込み時に拒否する。`requiresFlag` があれば、そのフラグが立つまで入れない（M3-3、ADR-0021）。
- `toRoomId` と `spawnId` は存在しなければならない（同じ部屋でもよい）。

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

補足（M1-5 の実装）:

- 1 回の読み込みで、見つかったエラーをまとめて報告する。壊れたファイルに依存する検査（そのタイルセットを使う部屋など）は飛ばし、二次的なエラーを出さない。
- 部屋の ID は `.tmj` のファイル名（拡張子を除く）。
- タイルとオブジェクトのクラスは、Tiled 1.10 以降が書く `type` と、1.9 が書く `class` のどちらでも読む。
- px から Fx への変換は `Math.round(v × 256)`。tick 数はそのまま整数で持つ。
- ファイルの到着順に依存せず、`pack.json` に並べた順に処理する（同じパックからは常に同じ `PackRuntime` とエラー一覧になる）。

## 9. バージョニングと互換

- `formatVersion` の minor 更新は後方互換の追加のみ（新しい任意フィールド、新しい Primitive）。major 更新では `pack/src/migrate/` に変換関数を置く。
- `engine.formatVersion` はパックが要求する仕様範囲。エンジンが範囲外なら理由を表示して拒否する。
- `saveCompat` はパックが読み込めるセーブの `packVersion` の範囲。範囲外のセーブは読み込みを拒否し、エクスポートを案内する。

## 10. 外部パックの読み込み

| ソース | 指定方法 | 備考 |
| --- | --- | --- |
| `builtin` | 既定 | リポジトリの `packs/sample/`。`apps/player` のビルドで `packs/sample/` として配信する（M1-5） |
| `url` | `?pack=https://example.net/my-pack/` | 末尾 `/` のディレクトリ URL。CORS（`Access-Control-Allow-Origin`）が必要。http は拒否 |
| `localDirectory` | 設定画面の「フォルダを開く」 | File System Access API。未対応ブラウザは `<input webkitdirectory>`。iOS は zip を選択 |
| `cached` | 設定画面の一覧 | 読み込み済みパックを IndexedDB から復元 |

- 初回読み込み時に出所（URL またはフォルダ名）、`name`、`version`、`licenses` を表示して確認を求める。
- 読み込んだ外部パックは `url + version` をキーに IndexedDB に保存し、オフラインでも選べる。
- 外部パックのコードは読み込まない。`scripts/` があっても無視し警告する。

## 11. ライセンスとクレジット

- リポジトリ同梱のサンプルパックは、コード MIT、素材 CC0。
- `credits.json` に素材ごとの出所、作者、ライセンス、改変の有無を記録する。`notes`（任意の説明）を付けてよい。

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
2. タイルセットにクラス（`solid` / `oneway` / `ladder`）と、プロパティ（`requiresAnyTag`、`hazard`、`medium`）を付ける。
3. Tiled で部屋を作る。レイヤ名は規約どおり。`spawn` を少なくとも 1 つ置く。
4. `characters.json` に能力タグとアニメーションを定義する。1 人でもよい。
5. `rules.json` でパーティ、HP、所持品、切替を選ぶ。
6. `feel.json` にプロファイルを 1 つ以上書く。
7. `pnpm pack:validate <dir>`（M4 で `pack-cli validate`）で検証する。
8. `credits.json` を埋める。

## 13. 付録: サンプルパックの部屋構成（M1〜M3 の題材）

| 部屋 | 役割 | 検証する機能 |
| --- | --- | --- |
| `hub` | 拠点。セーブポイント、東の施錠扉（`small-key`）、西の低い通路（`size:small`）、水（全員が入れて HP が減る。`move:swim` は減るのが遅い。M2-5） | 能力タグ通行、ゲート、セーブ、2 人切替 |
| `cave-01` | 最初のダンジョン。`walker` 数体、`breakable`（`break:rock`）、すり抜け床、`swim-charm` の宝箱 | 敵の振る舞い、hit/hurt、アイテムによるタグ付与、oneway |
| `cave-boss`（M3） | ボス部屋。`bossDoor`、撃破で `small-key` ドロップ | ボスフラグ、ドロップ、部屋遷移 |

M1 では `hub` の 1 画面相当（320×160 px のプレイ領域 1 枚）だけを使う。
