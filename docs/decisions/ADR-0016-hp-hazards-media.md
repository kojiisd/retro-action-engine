# ADR-0016: HP、触れると HP が減るタイル、水中の動き

- Status: Accepted
- Date: 2026-11-21
- 論点: M2-5（M3-4 と M3-5 の一部の前倒し）

## 背景

所有者の判断（2026-11-20）で、HP、HP の表示、水、攻撃モーションを M3 から前倒しする。水は「全員が入れて、入っている間 HP が減り、減る速さがキャラクターによって違う」ものにする。これまでのサンプルパックの水は「`move:swim` のタグが無ければ壁」だった。

M2-5 は 2 つの PR に分ける。本 ADR は前半（HP、触れると HP が減るタイル、水中の動き、HP が 0 になったとき、HP の表示）を決める。攻撃は後半の PR で別に決める。

所有者の確認（2026-11-21）:

- HP が 0 になったら、生きているもう 1 人に交代する。全員が倒れたら部屋の入口からやり直す。
- 数値は「ゆるめ」: HP は 2 人とも 8。水の中で、タグの無いキャラクターは 1 秒（60 tick）ごとに 1、`move:swim` のキャラクターは 5 秒（300 tick）ごとに 1 減る。
- HP の表示は、HP 1 つぶんを小さな四角 1 つで表し、減ったぶんを暗くする（画像を使わず、文字も出さない）。
- 水の中では動きも変える（ゆっくり落ちる、動きが遅くなる、何度でも水をかいて上がれる）。

制約: エンジンに固有値（タグ名、ダメージ量、間隔、水という名前）を書かない（CLAUDE.md）。キャラクター ID による分岐は禁止で、能力タグで判定する。決定論（ADR-0002）を守る。

## 選択肢

減る速さをどこに書くか。

| 案 | 概要 | 長所 | 短所 |
| --- | --- | --- | --- |
| 1 | タイルに `damage` と間隔を書き、キャラクターに「耐性」の数値を書く | 書く場所が少ない | キャラクターごとの値になり、能力タグで判定する方針（ADR-0007）から外れる |
| 2 | タイルには種類の名前（`hazard: "water"`）だけを書き、`rules.json` の `hazards` に種類ごとのダメージと間隔と、能力タグによる上書きを書く | 能力タグで判定できる。同じ種類のタイルを部屋をまたいで一度に調整できる | ファイルが 2 つに分かれる |

水中の動きをどこに書くか。

| 案 | 概要 | 長所 | 短所 |
| --- | --- | --- | --- |
| A | タイルに動きの値を書く | 1 か所で済む | 操作感プロファイル（retro / modern）ごとに変えられない |
| B | タイルには媒体の名前（`medium: "water"`）だけを書き、`feel.json` の各プロファイルに `media` として媒体ごとの上書きを書く | プロファイルごとに調整できる。操作感の値は `feel.json` にまとまる | 名前の対応をパックの読み込み時に確かめる必要がある |

## 決定

案 2 と案 B を採る。

### パックのデータ

- **タイル**（Tiled のタイルのプロパティ。クラスに関係なく付けられる）
  - `hazard: string`: 触れると HP が減る種類の名前。`rules.json` の `hazards` のキー。
  - `medium: string`: 媒体の名前。`feel.json` の各プロファイルの `media` のキー。プロファイルに無い媒体では動きは変わらない。
  - これまでのクラス `hazard`（`damage: int` の接触ダメージ）は使われていないので廃止する。敵や棘の接触ダメージと無敵時間は M3-4 で決める。
- **`rules.json`**
  - `hp?: { scope: 'perCharacter', onDeath: 'switchToAlive' | 'respawnAtSavePoint', onAllDown: 'respawnAtSavePoint' }`。無ければ HP は無い（減らない、表示しない）。`scope: 'shared'` と `gameOver` は M3-5 で足す。
  - `hazards?: Record<string, { damage: int, intervalTicks: int, byTag?: Array<{ anyTag: string[], damage?: int, intervalTicks?: int }> }>`。`byTag` は上から順に見て、操作中のキャラクターの有効タグ（ADR-0007）にどれかが含まれる最初の要素で上書きする。
  - `hazards` があるのに `hp` が無いパック、タイルの `hazard` が `hazards` に無いパックは、読み込み時にエラーにする。
- **`characters.json`**: `hp: { max: int }`。`rules.hp` があるパックでは、パーティの全員に必須。
- **`feel.json`**: 各プロファイルに `media?: Record<string, Partial<FeelMotion> & { swim?: boolean }>`。値の単位はプロファイルの本体と同じ（px と tick）。

### 判定の位置

- 体（当たり判定の箱）の中心の点が入っているタイルで判定する。中心は `x + ox + floor(w / 2)`、`y + oy + floor(h / 2)`（Fx）。タイル座標へは床関数（`>>`）で変換する。
- 部屋の外の点は、媒体も `hazard` も無いものとする。

