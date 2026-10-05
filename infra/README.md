# infra

`arcade.kojiisd.jp` の配信基盤を AWS CDK（TypeScript）で定義するパッケージです。設計の根拠は [ADR-0014](../docs/decisions/ADR-0014-deploy-and-infra.md) にあります。この README は、リポジトリ所有者が手元で実行する手順書を兼ねます。

## 構成

| スタック | リージョン | 中身 |
| --- | --- | --- |
| `RetroActionEngineCertificate` | us-east-1（固定） | ACM 証明書（DNS 検証。検証用 CNAME は既存ホストゾーンに自動作成） |
| `RetroActionEngineSite` | 設定の `region`（us-west-2。us-east-1 は不可） | 非公開 S3、CloudFront（OAC、セキュリティヘッダー、`pr-*` に noindex）、Route 53 の A / AAAA Alias、GitHub OIDC プロバイダ（作成または参照）、IAM ロール 2 本 |

- 証明書スタックを先に deploy し、出力された証明書 ARN を設定ファイルへ転記してから、メインスタックを deploy します。リージョンをまたぐ自動参照は使いません。
- CloudFront Function（`functions/viewer-request.js`）は、`/pr-12/` に `index.html` を補い、`/pr-12` を `/pr-12/` へ 301 で転送します。
- `cdk synth` とテストは AWS の認証情報なしで動きます。ホストゾーンなどの値はルックアップせず、設定ファイルから読みます。

| ファイル | 内容 |
| --- | --- |
| `bin/app.ts` | エントリ。設定を読み、2 つのスタックを定義する |
| `src/config.ts` | 設定の型と検証 |
| `src/certificate-stack.ts` / `src/site-stack.ts` | スタック本体 |
| `src/*.test.ts` | aws-cdk-lib/assertions と関数ロジックのテスト |
| `config/deploy.example.json` | 設定の見本（プレースホルダー入り、コミット対象） |
| `config/deploy.json` | 実際の設定（gitignore。手元でだけ作る） |

## 開発時のコマンド

```sh
pnpm --filter @retro-action-engine/infra synth   # プレースホルダーのまま両スタックを synth（CI と同じ）
pnpm test                                          # infra のテストも含めて実行
pnpm typecheck
```

`bin/app.ts` は Node の型除去でそのまま実行します（tsx などは使いません）。このため相対 import には `.ts` 拡張子を付け、enum などの型除去できない構文は使いません（`erasableSyntaxOnly`）。

---

## 手順書: 初回のデプロイ

### 0. 前提

- AWS CLI v2 と、デプロイ先アカウントの管理者相当の認証情報（`aws sts get-caller-identity` が通ること）
- Node 22、pnpm 12（リポジトリの `packageManager` に従う）
- GitHub CLI `gh`（repository variables の登録に使う。Web UI でも可）
- リポジトリを clone し、ルートで `pnpm install` 済みであること

以降のコマンドは、特に断りがなければ `infra/` ディレクトリで実行します。

```sh
cd infra
```

### 1. 設定値を調べる

```sh
# アカウント ID
aws sts get-caller-identity --query Account --output text

# ホストゾーン ID（出力の "/hostedzone/" より後ろの Z... だけを使う）
aws route53 list-hosted-zones-by-name --dns-name kojiisd.jp \
  --query "HostedZones[?Name=='kojiisd.jp.'].Id" --output text

# GitHub の OIDC プロバイダが既にあるか
aws iam list-open-id-connect-providers --output text | grep token.actions.githubusercontent.com \
  && echo "-> oidcProvider: import" || echo "-> oidcProvider: create"
```

### 2. 事前チェック

```sh
# arcade.kojiisd.jp に既存のレコードが無いこと（何も出なければ OK）
aws route53 list-resource-record-sets --hosted-zone-id <ホストゾーンID> \
  --query "ResourceRecordSets[?Name=='arcade.kojiisd.jp.']"

# CAA レコードがある場合、ACM（amazon.com など）が許可されていること（何も出なければ制限なし）
aws route53 list-resource-record-sets --hosted-zone-id <ホストゾーンID> \
  --query "ResourceRecordSets[?Type=='CAA']"
```

