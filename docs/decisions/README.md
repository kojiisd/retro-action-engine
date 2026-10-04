# Architecture Decision Records

設計上の主要な判断を ADR として記録する。1 ファイル 1 判断。判断を変える場合は既存の ADR を書き換えず、新しい ADR を追加して旧 ADR の Status を `Superseded by ADR-XXXX` にする。

## 一覧

| ADR | タイトル | 論点 | Status |
| --- | --- | --- | --- |
| [ADR-0001](ADR-0001-core-render-boundary.md) | コアと描画の境界 | A-2, A-4 | Accepted |
| [ADR-0002](ADR-0002-fixed-point-determinism.md) | 8.8 固定小数点と決定論の規則 | A-1 | Accepted |
| [ADR-0003](ADR-0003-fixed-timestep-interpolation.md) | 固定タイムステップと補間描画 | A-3 | Accepted |
| [ADR-0004](ADR-0004-collision-in-core.md) | コア内の自前タイル衝突 | B | Accepted |
| [ADR-0005](ADR-0005-entity-model-and-pack-code.md) | エンティティモデルとパック同梱コード | C | Accepted（外部パックのコード実行は Deferred） |
| [ADR-0006](ADR-0006-pack-format-and-schema.md) | パック形式とスキーマ検証 | D | Accepted |
| [ADR-0007](ADR-0007-party-gating-world.md) | パーティ、能力ゲーティング、ワールド構造 | E | Accepted |
| [ADR-0008](ADR-0008-input-architecture.md) | 入力アーキテクチャ（エッジ規則と再同期を含む） | F | Accepted |
| [ADR-0009](ADR-0009-camera-modes.md) | カメラの 2 モード | 必須要件 4 | Accepted |
| [ADR-0010](ADR-0010-pwa-mobile.md) | PWA とモバイルの制約 | G | Accepted |
| [ADR-0011](ADR-0011-save-storage.md) | セーブ方式と保存先 | H | Accepted |
| [ADR-0012](ADR-0012-test-strategy.md) | テスト戦略 | I | Accepted |
| [ADR-0013](ADR-0013-monorepo-tooling.md) | モノレポ構成とツール | J | Accepted |
| [ADR-0014](ADR-0014-deploy-and-infra.md) | 配信基盤（S3 + CloudFront、OIDC、CDK） | J | Accepted |

## 書式

```markdown
# ADR-XXXX: タイトル

- Status: Proposed | Accepted | Deferred | Superseded by ADR-YYYY
- Date: YYYY-MM-DD
- 論点: 設計依頼の論点記号（A-1 など）

## 背景
なぜ判断が必要か。制約と前提。

## 選択肢
比較表または箇条書き。長所と短所。

## 決定
採用した案と、その具体的な規則。

## 結果
得られるもの、失うもの、フォローアップ、他 ADR への影響。

## 要確認
確信が持てない点、実装時または実機で確定させる点。無ければ「なし」。
```

## Status の意味

| Status | 意味 |
| --- | --- |
| Proposed | 提案中。実装の根拠にしてはいけない |
| Accepted | 採用。実装はこれに従う |
| Deferred | 判断を先送り。再検討のマイルストーンを本文に書く |
| Superseded | 新しい ADR に置き換えられた。履歴として残す |
