# v0.1.4 在庫連動・個人画面刷新版

**まず `UPDATE-v0.1.4.md` を読んでください。** 次に、未設定なら `SETUP-EVENT-SYNC.md` を確認してください。 Googleスプシの編集通知をリアルタイムで届けるにはGoogle Apps Scriptのトリガー設定が必要です。定期読み込みは削除しました。

---

# Equipment Desk — 機材管理 Web アプリ（初期版）

Google スプレッドシートを**唯一の原本（正本）**とする、Cloudflare Workers 上の機材管理アプリです。
スプシを使い続けながら、スタッフ別の使用状況を Web 画面から参照・変更できます。

## 同期の仕組み（重要）

```
スタッフのWeb画面 ──(HTTPS)──> Cloudflare Worker ──(Sheets API)──> Googleスプレッドシート
       ↑                                  ↑                     ↑
       └────────── Apps Script通知・WebSocket・手動の再読込 ─────────────┘
```

- **Web → スプシ：** 機材情報の編集、個人の割当数の増減、機材の追加を、Google Sheets API で原本のセルに直接書き込みます。
- **スプシ → Web：** 原本のセルを読み直して反映します。通常は**Apps Script編集トリガーからの変更通知時**、画面を開いたとき、再読込ボタンでも取得します。30秒ポーリングは廃止しました。
- **競合時：** Webからの書き込みをDurable Objectで順番に処理し、保存前に対象セル・備品数の旧値を確認します。不一致は **409 Conflict** として再取得を求めます。スプシ画面から手動で同時更新される場合は、APIの前提上、完全な同時編集排他は保証されません。
- **数式・書式：** 写真の F 列「稼働」と H 列「総数」は参照専用です。既存行の更新は指定セルだけを書き換えます。新規行では直前行の書式・データ入力規則・式を引き継ぎます。
- **履歴：** Web操作は同一スプレッドシート内の「操作履歴」タブに追加します（初回の書き込み時に自動作成）。**スプシ側で直接編集した操作は Web の履歴に含まれません**。原本の「変更履歴」をご利用ください。

## 主な画面

1. ダッシュボード：登録機材、保有数、備品・予備数、スタッフ別使用点数、カテゴリ内訳、操作履歴。
2. 機材一覧：検索・カテゴリ別絞り込み、編集、追加（個人割当の列・操作は表示しません）。
3. 個人別の使用状況：コンパクトなスタッフ選択プルダウン、全員一覧、個人使用機材の一覧、＋／－で貸出・返却、まとめて複数点の割当。
4. 変更履歴：Web上の変更ログ。

**Web側の個人割当（K～BB列）を増やすと、G列「備品」が同じ数だけ減ります。返却時は逆に増えます。** Google Sheets APIへの一括書き込みを使い、F列・H列の数式は変更しません。スプシ画面から個人セルを手編集した場合のG列の減算は、この版では自動化していません。

## 画像に合わせた列の初期設定

| 列 | 内容 | Webで編集 |
|---|---|---|
| A | カテゴリ | ○ |
| B | 備品名 | ○ |
| C | 型番 | ○ |
| D | 備考 | ○ |
| E | 記載・更新日 | ○（明示的な編集時のみ） |
| F | 稼働 | × 自動計算 |
| G | 備品 | ○ |
| H | 総数 | × 自動計算 |
| I | 購入日 | ○ |
| J | 耐用年数 | ○ |
| K～BB | 担当者別の機材数量 | ○（個人別使用状況の割当・返却でG列とセット更新） |

- ヘッダー：**2行目**、データ開始：**3行目**。
- **`SHEET_TAB` はスプレッドシートファイル名ではなく画面下部の「シートのタブ名」**です。デフォルトの「機材管理」は仮名なので、実際のタブ名へ変更してください。
- スタッフの最終列が BB でなければ、`PERSON_END_COLUMN` を変更してください。列の間の空の見出しは無視します。
- マージセル、多段見出し、複数列で1名を表す場合には、実データ確認後に取込ルールを調整してください。

## 1. ローカルでデモを表示

必要：**Node.js 22 以降**、npm。

```bash
npm install
npm run preview:demo
```

Wrangler がローカル URL を表示します。ブラウザで開いてください。デモは **Google スプシに接続しません**。編集結果はブラウザの localStorage に保存されます。

開発中のホットリロードは先に `npm run build` を実行してから、ターミナル1で `npm run dev:api`、ターミナル2で `npm run dev` を実行し、`http://localhost:5173` を開きます。

## 2. Google Sheets API を準備

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成。
2. 「API とサービス」から **Google Sheets API** を有効化。
3. 「サービスアカウント」を作成し、**JSON キー**を1つ発行する（管理者による鍵発行が禁止されている環境では別の OAuth 認証設計が必要）。
4. 対象のGoogleスプシの「共有」画面で、サービスアカウントの `client_email` を**編集者**として招待する。
5. スプシの URL `https://docs.google.com/spreadsheets/d/【ID】/edit` から **スプレッドシート ID** を確認する。
6. JSON の `client_email` と `private_key` を控える。**JSONキーをGitHubへコミットしないこと。**