CAA がある場合は、`amazon.com`、`amazontrust.com`、`awstrust.com`、`amazonaws.com` のいずれかが許可されている必要があります。

### 3. 設定ファイルを作る

```sh
cp config/deploy.example.json config/deploy.json
```

`config/deploy.json` を編集します。この時点では `certificateArn` はプレースホルダーのままで構いません。

| キー | 値 |
| --- | --- |
| `account` | 手順 1 のアカウント ID |
| `region` | `us-west-2`（必須。既定値は無く、`us-east-1` は受け付けない） |
| `hostedZone.id` | 手順 1 のホストゾーン ID（`Z...`） |
| `hostedZone.name` | `kojiisd.jp` |
| `domainName` | `arcade.kojiisd.jp` |
| `certificateArn` | 手順 5 で転記する。今はプレースホルダーのまま |
| `github.oidcProvider` | 手順 1 の結果に従い `create` または `import` |
| `priceClass` | `PriceClass_200`（日本を含む。全エッジを使うなら `PriceClass_All`） |

設定に誤りがあると、synth の時点で項目ごとのエラーが表示されて止まります。

### 4. CDK bootstrap（初回のみ、2 リージョン）

証明書スタックは us-east-1、メインスタックは us-west-2 なので、両方を bootstrap します。

```sh
pnpm exec cdk bootstrap aws://<アカウントID>/us-east-1 aws://<アカウントID>/us-west-2
```

### 5. 証明書スタックを deploy し、ARN を転記する

```sh
pnpm exec cdk deploy RetroActionEngineCertificate
```

- `certificateArn` がプレースホルダーの間は、メインスタックは synth されません（その旨のメッセージが出ます）。
- DNS 検証の完了まで数分かかります。
- 完了すると `RetroActionEngineCertificate.CertificateArn` が出力されます。この値を `config/deploy.json` の `certificateArn` に貼り付けます。us-east-1 以外の ARN や、別アカウントの ARN はエラーになります。

あとから出力を確認する場合:

```sh
aws cloudformation describe-stacks --region us-east-1 --stack-name RetroActionEngineCertificate \
  --query "Stacks[0].Outputs[?OutputKey=='CertificateArn'].OutputValue" --output text
```

### 6. メインスタックを deploy する

```sh
pnpm exec cdk diff RetroActionEngineSite
pnpm exec cdk deploy RetroActionEngineSite
```

IAM の変更を含むため、確認を求められたら内容を見て承認します。CloudFront の作成に数分かかります。

### 7. 出力値を GitHub の repository variables に登録する

| 変数 | スタック出力 |
| --- | --- |
| `AWS_REGION` | `Region` |
| `S3_BUCKET` | `BucketName` |
| `CF_DISTRIBUTION_ID` | `DistributionId` |
| `SITE_DOMAIN` | `SiteDomain` |
| `AWS_ROLE_ARN_PRODUCTION` | `ProductionRoleArn` |
| `AWS_ROLE_ARN_PREVIEW` | `PreviewRoleArn` |

`gh` でまとめて登録する例（リポジトリのルートで実行）:

```sh
outputs() {
  aws cloudformation describe-stacks --region us-west-2 --stack-name RetroActionEngineSite \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
gh variable set AWS_REGION              --body "$(outputs Region)"
gh variable set S3_BUCKET               --body "$(outputs BucketName)"
gh variable set CF_DISTRIBUTION_ID      --body "$(outputs DistributionId)"
gh variable set SITE_DOMAIN             --body "$(outputs SiteDomain)"
gh variable set AWS_ROLE_ARN_PRODUCTION --body "$(outputs ProductionRoleArn)"
gh variable set AWS_ROLE_ARN_PREVIEW    --body "$(outputs PreviewRoleArn)"
gh variable list
```

