# ADR-0014: 配信基盤（S3 + CloudFront、独自ドメイン、OIDC、CDK）

- Status: Accepted
- Date: 2026-10-04（改訂 2026-10-05）
- 論点: J（デプロイ）

## 改訂履歴

| 日付 | 内容 |
| --- | --- |
| 2026-10-04 | 初版 |
| 2026-10-05 | M1-1 の実装に合わせて追記した。追記内容は次のとおり。<br>・独自ドメイン `arcade.kojiisd.jp` と、証明書のリージョン戦略（案 C）<br>・セキュリティヘッダーとプレビューの noindex<br>・OIDC プロバイダの作成と参照の切替<br>・設定ファイルとプレースホルダー検証<br>・repository variables の変更（`CF_DOMAIN` を `SITE_DOMAIN` に変更、`AWS_REGION` を追加）<br>・拒否確認の方法とパス設計の方針<br>初版の要確認「カスタムドメイン」を解消した。初版の決定を覆す変更ではなく、要確認の解消と追加なので、ADR の README の規約に対して同一 ADR への追記とした |

## 背景

本番と PR プレビューを早い段階から実機とゲームパッドで触れるようにしたい。配信は S3 + CloudFront。AWS リソースは CDK（TypeScript）で `infra/` に置き、適用はリポジトリ所有者が手元で行う。GitHub Actions からは OIDC で認証する。公開ドメインは `arcade.kojiisd.jp`。`kojiisd.jp` はデプロイ先と同じ AWS アカウントの Route 53 ホストゾーンで管理している。

## 選択肢

| 論点 | 案 | 採用 |
| --- | --- | --- |
| プレビューの置き場所 | 別バケット / 同一バケットの `pr-<n>/` プレフィックス / 外部 PaaS | 同一バケットのプレフィックス。本番と同じ経路で確認できる |
| 認証 | 長期キー / OIDC | OIDC |
| IAM ロール | 1 本 / 本番用とプレビュー用の 2 本 | 2 本。trust と権限を分ける |
| 適用方法 | CI から `cdk deploy` / 所有者が手元で実行 | 所有者が手元で実行。CI にインフラ変更権限を持たせない |

### 証明書（us-east-1 必須）とメインスタックのリージョン

CloudFront に付ける ACM 証明書は us-east-1 に置く必要がある。

| 案 | 概要 | 長所 | 短所 |
| --- | --- | --- | --- |
| A | 全リソースを us-east-1 の 1 スタックに置く | 最も単純。リージョンをまたぐ参照が無く、bootstrap も 1 リージョン | リージョン指定が漏れても us-east-1 の既定値で「偶然」動いてしまい、設定ミスに気付けない |
| B | 証明書スタック（us-east-1）+ メインスタック、`crossRegionReferences: true` | 自動で参照できる | 両リージョンに SSM パラメータと参照用のカスタムリソース（Lambda）ができる。証明書を差し替えると参照が固定され、2 段階の deploy が要る |
| **C（採用）** | 証明書スタック（us-east-1）を先に deploy し、出力の ARN を設定ファイルへ転記してからメインスタック（us-west-2）を deploy | 仕組みが単純で、カスタムリソースが無い。メインのリージョンを意図的に us-east-1 以外にできる | deploy が 2 回になり、ARN の転記という手作業が入る |
| D | deprecated の `DnsValidatedCertificate`（`region` 指定） | 1 スタック | 非推奨。カスタムリソース依存 |

計画段階では案 A を推奨したが、所有者の判断で案 C に変更した。理由は、メインスタックを意図的に us-east-1 以外（us-west-2）に置くことで、リージョン指定の漏れが us-east-1 の既定値で偶然動く事故を防ぐためである。転記の誤りは設定検証で止める（下記）。

### 「プレビュー用ロールで `pr-*` 以外へ書けない」の確認方法

プレビュー用ロールは GitHub の `pull_request` トークンしか信頼しないため、手元の認証情報からは assume できない。

| 案 | 採用 | 理由 |
| --- | --- | --- |
| (1) `preview.yml` に拒否確認ステップを入れる | 採用 | 実際のロールで毎 PR 検証でき、将来ポリシーを広げたら即座に赤くなる。実行ログが証跡になる |
| (2) 手元で IAM ポリシーシミュレータ（`simulate-principal-policy`） | 補助として手順書に記載 | assume 不要で副作用が無い。アイデンティティポリシーだけの評価 |
| (3) `workflow_dispatch` の専用ワークフロー | 不採用 | `pull_request` 以外のイベントでは OIDC の `sub` が変わり、プレビュー用ロールを assume できない |

加えて、ポリシーの形は CDK のテスト（aws-cdk-lib/assertions）で静的に担保する。

