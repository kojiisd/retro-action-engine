# ADR-0014: 配信基盤（S3 + CloudFront、OIDC、CDK）

- Status: Accepted
- Date: 2026-10-04
- 論点: J（デプロイ）

## 背景

本番と PR プレビューを早い段階から実機とゲームパッドで触れるようにしたい。配信は S3 + CloudFront。AWS リソースは CDK（TypeScript）で `infra/` に置き、適用はリポジトリ所有者が手元で行う。GitHub Actions からは OIDC で認証する。

## 選択肢

| 論点 | 案 | 採用 |
| --- | --- | --- |
| プレビューの置き場所 | 別バケット / 同一バケットの `pr-<n>/` プレフィックス / 外部 PaaS | 同一バケットのプレフィックス。本番と同じ経路で確認できる |
| 認証 | 長期キー / OIDC | OIDC |
| IAM ロール | 1 本 / 本番用とプレビュー用の 2 本 | 2 本。trust と権限を分ける |
| 適用方法 | CI から `cdk deploy` / 所有者が手元で実行 | 所有者が手元で実行。CI にインフラ変更権限を持たせない |

## 決定

### リソース（`infra/`、CDK v2、TypeScript）

- S3 バケット: 非公開（Block Public Access）、SSL 必須、バージョニングなし。CloudFront の OAC からのみ読める。
- CloudFront Distribution: 1 つ。オリジンはバケット。CloudFront Function で `/pr-12/` のようなディレクトリ要求に `index.html` を補完する。HTTPS のみ。
- GitHub OIDC プロバイダ（`token.actions.githubusercontent.com`）: アカウントに既存があれば import する。
- IAM ロール 2 本（下表）。
- 出力: バケット名、Distribution ID、CloudFront ドメイン、ロール ARN 2 つ。GitHub の repository variables に `AWS_ROLE_ARN_PRODUCTION`, `AWS_ROLE_ARN_PREVIEW`, `S3_BUCKET`, `CF_DISTRIBUTION_ID`, `CF_DOMAIN` として登録する。
- CDK の API 名は実装時に `node_modules/aws-cdk-lib` の型定義で確認する。

| ロール | trust（OIDC の `sub` 条件） | 権限 |
| --- | --- | --- |
| `deploy-production` | `repo:kojiisd/retro-action-engine:environment:production`（GitHub Environment を使う。使わない場合は `ref:refs/heads/main`） | バケット全体の `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`。対象 Distribution の `cloudfront:CreateInvalidation` |
| `deploy-preview` | `repo:kojiisd/retro-action-engine:pull_request` | `s3:PutObject`, `s3:DeleteObject` を `arn:aws:s3:::<bucket>/pr-*` のみ。`s3:ListBucket` は `s3:prefix` が `pr-*` の条件付き。対象 Distribution の `cloudfront:CreateInvalidation` |

- 既知の制約: `cloudfront:CreateInvalidation` はパスで IAM 制限できないため、プレビュー用ロールでも `/` の無効化は技術的に可能。影響はキャッシュ破棄のみでコンテンツは書けないため許容する。
- `aud` は `sts.amazonaws.com` に固定する。

### ワークフロー

| ファイル | トリガ | 内容 |
| --- | --- | --- |
| `preview.yml` | `pull_request`（opened, synchronize, reopened, closed） | 同一リポジトリの PR のみ（fork はスキップ）。build を `VITE_BASE=/pr-<n>/` で実行 → `deploy-preview` を assume → `aws s3 sync dist s3://<bucket>/pr-<n>/ --delete` → invalidation `/pr-<n>/*` → PR にプレビュー URL をスティッキーコメント。`closed` では `aws s3 rm --recursive s3://<bucket>/pr-<n>/` |
| `deploy.yml` | `push` to `main` | GitHub Environment `production` で `deploy-production` を assume → `/` へ sync → invalidation `/*` |

- `permissions: { id-token: write, contents: read, pull-requests: write }`。
- キャッシュヘッダ: ハッシュ付きアセットは `Cache-Control: public, max-age=31536000, immutable`、`index.html` と `sw.js` と `manifest.webmanifest` は `no-cache`。
- Vite の `base` と vite-plugin-pwa のスコープがプレフィックスに追従することを M4 の smoke で確認する。

### 準備手順（所有者が手元で実行。M1-1）

1. AWS 側: `pnpm --filter infra cdk bootstrap`（初回のみ）→ `pnpm --filter infra cdk deploy`。
2. 出力値を GitHub の repository variables に登録する。
3. GitHub Environment `production` を作成する（必要なら required reviewers）。
4. `main` のブランチ保護（PR 必須、CI 必須）。
5. M1-1 の PR でプレビュー URL が付くことを確認し、プレビュー用ロールで `pr-*` 以外への put が拒否されることを AWS CLI で確認する。

## 結果

- 得られるもの: PR ごとの実機確認、最小権限の 2 ロール、本番と同じ配信経路のプレビュー、インフラ変更権限を CI に渡さない運用。
- 失うもの: fork からの PR はプレビューなし（個人リポジトリのため許容）。
- コスト: S3 と CloudFront の最小利用。プレビューの prefix は PR close で削除する。

## 要確認

- カスタムドメインと ACM 証明書を使うか（当面は CloudFront のドメインで運用）。
