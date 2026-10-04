# infra

配信基盤（S3 + CloudFront、GitHub OIDC、IAM ロール 2 本）を AWS CDK（TypeScript）で定義するディレクトリです。

## 現在の状態

M0 時点では空です。`package.json` もまだありません。実装は [M1-1](../docs/roadmap.md) で追加します。

## 方針

- エンジンのパッケージ（`packages/*`、`apps/*`、`packs/*`）から独立させます。互いに import しません（`.dependency-cruiser.cjs` の `layer-infra` ルールで検査）。
- `cdk deploy` はリポジトリ所有者が手元で実行します。CI からはインフラを変更しません。
- 構成、IAM ロールの trust と権限、準備手順は [ADR-0014](../docs/decisions/ADR-0014-deploy-and-infra.md) と [roadmap の M1-1](../docs/roadmap.md) に記載しています。
- CDK の API 名は、実装時に `node_modules/aws-cdk-lib` の型定義で確認します。
