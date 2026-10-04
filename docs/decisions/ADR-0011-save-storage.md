# ADR-0011: セーブ方式と保存先

- Status: Accepted
- Date: 2026-10-04
- 論点: H

## 背景

ブラウザとPWA で動くため、保存先はブラウザのストレージになる。iOS ではストレージ消去のリスクがある。将来の Capacitor 配布では保存先の差し替えが必要。セーブは 3 スロット + 部屋遷移時のオートセーブ 1 枠（決定済み）。クラウド同期は対象外。

## 選択肢

| 論点 | 案 | 採用 |
| --- | --- | --- |
| 保存する内容 | World 全体のスナップショット / チェックポイント型（進行状態のみ） | チェックポイント型。スキーマが安定し、決定論的に復元できる |
| 保存先 | localStorage / IndexedDB / Cache API | IndexedDB（`idb-keyval`）を一次、localStorage をフォールバック |
| 設定の保存 | セーブに含める / 別保存 | 別保存（端末単位） |

## 決定

### データ

```ts
interface SaveData {
  saveVersion: 1;
  packId: string;
  packVersion: string;
  slot: 1 | 2 | 3 | 'auto';
  savedAt: string;           // ISO 8601。表示用。コアには渡さない
  playtimeTicks: number;
  roomId: string;
  spawnId: string;
  party: { members: string[]; activeIndex: number };
  characters: Record<string, { hp: number; hpMax: number; alive: boolean }>;
  inventory: Record<string, number> | Record<string, Record<string, number>>; // scope による
  flags: Record<string, number | boolean>;
}

interface Settings {
  settingsVersion: 1;
  bindings: { keyboard: Record<ActionId, string[]>; gamepad: Record<string, Record<ActionId, string[]>> };
  touchLayout: TouchLayout;
  audio: { master: number; bgm: number; sfx: number };
  feelProfile: string | null;  // null はパック既定
  scaling: 'integer' | 'fit';
  interpolationOverride: 'linear' | 'none' | null;
}
```

- セーブは部屋の入口（spawn）から再開する。部屋の途中の状態（敵の位置など）は保存しない。
- `Settings` はパックに依存しない部分と、パック ID ごとの部分（バインドの上書き）に分ける。

### 保存機会

- 手動: セーブポイントのギミックで `confirm` → スロット 1〜3 を選ぶ。
- オートセーブ: 部屋遷移時に `auto` 枠へ上書き（`rules.save.autosave.onRoomTransition`）。
- ロード画面では 4 枠（1〜3 と auto）を表示する。

### 保存先

- IndexedDB（`idb-keyval`）。キーは `save:<packId>:<slot>`、`settings:global`、`settings:<packId>`。
- IndexedDB が使えない環境では localStorage に同じキーで JSON 保存する。
- `navigator.storage.persist()` を初回セーブ時に要求する。
- エクスポート / インポート: JSON ファイル（`<packId>-<slot>.json`）。iOS では共有シート経由。
- `SaveStorage` インタフェースで抽象化し、Capacitor 化時は Filesystem / Preferences 実装に差し替える。

### マイグレーション

- `saveVersion` が古い場合は `migrate` 関数で順に上げる。`packVersion` が異なる場合はパックの `saveCompat`（pack-spec）で互換範囲を宣言し、範囲外なら読み込みを拒否してエクスポートを案内する。

## 結果

- 得られるもの: 安定したセーブスキーマ、端末とパックに分かれた設定、ストレージ消去への備え。
- 失うもの: 「どこでもセーブ」で敵配置まで含む完全復元はしない（必要なら `World` の `snapshot` を使う別機能として M5 以降で検討）。
- フォローアップ: セーブ往復テスト（保存 → 読込 → 同じ `World` から同じリプレイで同じ hash）を M3 に入れる。

## 要確認

- なし。
