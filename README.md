# 民泊在庫管理アプリ

スマホで在庫をタップ管理。PCで全物件を一目で確認。在庫切れは自動メール通知。

---

## セットアップ手順（全4ステップ）

> スプレッドシートは作成済みです。ID: `1kR2vjwsdWhteTEPpRgGVSQXnPUT6tzcIHkv_UBiPfjQ`

---

### ステップ1: Apps Script でデータベース作成 + API公開

1. **スプレッドシートを開く**
   - https://docs.google.com/spreadsheets/d/1kR2vjwsdWhteTEPpRgGVSQXnPUT6tzcIHkv_UBiPfjQ/edit

2. **Apps Script を開く**
   - メニュー「拡張機能」→「Apps Script」

3. **コードを貼り付け**
   - 左の `コード.gs` に表示されている既存コードを全選択（Ctrl+A）→ 削除
   - このプロジェクトの `Code.gs` の中身を全部コピーして貼り付け → 保存（Ctrl+S）

4. **データベースを自動作成**
   - 上部の関数プルダウンで `setupDatabase` を選択
   - ▶ 実行ボタンをクリック
   - 「承認が必要です」→「権限を確認」→ アカウント選択 → 「詳細」→「（安全ではないページ）に移動」→「許可」
   - 完了すると、6枚のシートとサンプルデータが自動作成されます

5. **ウェブアプリとしてデプロイ**
   - 右上「デプロイ」→「新しいデプロイ」
   - 歯車アイコン横の「種類の選択」→「ウェブアプリ」
   - 次のユーザーとして実行: `自分`
   - アクセスできるユーザー: `全員`
   - 「デプロイ」→ 権限承認（初回と同じ手順）
   - 表示される **ウェブアプリURL** をコピーしてメモ帳に保存

---

### ステップ2: Google Cloud で OAuth 設定

1. https://console.cloud.google.com/ を開く
2. 上部のプロジェクト選択 → 「新しいプロジェクト」→ 名前: `Minpaku Inventory` → 作成
3. 左メニュー「APIとサービス」→「OAuth同意画面」
   - User Type: 外部 → 作成
   - アプリ名: `民泊在庫管理`
   - ユーザーサポートメール・連絡先: 自分のメール
   - 「保存して次へ」を3回押して完了
4. 左メニュー「APIとサービス」→「認証情報」
   - 「+ 認証情報を作成」→「OAuthクライアントID」
   - 種類: `ウェブアプリケーション`
   - 承認済みのJavaScript生成元:
     - `https://（GitHubユーザー名）.github.io`
   - 作成 → 表示された**クライアントID**をメモ帳に保存

5. **Apps Script にクライアントIDを設定**
   - ステップ1のApps Script画面に戻る
   - `CONFIG` の `GOOGLE_CLIENT_ID` にクライアントIDを貼り付け → 保存
   - 「デプロイ」→「デプロイを管理」→ 鉛筆アイコン → バージョン「新バージョン」→「デプロイ」

---

### ステップ3: GitHub Pages でアプリ公開

1. https://github.com/ でログイン
2. 右上「+」→「New repository」→ 名前: `minpaku-inventory` → Public → Create
3. 「uploading an existing file」をクリック
4. 以下をドラッグ&ドロップ:
   - `index.html`, `manifest.json`, `service-worker.js`
   - `css/` フォルダ、`js/` フォルダ、`icons/` フォルダ
5. 「Commit changes」
6. リポジトリ内の `js/config.js` をクリック → 鉛筆アイコン
   - `GAS_URL` → ステップ1のデプロイURLに書き換え
   - `GOOGLE_CLIENT_ID` → ステップ2のクライアントIDに書き換え
   - 「Commit changes」
7. Settings → Pages → Branch: `main` / `/ (root)` → Save
8. 数分後 `https://（ユーザー名）.github.io/minpaku-inventory/` でアクセス可能

---

### ステップ4: 定期メール通知を有効化

1. Apps Script エディタを開く
2. 関数プルダウンで `setupTriggers` を選択 → ▶ 実行
3. これで毎週月曜と毎月1日に自動メールが届きます

---

## スマホにインストール（PWA）

**iPhone**: Safari → 共有ボタン → 「ホーム画面に追加」
**Android**: Chrome → アドレスバーの「インストール」or メニュー→「ホーム画面に追加」

---

## スタッフの追加

1. スプレッドシートの「権限マスタ」シートに行を追加:

   | メールアドレス | 表示名 | 権限 | 有効 |
   |-------------|--------|------|------|
   | staff@gmail.com | スタッフA | staff | TRUE |

2. Google Cloud Console → OAuth同意画面 → テストユーザーに同じメールを追加

---

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| 権限がありません | 権限マスタにメールが登録されているか・有効=TRUEか確認 |
| ログインボタンが出ない | config.jsのクライアントID確認。広告ブロッカーOFF |
| 更新が反映されない | ネット接続確認。ステータスバー確認。ページ再読み込み |
| 他のスタッフが先に更新 | 画面が自動更新されるので再度操作 |
| メールが届かない | 物件マスタの通知メール確認。迷惑メール確認 |
| 画面が真っ白 | ブラウザキャッシュクリア → 再読み込み |
