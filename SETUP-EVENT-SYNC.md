# v0.1.3: Google Sheets → Web の変更通知（定期ポーリングなし）

## 変更内容
- ブラウザの `setInterval(...,30000)` を廃止。タブのフォーカス切替でもスプシを自動再取得しません。
- 初回アクセス時は従来どおり Google Sheets API でスナップショットを取得します。
- Webからの編集・追加は元スプシへ保存し、**実際に変更があったときだけ**他のブラウザへ通知します。
- スプシの手動編集はGoogle Apps Scriptのインストール型トリガー → 署名付きWebhook → Cloudflare Durable Object → WebSocket通知。
- 通知を受けたWebブラウザがスプシを再取得。更新されない限り定期的なスプシAPI読み込み・D1書き込みはしません。
- Cloudflare Durable ObjectはSQLiteストレージ＋WebSocket Hibernationを使用。イベントごとにリビジョン文字列1件だけ保存します。
- 通知を受信できない（トリガー未設定/ネットワークオフライン）場合は画面更新ボタンか再アクセスで取得できます。

## 手順1: GitHub
ZIPの**全ファイルをリポジトリ直下に上書き**し、`main` にコミットします。特に `src/worker.js`, `web/main.jsx`, `wrangler.jsonc` が必要です。GitHub/Cloudflare自動デプロイを確認してください。

CloudflareのWorker名は既存の `equipment-manager-sheets` のままです。新しいDO `SheetEventHub` 用の `new_sqlite_classes` migration が必要なため `wrangler.jsonc` を必ず一緒に置き換えてください。

## 手順2: Cloudflareシークレットを1つ追加
Cloudflare → Workers & Pages → `equipment-manager-sheets` → Settings → Variables and Secrets → Production。

| 名前 | タイプ | 内容 |
|---|---|---|
| `SHEET_WEBHOOK_SECRET` | Secret | 32バイト以上の暗号学的にランダムな文字列（Apps Scriptと同じ値） |

従来の `SPREADSHEET_ID`, `SERVICE_ACCOUNT_EMAIL`, `SERVICE_ACCOUNT_PRIVATE_KEY` も必要です。`SHEET_TAB` は実際のタブ名を使い、`wrangler.jsonc` と一致させます。

Windows PowerShell 5.1でも動作する生成例:

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
[BitConverter]::ToString($bytes).Replace('-', '')
```

**秘密値はGitHub・チャット・READMEに保存しないでください。**

## 手順3: Googleスプシで Apps Script を設定（必須）
1. 機材管理のスプシを開いて「拡張機能 → Apps Script」。
2. `google-apps-script/Code.gs` の内容をApps Scriptに貼り付けて保存。
3. 左側の歯車「プロジェクトの設定 → スクリプト プロパティ」に以下3項目を登録。

| 名前 | 値 |
|---|---|
| `WEBHOOK_URL` | `https://<実際のWorkerのURL>/api/sheet-change` |
| `SHEET_WEBHOOK_SECRET` | Cloudflare側に登録したものと同じ秘密値 |
| `SHEET_TAB` | 原本スプシの機材表のタブ名（現在のwrangler設定例: `機材管理`） |

4. 上部の関数選択で `installEquipmentTriggers` →「実行」。権限確認が出る場合は自分のGoogleアカウントで許可。
5. Apps Scriptの「トリガー」メニューで `equipmentOnEdit`, `equipmentOnChange` の2つが設定されたことを確認。

GoogleスプレッドシートAPIによるWebアプリからの変更では `onEdit` が発火しませんが、Workerが直接通知するので対応済みです。

## 手順4: 動作確認
1. Webアプリを2タブ開いて機材一覧を表示させる（初回だけスプシを読み込み）。
2. スプシの機材表で1セル変更 → 数秒後に両方のWeb画面が更新されることを確認。
3. Webで機材を変更 → スプシともう一方のWeb画面に反映されることを確認。
4. 何も操作せず放置。ブラウザのDevTools → Networkで `/api/snapshot` が30秒ごとに発生していないことを確認。

## 制限・費用
- Sheetsの手作業での編集・行追加等を検知します。**他のスクリプト/APIによる外部編集ではGoogle Apps Scriptの編集トリガーが発火しない**ため、手動更新/開き直しが必要です。
- Webアプリの1回の編集では競合検知のため対象行等をSheets APIで読み、変更時に書き込みます。外部変更の通知を受けたブラウザも読み込みます。
- サイト表示中はWebSocketを維持しますが、**定期ポーリングを廃止したので頻繁なSheets APIリクエストはありません**。
- Durable Objectも無料枠のリクエスト数・ストレージ操作数は消費します。完全にゼロではありません。
- ログインなしの公開URLのため、URLを知る第三者が閲覧・編集できます。Cloudflare Accessなどでの制限を推奨。
