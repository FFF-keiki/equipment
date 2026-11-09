# Cloudflareへのデプロイ（Git連携）

## GitHubでの配置

このZIPは、`src/`, `web/`, `package.json`, `wrangler.jsonc` がGitHubリポジトリ直下に配置されるように作られています。
「equipment-manager」などの親フォルダを余計に作らないでください。

```
package.json
wrangler.jsonc
src/worker.js
src/google.js
src/domain.js
src/demo.js
web/index.html
web/main.jsx
web/style.css
vite.config.js
.github/workflows/deploy.yml
```

## Cloudflare Workers Builds の設定

- Root directory: `/`（リポジトリ直下に上記ファイルがある場合）
- Build command: `npm install && npm run build`
- Deploy command: `npx wrangler deploy`

もしGitHub上の `equipment-manager/` 内に上記のファイルがある場合、Cloudflare側のRoot directoryを `equipment-manager` にする方法もあります。

環境変数・SecretsはCloudflare WorkerのSettings → Variables and Secretsに設定します。
スプレッドシートは、実際のタブ名と `wrangler.jsonc` の `SHEET_TAB` を一致させてください。

**注意：** 本番シートの編集前にコピーしたシートで同期をテストしてください。
