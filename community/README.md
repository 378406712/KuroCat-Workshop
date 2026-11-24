# 🐱 向 KuroCat 皮肤广场投稿

每个社区皮肤放在单独的文件夹里（不要手动编辑 `community/index.json`，合并 PR 后 GitHub Actions 会自动生成并上线！）：

```text
community/
└── your-cat-slug/          # 仅小写字母、数字和连字符，例如 my-orange-cat
    ├── skin.kurocat        # 必填：皮肤工坊导出的 .kurocat 文件（≤ 2 MB）
    ├── meta.json           # 必填：制作人、简介、标签
    └── preview.gif         # 可选：自定义预览 GIF / WebP / PNG / JPG（≤ 5 MB）
```

> 不传 `preview.gif` 也没关系！皮肤广场会自动读取 `skin.kurocat` 用 2.5D 实时渲染器画出小猫，并且鼠标悬停时小猫还会转头、眨眼、敲键盘。

## `meta.json` 示例

```json
{
  "title": "皇家墨镜奶牛猫",
  "author": "你的昵称",
  "authorUrl": "https://github.com/你的ID",
  "description": "一句简介，介绍一下你家猫或者配色灵感（180 字以内）",
  "tags": ["奶牛猫", "带配饰"],
  "createdAt": "2026-11-24"
}
```

> 懒得手写 `meta.json`？在皮肤工坊页面点击顶部的 **「投稿到广场」**，填完简介即可一键下载 `skin.kurocat` 和标准 `meta.json`！

## 本地验证（可选）

```bash
node scripts/validate-community.mjs
node scripts/build-plaza-index.mjs
```
