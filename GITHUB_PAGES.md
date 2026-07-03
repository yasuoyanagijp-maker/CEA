# GitHub Pages 公開・配布ガイド

nAMD CEA 計算機の公開 URL、リポジトリ、更新手順を記録したドキュメントです。

---

## 公開 URL

研究者は **ブラウザで次の URL を開くだけ** で利用できます（アカウント登録・インストール不要）。

**https://yasuoyanagijp-maker.github.io/CEA/**

---

## リポジトリ

| 項目 | URL |
|------|-----|
| 公開リポジトリ | https://github.com/yasuoyanagijp-maker/CEA |
| デフォルトブランチ | `main` |
| 公開設定 | Public（公開） |

初回 push および GitHub Pages への初回デプロイは **2026年5月** に完了済みです。

---

## 実施した設定内容

### 1. Vite（`vite.config.js`）

GitHub Pages のプロジェクトサイトはサブパス `/CEA/` で配信されるため、本番ビルド時のみ `base` を設定します。

| 環境 | `base` | 起動・ビルド方法 |
|------|--------|------------------|
| ローカル開発 | `/` | `npm run dev` → http://localhost:5173/ |
| GitHub Pages（本番） | `/CEA/` | CI で `VITE_BASE_PATH=/CEA/` を指定して `npm run build` |

ローカルで本番と同じパスを試す場合:

```bash
VITE_BASE_PATH=/CEA/ npm run build
npx serve dist
# → http://localhost:3000/CEA/
```

### 2. GitHub Actions（`.github/workflows/deploy-pages.yml`）

- **トリガー:** `main` ブランチへの `push`、または手動実行（workflow_dispatch）
- **処理:** `npm ci` → `npm run build`（`VITE_BASE_PATH=/CEA/`）→ GitHub Pages へデプロイ
- **Pages ビルド方式:** GitHub Actions（workflow）

ワークフローの実行状況:  
https://github.com/yasuoyanagijp-maker/CEA/actions

### 3. README（`README.md`）

公開 URL とローカル起動手順への参照を記載しています。

---

## 研究者への共有方法

論文・メール・口頭などで、次の文面をそのまま使えます。

> 抗 VEGF 薬剤の費用対効果計算機は以下の URL から利用できます。  
> **https://yasuoyanagijp-maker.github.io/CEA/**  
> インストール不要で、ブラウザのみで動作します。

ソースコードを確認・改変したい研究者には、リポジトリ URL も併記してください。

> https://github.com/yasuoyanagijp-maker/CEA

---

## 今後の更新手順（開発者向け）

コードを変更したあと、GitHub Pages に反映する手順です。

```bash
cd /Users/yy/CEA   # リポジトリのルート

git add .
git commit -m "変更内容を簡潔に記述"
git push
```

- `push` 後、GitHub Actions が自動でビルド・デプロイを開始します。
- 通常 **数分以内** に https://yasuoyanagijp-maker.github.io/CEA/ に反映されます。
- 反映を確認する場合: [Actions タブ](https://github.com/yasuoyanagijp-maker/CEA/actions) で「Deploy to GitHub Pages」が成功（緑）になっていることを確認してください。

### ローカルでの確認（push 前）

```bash
npm run dev
# → http://localhost:5173/
```

---

## アーキテクチャ上の注意

- 本アプリに **独立したバックエンド API サーバーはありません**。
- Markov 計算は **ブラウザ内**（Vite がバンドルした JavaScript）で実行されます。
- GitHub Pages は **静的ファイルのホスティング** のみ行います。
- `npm run preview` や `dist/` を直接配布する方式とは別経路です。公開版の正は **上記 GitHub Pages URL** です。

---

## トラブルシューティング

| 症状 | 確認・対処 |
|------|------------|
| ページが 404 | URL 末尾の `/CEA/` を含めているか確認 |
| 変更が反映されない | Actions が成功しているか確認。ブラウザのスーパーリロード（Cmd+Shift+R） |
| ローカルと公開で挙動が違う | 公開は `/CEA/` ベースでビルドされているか。未 push の変更がないか |

---

## 関連ファイル

| ファイル | 役割 |
|----------|------|
| `vite.config.js` | `VITE_BASE_PATH` による base 切替 |
| `.github/workflows/deploy-pages.yml` | Pages 自動デプロイ |
| `README.md` | プロジェクト概要・ローカル起動 |
| `package.json` | `npm run dev` / `npm run build` |

---

*最終更新: GitHub Pages 初回公開時点の記録*
