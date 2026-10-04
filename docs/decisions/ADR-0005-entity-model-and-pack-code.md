# ADR-0005: エンティティモデルとパック同梱コード

- Status: Accepted（外部パックのコード実行は Deferred。M5 で再検討）
- Date: 2026-10-04
- 論点: C

## 背景

敵やギミックの振る舞いを、どこまで宣言的データで表し、どこからコードにするかを決める必要がある。エンティティは 1 部屋あたり 100〜200 体程度を想定し、決定論（走査順の固定、`snapshot/restore`）と可読性を優先する。

## 選択肢

### エンティティの表現

| 案 | 長所 | 短所 |
| --- | --- | --- |
| 本格 ECS（bitecs 等の外部ライブラリ） | 大量エンティティに強い | 外部依存。内部の走査順やメモリ配置を制御しにくく、決定論とデバッグ性に不安 |
| 軽量コンポーネント表 + システム関数（自前） | 依存ゼロ、走査順を自分で決められる、`snapshot` が配列コピーで済む | 超大規模には不向き |
| クラス継承 | 直感的 | 振る舞いの組合せ爆発、データ駆動と相性が悪い |

### 振る舞いの表現

| 案 | 長所 | 短所 |
| --- | --- | --- |
| すべてコード（パックが TS で敵を書く） | 自由度最大 | パック差し替えだけで再現、の要件に反する。外部パックのコード実行はセキュリティ問題 |
| すべて宣言データ | 安全、検証可能 | 表現力の限界。独自ボスなどで行き詰まる |
| 宣言データを主、コードを拡張点として限定的に許す | 両立 | API の設計と凍結が必要 |

## 決定

### エンティティ: 軽量コンポーネント表

- エンティティは整数 id。部屋ごとに単調増加で払い出し、削除は tombstone。部屋に入るときに圧縮する。これにより dense index の順序が id 昇順と一致し、走査順の決定論が保たれる。
- ホットなコンポーネント（位置、速度、AABB、衝突フラグ、タイマー）は typed array の SoA。コールドなコンポーネント（振る舞い状態、所持品、表示情報）はオブジェクト。`snapshot` は配列コピーと構造化複製。
- システムは `(world, runtime) => void` の関数で、`architecture.md` 4.3 の固定順で実行する。
- 外部 ECS ライブラリは使わない。内部表現は `EntityStore` の背後に隠し、必要になれば差し替えられるようにする。

### 振る舞い: 3 層

1. **宣言データ（JSON、v1 の主役）**: `BehaviorSpec` は状態機械。

   ```ts
   interface BehaviorSpec {
     initial: string;
     states: Record<string, {
       actions: Primitive[];                   // 毎 tick 順に評価
       transitions: { when: Condition; to: string }[]; // 先頭から評価、最初に真になったものへ遷移
     }>;
   }
   ```

   Primitive（エンジン同梱）: `idle`, `patrol{speed}`, `turnAtEdge`, `turnAtWall`, `chase{speed, range}`, `flee{speed, range}`, `jumpEvery{ticks, velocity}`, `shootEvery{ticks, projectile, direction}`, `sineFloat{amplitude, periodTicks, table}`, `bounce{velocity}`, `faceTarget`, `setAnim{name}`, `emit{event}`。
   Condition（tagged union）: `playerWithin{px}`, `playerBeyond{px}`, `hpBelow{ratio}`, `timer{ticks}`, `onGround`, `touchingWall`, `hit`, `flag{key, equals}`, `always`, `not{...}`, `all[...]`, `any[...]`。
   文字列 DSL は採用しない。zod で検証でき、決定論的に評価できる形に限定する。

2. **ギミック（エンジン組込み種別 + パラメータ）**: `door`, `gate{requiresAnyTag | flag}`, `switch{setsFlag}`, `savePoint`, `warp{to}`, `pickup{item}`, `text{key}`, `breakable{requiresAnyTag}`, `movingPlatform{path}`（M5）, `spawner`, `bossDoor`。

3. **コード（パック同梱モジュール）**: **v1（M1〜M4）では採用しない**。下記 Deferred を参照。

## Deferred: パック同梱コードと外部パックのコード実行

v1 では見送り、M5 で再検討する。再検討時の出発点として案を記録する。

- 想定 API: パックの `scripts/index.js` が `definePackScripts({ behaviors: { [name]: BehaviorFn }, gimmicks: { [name]: GimmickFn } })` を export し、`BehaviorRegistry` に登録する。関数は `(ctx: BehaviorContext) => void` で、`ctx` は World の読み取りクエリ、コマンド発行（`setVelocity`, `spawn`, `emit`）、`ctx.rng`、`ctx.tick` に限定する。
- 制約: 描画、DOM、非同期、`Math.random`、`Date` を禁止（lint と、関数に渡すオブジェクトを `Object.freeze` した読み取り専用ビューに限定するランタイムガード）。
- 信頼モデル: コードを実行するのは「リポジトリ同梱パック」と「ユーザが設定画面で明示的に許可した外部パック」のみ。既定では外部パックのコードは読み込まない。
- 見送る理由: (1) URL から取得したコードの実行はセキュリティ上の判断が必要、(2) Registry API は M3 の振る舞い実装を経てから凍結したい、(3) data-only で M1〜M4 の要件を満たせる。

## 結果

- 得られるもの: 検証可能で決定論的な振る舞い定義、外部ライブラリなしの単純な実装、`snapshot` の低コスト。
- 失うもの: 独自ボスなどコードが必要な表現は M5 まで待つ。それまでは Primitive と Condition の追加で対応し、追加のたびに pack-spec を更新する。
- フォローアップ: Primitive と Condition の一覧は `docs/pack-spec.md` を正とし、追加時は同じ PR で更新する。

## 要確認

- なし（外部パックのコード実行は Deferred として M5 で再検討）。
