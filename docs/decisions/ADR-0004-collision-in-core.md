# ADR-0004: コア内の自前タイル衝突

- Status: Accepted
- Date: 2026-10-04
- 論点: B

## 背景

タイルベースのサイドビューアクションでは、衝突の挙動そのものが操作感の大部分を占める（壁ずり、すり抜け床、坂、梯子、角での引っかかり）。決定論とヘッドレステストの要件（ADR-0001, 0002）から、衝突はコアで完結している必要がある。

## 選択肢

| 案 | 長所 | 短所 |
| --- | --- | --- |
| Phaser Arcade 物理 | 実装済み、デバッグ描画あり | 浮動小数点、可変ステップ、Scene に依存しヘッドレス不可。軸分離やサブピクセルなどレトロ挙動を再現しにくい |
| Matter 物理 | 本格的な剛体 | 過剰。決定論と操作感の制御が難しい |
| 自前のタイル衝突（コア内） | 決定論、Node で完全テスト可能、原作風の挙動を直接書ける | 実装責任を負う（ただし 2D タイル衝突は枯れた領域） |

## 決定

自前のタイル衝突をコアに実装する。Phaser の `Tilemap` は描画専用。

### データ

- 部屋の衝突グリッドは `RoomData.collision: Uint16Array`（row-major、値は tileClassId）。
- `TileClass = { id, solid: 'none' | 'full' | 'oneway' | 'slope', heights?: number[], ladder?: boolean, hazard?: number, requiresAnyTag?: string[] }`。
- Tiled のタイルプロパティから `pack` の importer が生成する（pack-spec 参照）。

### エンティティの形状

- 位置は足元中央（bottom-center）の `Fx` 座標。衝突 AABB はパック定義の `{ w, h, ox, oy }`（px）で、位置から相対に求める。
- hit / hurt ボックスはアニメーションフレームごとに定義し、`interaction` システムで AABB 重なりを判定する。衝突解決には使わない。

### 移動と解決（`movement` システム）

1. X 軸: `dx` を最大 1 タイル幅ずつのサブステップに分け、各ステップ後に進行方向の辺が重なるタイル列を調べる。有効な solid があれば辺をタイル境界にスナップし、`vx = 0`、`touchingWall` を立てて終了。
2. Y 軸: 同様に `dy` をサブステップで処理。下向きの衝突で `grounded`、上向きで `headBump`。
3. 1 tick の移動量がタイル幅を超えても貫通しない。
4. 有効な solid の判定には `CollisionContext { abilityTags: ReadonlySet<string> }` を渡す。`requiresAnyTag` を持つタイルは、タグを 1 つも満たさないエンティティに対して solid、満たすエンティティに対して `solid: 'none'` として扱う。これにより「泳げる者だけ水中へ」「小さい者だけ狭い通路へ」「壊せる者だけブロックを突破（接触時に破壊イベント）」を同じ仕組みで表す。
5. 部屋の外周は solid として扱う。外周の出口は `exits`（zones）で表す。

### 特殊タイル

| 種別 | 規則 | 導入 |
| --- | --- | --- |
| `oneway` | 下向き移動中かつ「前 tick の足元 Y がタイル上面以上」のときのみ衝突。`down + jump` で `dropThroughTicks` の間は無視する | M1-2 |
| `slope` | `heights[tileSize]` で列ごとの表面高さを持つ。接地中は X 移動後に表面高さへ Y をスナップ。坂を下るときの浮き防止に `slopeSnapPx` を持つ。坂の上面は oneway と同じく上からのみ | M5 |
| `ladder` | 通行可能。キャラクター状態機械が `up/down` 入力で `climb` に遷移する条件になる。梯子の最上段は oneway として扱う | M5 |
| `hazard` | 通行可能。`interaction` で接触ダメージ | M3 |

### エンティティ間

- 物理的な押し合いは既定で行わない（原作風）。`rules.physics.entityPush`（M3）で有効化できる。
- 移動床（M5）は `carrier` を持つエンティティ。`movement` は carrier を先に動かし、前 tick に上面に接地していた乗り手を同じ差分だけ動かす。順序は role（carrier → rider）、同 role 内は id 昇順。

### 決定論

- すべて `Fx` と整数で計算する。走査順は id 昇順。
- 衝突結果（`grounded`、`touchingWall`、`headBump`、`onOneway`、`onLadder`）は `World` に保存し、次 tick の判定（コヨーテタイムなど）に使う。

## 結果

- 得られるもの: ヘッドレスで検証できる衝突、能力タグによる通行判定の一本化、原作風の挙動の直接表現。
- 失うもの: Phaser Arcade のデバッグ描画。代わりに描画層に `debug: true` で AABB を描くモードを用意する（M2）。
- テスト: Property テスト（ランダムな部屋とランダムな入力列で solid に埋まらない、サブステップで貫通しない、入力を鏡像にすると軌道も鏡像）、oneway と `CollisionContext` の Unit テスト。

## 要確認

- 坂を `heights` 配列で表すか、角度種別の列挙（45°、22.5° 上下）に限定するか。配列は任意形状が書けて Tiled のプロパティで表現できるため配列を第一候補とする。M5 で確定。