## 決定

### スタック構成（`infra/`、CDK v2、TypeScript）

| スタック | リージョン | リソース |
| --- | --- | --- |
| `RetroActionEngineCertificate` | us-east-1（コード上の定数） | ACM 証明書（`arcade.kojiisd.jp`、DNS 検証。検証 CNAME は既存ゾーンに自動作成） |
| `RetroActionEngineSite` | 設定の `region`（us-west-2） | S3、CloudFront、Route 53 レコード、OIDC プロバイダ、IAM ロール 2 本 |

- S3 バケット: 非公開（Block Public Access）、SSL 必須、SSE-S3、バージョニングなし、`RETAIN`。CloudFront の OAC からのみ読める。
- CloudFront Distribution: 1 つ。オリジンはバケット（OAC）。代替ドメイン `arcade.kojiisd.jp`、証明書は設定の ARN を参照、`TLSv1.2_2021`、HTTP/2 と HTTP/3、`PriceClass_200`（日本を含む。設定可）、`defaultRootObject: index.html`、HTTPS へリダイレクト。
- CloudFront Function（viewer-request、JS 2.0）: `/pr-12/` のようなディレクトリ要求に `index.html` を補完し、拡張子の無いパスは末尾 `/` へ 301（クエリ保持）。
- ResponseHeadersPolicy を 2 つ作る。
  - 既定ビヘイビア: `Strict-Transport-Security`（2 年、`includeSubDomains` なし。`kojiisd.jp` の他のサブドメインへ波及させないため）、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`X-Frame-Options: DENY`。
  - `pr-*` ビヘイビア: 上記と同じセキュリティヘッダーに加え `X-Robots-Tag: noindex`。プレビューを検索エンジンにインデックスさせない。
  - `Content-Security-Policy` は Phaser と Service Worker との兼ね合いがあるため M4 で検討する（roadmap）。
- Route 53: 既存ホストゾーンを `fromHostedZoneAttributes`（ID とゾーン名）で参照し、`arcade.kojiisd.jp` の A / AAAA Alias を作る。ホストゾーンは作らず、ルックアップもしない。
- GitHub OIDC プロバイダ（`token.actions.githubusercontent.com`）: 設定 `github.oidcProvider` で切り替える。
  - `create`: `OidcProviderNative` で作成する（`RETAIN`）。
  - `import`: `arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com` を組み立てて参照する。
- IAM ロール 2 本。信頼ポリシーは `aud = sts.amazonaws.com` と `sub` を `StringEquals`（ワイルドカードなし）で固定する。

| ロール | trust（OIDC の `sub`） | 権限 |
| --- | --- | --- |
| production | `repo:kojiisd/retro-action-engine:environment:production` | バケット全体の `s3:PutObject`、`s3:DeleteObject`、`s3:ListBucket`。対象 Distribution の `cloudfront:CreateInvalidation` |
| preview | `repo:kojiisd/retro-action-engine:pull_request` | `s3:PutObject`、`s3:DeleteObject` を `arn:aws:s3:::<bucket>/pr-*` のみ。`s3:ListBucket` は `s3:prefix` が `pr-*` の条件付き。対象 Distribution の `cloudfront:CreateInvalidation` |

- 既知の制約: `cloudfront:CreateInvalidation` はパスで IAM 制限できないため、プレビュー用ロールでも `/` の無効化は技術的に可能。影響はキャッシュ破棄のみでコンテンツは書けないため許容する。
- 既知の制約: 同一リポジトリの PR は `pr-*` 全体へ書けるので、他の PR のプレビューも上書きできる。個人リポジトリのため許容する。

### 設定ファイルと検証

- `infra/config/deploy.example.json`（プレースホルダー入り、コミット）を、所有者が手元で `infra/config/deploy.json`（gitignore）にコピーして埋める。アカウント由来の値をリポジトリに置かない方針（CLAUDE.md）に合わせる。
- 検証（`infra/src/config.ts`）は、問題を項目ごとにまとめて表示して止める。主なルールは次のとおり。
  - `region` は必須で既定値を持たない。`us-east-1` は拒否する。
  - `certificateArn` は ACM の ARN 形式で、リージョンが us-east-1、アカウントが `account` と一致すること。
  - `domainName` は `hostedZone.name` の配下。
  - `hostedZone.id` は `Z...` 形式（`/hostedzone/` を含めない）。
  - `account` と `hostedZone.id` のプレースホルダーは、context `allowPlaceholders=true`（CI とテストの synth）のときだけ許す。
