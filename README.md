# nAMD CEA

抗 VEGF 薬剤（ラニビズマブ、アフリベルセプト、ファリシマブ、ブロルシズマブ、BS 製剤）の QALY・コスト算出ツール。

## 構成

```
CEA/
├── index.html          # Vite エントリ
├── index.js            # ライブラリ export（プログラム利用時）
├── frontend/App.jsx    # UI
└── backend/            # Markov・論文データ・engine
```

## 起動

```bash
cd /Users/yy/CEA
npm install
npm run dev
```

ブラウザで http://localhost:5173 を開く。

ローカルで GitHub Pages と同じパスで試す場合:

```bash
npm run build
npx serve dist
```

→ http://localhost:3000/CEA/

## 公開版（GitHub Pages）

**https://yasuoyanagijp-maker.github.io/CEA/**

`main` ブランチへの push で GitHub Actions が自動ビルド・公開します。

詳細（共有文面・更新手順・設定内容）→ **[GITHUB_PAGES.md](./GITHUB_PAGES.md)**

## Cursor で開く

**フォルダ `/Users/yy/CEA` をワークスペースルートとして開く。**

## 論文データ

| ID | 内容 |
|----|------|
| `paper2_rbz` | RBZ BS サブタイプ補足（S9–S11 コスト、S5–S8 臨床） |
| `paper1_faricimab` | Faricimab CEA 補足（薬価・投与コスト） |

臨床入力（5状態・両眼）は論文2。コストは UI で論文を選択。