### 動き（`controller` の前に媒体を決める）

- その tick の最初の体の位置（前の tick の `movement` の後）で媒体を決める。
- 操作感は「プロファイル → キャラクターの上書き（`feelOverrides`）→ 媒体の上書き（`media[id]`）」の順に重ねる（後ろが優先）。
- `swim: true` の媒体の中では、接地していなくてもジャンプでき、そのたびに `jumpVelocity`（媒体の上書き後の値）で上へ水をかく。コヨーテタイムと「接地からのジャンプは 1 回」の制限は、媒体の中では見ない。ジャンプの先行入力は通常どおり。

### HP と、触れると HP が減るタイル（`interaction`）

- `World.party` に `hp: number[]`（`members` と同じ順）、`hazardId: string`（いま触れている種類。無ければ空文字）、`hazardTicks: number`（その種類に続けて触れている tick 数）を足す。
- `interaction` システム（docs/architecture.md 4.3 の 6 番）で、`movement` の後の体の中心の位置を見る。
  - 種類が前の tick と同じなら `hazardTicks` を 1 増やし、`intervalTicks` に達したら操作中のキャラクターの HP を `damage` 減らして `hazardTicks` を 0 に戻す。最初の 1 回は、入ってから `intervalTicks` tick 後に減る。
  - 種類が変わったら（出た場合も）`hazardTicks` を 0 にする。
- 交代したときと入口からやり直したときも `hazardTicks` を 0 にする。

### HP が 0 になったとき（`interaction` の続き）

- 操作中のキャラクターの HP が 0 以下になったら（HP は 0 で止める）:
  - `onDeath: 'switchToAlive'`: `members` の順で次の生きているメンバーに交代する。cooldown、接地の条件は見ない。位置は `party.switch.placement` に従う。交代後の cooldown は `cooldownTicks`。
  - 生きているメンバーがいないとき、または `onDeath: 'respawnAtSavePoint'` のとき: `onAllDown` に従う。
- `onAllDown: 'respawnAtSavePoint'`: セーブポイント（M3-5）が無い間は、パーティが部屋に入った位置（`party.spawnX`、`spawnY`）に戻す。全員の HP を最大にし、速度を 0、操作中のキャラクターはそのまま、`controller` の記憶を初期化する（操作感プロファイルは保つ）。描画は補間しない（`teleported`）。
- 手動の交代（`party` システム）は、倒れたメンバーを飛ばして次の生きているメンバーへ移る。ほかに生きているメンバーがいなければ交代しない。
- `UiState` に `party: Array<{ id, hp, hpMax, alive }>` を足す（docs/architecture.md 6 のスケッチどおり）。HP の無いパックでは空配列。

### hash（ADR-0002）

`party` の中の `spawnY` の後に、`hp` の件数（int32）と各値（int32）、`hazardId`（文字列）、`hazardTicks`（int32）の順に足す。

### HP の表示（renderer-phaser）

- HUD 帯のキャラクターのアイコンの右に、HP の最大値の数だけ小さな四角を並べ、残りを明るく、減ったぶんを暗く描く。倒れたメンバーのアイコンは暗くする。図形は Phaser の Graphics で描き、画像と文字は使わない。四角の大きさと間隔は描画の配置の定数（`HUD_PAD` と同じ扱い）。

### 解析ツール（ADR-0015）への影響

証明は行ける範囲を広く見積もる側にだけ倒す。

- 操作感プロファイルに `media` があるときは、上昇量の上限を持たない（`riseBound` を無限大にし、高さの証明 `tooHigh` と `provenNo` を出さない）。水をかけば上限なく上がれるため。
- 部屋に `hazard` のタイルがあり `rules.hp` があるときも、`riseBound` を無限大にする。倒れて入口に戻ることで、高さに関係なく「戻れる」ため。
- 「閉じている」（`enclosed`）の証明は変わらない（媒体と `hazard` のタイルは衝突に関係しない）。

## 結果

- サンプルパックの水は、全員が入れる `hazard: "water"`、`medium: "water"` のタイルになる。`move:swim` は「水で HP が減るのが遅い」という意味になる。
- `World` が変わるので、golden の 2 本を更新する（PR 本文に理由を書く）。
- 敵の接触ダメージ、無敵時間、ノックバック（M3-4）、`scope: 'shared'`、`gameOver`、セーブポイント（M3-5）は、この形に足していく。
- 攻撃（M2-5 の後半）は別に決める。

## 要確認

- 水の中の動きの具体的な値（落ちる速さ、移動の速さ、水をかく強さ）は、サンプルパックの数値として入れ、プレビューで所有者が触って調整する。
- 媒体の中で能力タグによって動きを変える（例: `move:swim` は速く泳げる）かどうかは、必要になったら決める。