- `certificateArn` がプレースホルダーの間は、メインスタックを synth しない。これにより証明書スタックだけを先に deploy できる。
- これにより `cdk synth` とテストは AWS の認証情報なしで通る（ルックアップを使わない）。

### ワークフロー

| ファイル | トリガ | 内容 |
| --- | --- | --- |
| `preview.yml` | `pull_request`（opened, synchronize, reopened, closed） | 同一リポジトリの PR のみ（fork はスキップ）。`deploy` ジョブ: build（`VITE_BASE=/pr-<n>/`）→ preview ロールを assume → 拒否確認 → `pr-<n>/` へ sync → invalidation `/pr-<n>/*` → プレビュー URL を 1 件のコメントに upsert。`cleanup` ジョブ（closed）: `pr-<n>/` を削除 → invalidation → コメントを更新 |
| `deploy.yml` | `push` to `main`、`workflow_dispatch` | Environment `production` で production ロールを assume → `/` へ sync（`pr-*` と `_deny-check/` は除外）→ invalidation `/*` |
| `ci.yml` | `pull_request`、`push` to `main` | 既存の検査に加え、`cdk synth`（プレースホルダー、認証情報なし） |

- 拒否確認: プレビュー用ロールで `_deny-check/pr-<n>-<run>.txt` への `put-object` を試し、AccessDenied なら成功とする。書けてしまったら削除を試みてジョブを失敗させる（`.github/scripts/check-preview-deny.sh`）。
- repository variables: `AWS_REGION`、`AWS_ROLE_ARN_PRODUCTION`、`AWS_ROLE_ARN_PREVIEW`、`S3_BUCKET`、`CF_DISTRIBUTION_ID`、`SITE_DOMAIN`。
  - ロール ARN が未登録の間はジョブをスキップする（インフラ適用前の PR を赤くしない）。
  - ロール ARN があって他が欠けている場合は失敗させる。リージョンも明示的に渡し、既定値に頼らない。
- `permissions`: preview は `id-token: write, contents: read, pull-requests: write`、deploy は `id-token: write, contents: read`。
- キャッシュヘッダ（`.github/scripts/sync-site.sh`）:
  - `assets/` 配下（ハッシュ付き）は `Cache-Control: public, max-age=31536000, immutable`。それ以外（`index.html`、将来の `sw.js` やパックデータ）は `no-cache`。
  - 新しいアセットを先に上げ、HTML を差し替えてから古いアセットを消す。
- Environment `production` の Deployment branches を `main` に限定する（必須）。PR のワークフローは PR ブランチ側の YAML で動くため、制限が無いと PR が `environment: production` を指定して本番ロールの `sub` を得られてしまう。
- Vite の `base` と vite-plugin-pwa のスコープがプレフィックスに追従することは、M4 の smoke で確認する。

### パス設計（将来の複数ゲーム）

- トップレベルの名前空間を予約する。
  - `pr-*` はプレビュー専用。
  - ゲーム（パック）は `/play/<packId>/` 配下。
  - トップレベル直下は本番のシェル（将来のランチャー）。
- プレビューはサイト全体を `/pr-<n>/` 配下に複製する（`/pr-<n>/play/<packId>/`）ので衝突しない。
- 本番 deploy の `s3 sync --delete` は常に `pr-*` を除外する（実装済み）。`packId` は `pr-` で始めてはならない（M4 のパックスキーマで検証する）。
- 今回は実装しない。

### 準備手順

所有者が手元で行う手順は [infra/README.md](../../infra/README.md) にまとめた。

1. 設定値を調べる。
2. bootstrap を us-east-1 と us-west-2 の両方で行う。
3. 証明書スタックを deploy する。
4. ARN を転記する。
5. メインスタックを deploy する。
6. repository variables を登録する。
7. GitHub 側の確認項目（Environment のブランチ制限、ブランチ保護）を確かめる。
8. 動作を確認する。

## 結果

- 得られるもの:
  - 独自ドメインでの PR ごとの実機確認。
  - 最小権限の 2 ロールと、その継続的な検証（毎 PR の拒否確認と CDK テスト）。
  - 本番と同じ配信経路のプレビュー。
  - 認証情報なしで synth とテストができる構成。
  - インフラ変更権限を CI に渡さない運用。
- 失うもの:
  - fork からの PR はプレビューなし（個人リポジトリのため許容）。
  - 証明書とメインスタックの 2 段階 deploy と ARN の転記。
  - メインスタックが us-west-2 のため、キャッシュミス時のオリジン往復が日本から遠い（静的配信で長期キャッシュのため影響は小さい）。
- コスト: S3 と CloudFront の最小利用。プレビューの prefix は PR close で削除する。

## 要確認

- なし（Content-Security-Policy は M4 の検討事項として roadmap に記載）。