- ワークフローは `AWS_ROLE_ARN_PREVIEW`（本番は `AWS_ROLE_ARN_PRODUCTION`）が未登録の間はジョブをスキップします。
- ロール ARN が登録済みで、他の変数（`AWS_REGION` など）が欠けている場合は、ジョブを失敗させます。

### 8. GitHub 側の確認項目

- [ ] Environment `production` が存在し、Deployment branches が `main` のみに限定されている（Settings → Environments → production）。本番ロールは `environment:production` の OIDC トークンだけを信頼するため、この制限が本番への唯一の関門になる。
- [ ] `main` のブランチ保護（PR 必須、CI 必須）が設定されている。
- [ ] Actions の権限で、ワークフローが `id-token: write` を要求できる（既定で可）。

### 9. 動作確認

1. **プレビュー**: M1-1 の PR を close してから reopen します（受け入れ条件の確認を兼ねる）。
   - Preview ワークフローが実行され、PR に `https://arcade.kojiisd.jp/pr-<番号>/` のコメントが付くこと。
   - ブラウザで開くと、プレースホルダーページに「Preview of PR #<番号>」が表示されること。
2. **ヘッダー**:

   ```sh
   curl -sI https://arcade.kojiisd.jp/pr-<番号>/ | grep -iE 'x-robots-tag|strict-transport|x-content-type|referrer-policy|x-frame'
   ```

   - `x-robots-tag: noindex` と 4 つのセキュリティヘッダーが出ること。
   - マージ後、`curl -sI https://arcade.kojiisd.jp/` ではセキュリティヘッダーだけが出て、`x-robots-tag` は出ないこと。
3. **プレビュー用ロールの権限**:
   - Preview ワークフローの「Check that the preview role cannot write outside pr-*」ステップのログに `OK: ... was denied (AccessDenied)` が出ること。
   - 補助として、手元で IAM ポリシーシミュレータでも確認できます（assume は不要）。

   ```sh
   ROLE=$(gh variable get AWS_ROLE_ARN_PREVIEW); BUCKET=$(gh variable get S3_BUCKET)
   aws iam simulate-principal-policy --policy-source-arn "$ROLE" --action-names s3:PutObject \
     --resource-arns "arn:aws:s3:::$BUCKET/index.html" "arn:aws:s3:::$BUCKET/pr-1/index.html" \
     --query 'EvaluationResults[].[EvalResourceName,EvalDecision]' --output table
   ```

   `index.html` が `implicitDeny`、`pr-1/index.html` が `allowed` なら期待どおりです。
4. **削除と復活**: PR を close すると、Preview ワークフローの cleanup ジョブが `pr-<番号>/` を削除し、URL が 403 を返すこと。reopen で復活すること。
5. **本番**: PR をマージすると Deploy ワークフローが実行され、`https://arcade.kojiisd.jp/` に「Production build」が表示されること。既存の `pr-*` は消えないこと。

## 運用メモ

- **証明書の更新**: ACM が自動で更新するため作業は不要です（DNS 検証の CNAME を消さないこと）。
- **ドメインを変える場合**:
  1. 証明書スタックを再 deploy する（証明書が作り直され ARN が変わる）。
  2. 新しい ARN を `config/deploy.json` に転記する。
  3. メインスタックを deploy する。
  4. 古い証明書は CloudFront から外れた後に CloudFormation が削除する。
- **片付け**: `pnpm exec cdk destroy RetroActionEngineSite RetroActionEngineCertificate`。
  - S3 バケットは中身ごと残ります（`RETAIN`）。不要なら手動で空にして削除します。
  - `oidcProvider: create` で作った OIDC プロバイダも残ります（`RETAIN`。他の用途で使われ始めている可能性があるため）。
- **パス設計**: `pr-*` はプレビュー専用です。将来ゲームを並べる場合は `/play/<packId>/` 配下に置きます（ADR-0014）。