このアプリは Google の秘密鍵をブラウザへ送信しません。Cloudflare Worker 内で署名して Google の OAuth 2.0 アクセストークンを取得します。

## 3. Cloudflare 側の設定

`wrangler.jsonc` の `vars` を修正します。

```jsonc
"SHEET_TAB": "実際のシートタブ名",
"HEADER_ROW": "2",
"FIRST_DATA_ROW": "3",
"PERSON_START_COLUMN": "K",
"PERSON_END_COLUMN": "BB",
"MAX_DATA_ROWS": "1000",
"AUDIT_TAB": "操作履歴",
"DEMO_MODE": "false"
```

Cloudflare アカウントにログインし、以下の実行時接続情報を登録します。`SPREADSHEET_ID`・`SERVICE_ACCOUNT_EMAIL` は変数でもよく、`SERVICE_ACCOUNT_PRIVATE_KEY` は **Secret** にしてください。

```bash
npx wrangler login
npx wrangler secret put SPREADSHEET_ID
npx wrangler secret put SERVICE_ACCOUNT_EMAIL
npx wrangler secret put SERVICE_ACCOUNT_PRIVATE_KEY
```

- `SERVICE_ACCOUNT_PRIVATE_KEY` は JSON の `private_key` に記載された PEM 文字列（`BEGIN PRIVATE KEY` から `END PRIVATE KEY` まで）を登録します。`\n` のままでも、実際の改行でも処理できます。
- コマンドの入力をスクリプトや履歴に残したくない場合、Cloudflare ダッシュボードの Worker 設定 → Secrets から登録してください。

デプロイ：

```bash
npm run deploy
```

URLはデプロイ完了後に Wrangler が表示します。`wrangler.demo.jsonc` は **デモ専用**なので、本番では使用しないでください。

### ローカルで本物のシートへ接続したい場合

`.dev.vars.example` を `.dev.vars` にコピーし、3つの接続情報を記入します（`.dev.vars` は Git 対象外）。`npm run build` の後 `npm run dev:live` で Worker を起動します。Vite からアクセスする場合は、別ターミナルで `npm run dev` を開始します。

## 4. GitHub → Cloudflare 自動デプロイ

この ZIP のファイルを新規 Git リポジトリへコミットして GitHub に push します。既存プロジェクトを上書きする必要はありません。

GitHub リポジトリの **Settings → Secrets and variables → Actions** に登録：

- `CLOUDFLARE_API_TOKEN`：Workers デプロイ権限のある API Token
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Account ID

`.github/workflows/deploy.yml` が `main` ブランチの push 時にテスト・ビルド・デプロイを実行します。Google 側の秘密鍵等は GitHub Actions Secrets へ入れる必要はありません（**Cloudflare 側の Worker Secrets** に登録）。

## 注意点と次の拡張候補

- **現物単位の管理ではありません。** 同じ型番の複数台をまとめて数量管理します。機材1台ずつのシリアル番号管理や故障/修理中ステータスは別設計が必要です。
- ログイン画面はありません。**URLを開ける人なら誰でも閲覧・変更できます**。操作担当者のプルダウンは自己申告であり本人確認ではありません。公開する前に Cloudflare Access 等で事務所メンバーのみにアクセスを限定することを強く推奨します。
- Sheets API へのアクセスは利用者の人数に応じて増えます。スタッフ数が多くなったらキャッシュや D1ミラー/Push 通知の設計を検討してください。
- 新規機材追加時にコピーする数式が直前行に存在しない場合、追加行の自動計算値が空欄になる可能性があります。実際の式に応じて初期調整が必要です。
- 元スプシに行を挿入・並べ替えしたときは、Webの保存前に再読込してください。アプリは行番号 + 機材名 + 旧セル値で競合を検知しますが、厳密な機材ID列の追加が将来の推奨事項です。
- スプシとWebの変更は**Apps Script + WebSocket によるイベント通知**（遅延やネットワーク切断が起こる場合があります）。操作直後の書き込みは即時に実行されます。

## フォルダ

```
src/worker.js         Cloudflare Worker API（アプリ内ログインなし）
src/google.js         Sheets OAuth、読込、セル更新、行追加、履歴
src/domain.js         列番号変換、データ変換、入力検証
src/demo.js           ダミーデータ（本番には書き込まれません）
web/main.jsx          React UI
web/style.css         レスポンシブCSS
wrangler.jsonc        Cloudflare本番設定
wrangler.demo.jsonc   Cloudflareデモ設定
.github/workflows/    GitHub Actions
```

**現時点では画像だけを参照しているため、実際のスプシとの接続確認は行っていません。** スプレッドシートの URL / ファイルの実データを確認して、タブ名・見出し・式の配置を最終調整してください。
