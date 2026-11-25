# KuroCat Workshop · 皮肤工坊 & 社区广场 🐾

为桌面互动小猫 **[KuroCat](https://github.com/chanke17/KuroCat)** 打造的纯前端皮肤制作、配饰 DIY 与社区分享平台。  
无需安装依赖、无需后端服务器，打开网页就能用**自家猫照片**、**自己手绘的小猫图**或**自由画笔/钢笔**做出专属 `.kurocat` 皮肤，也能逛社区**皮肤广场**和**饰品广场**一键下载或试戴！

- 🌐 **KuroCat 官方网站**：https://kurocat.cc/ （[English](https://kurocat.cc/en/) · [OBS 直播指南](https://kurocat.cc/obs-guide/)）
- 🎨 **在线皮肤工坊**：https://workshop.kurocat.cc/
- ✨ **社区皮肤广场**：https://workshop.kurocat.cc/#plaza
- 🎀 **社区饰品广场**：https://workshop.kurocat.cc/#accessories
- ⌨️ **社区键盘广场**：https://workshop.kurocat.cc/#keyboards
- 📖 **AI Agent 投稿指南**：https://workshop.kurocat.cc/#guide

---

## 功能亮点

- **📷 真猫照片 + 🎨 手绘/板绘猫图一键生成**：
  - **真实猫照片模式**：浏览器本地执行前景分割 + 双边平滑 + 抗阴影 CIE Lab 聚类 + 贝塞尔轮廓拟合，真实还原自家猫咪的刘海、白肚皮、三花斑块与瞳色；
  - **手绘 / 板绘猫图模式**：专为自己画的小猫插画或透明底 PNG 优化——保留精准平涂原色与清晰色块边界，自动裁切透明/纯色画布背景，拖进去一步生成可动的 2.5D 小猫。
- **🖌️ 自由画笔手绘 & ✒️ 钢笔画分区**：
  - 新增 **「自由画笔色块」** 与 **「自由画笔线条」**，像画画一样直接按住鼠标在小猫的脸/头顶/身体/尾巴上涂鸦，松手自动拟合为可二次拖动锚点的平滑贝塞尔色块或条纹；
  - 保留钢笔分割线、闭合色块、条纹笔触与**左右对称镜像**，全程支持 `Ctrl/⌘ + Z` 撤销重做。
- **🎀 18 款内置配饰 + 自定义贴纸上传 + 饰品广场试戴**：
  - 内置头顶、脸部、颈部、尾尖共 18 款装扮，并支持上传任意 **PNG / WebP / JPG / SVG** 贴纸（带自动去纯色底抠图），在 2.5D 画布上直接拖动、缩放、旋转；
  - 在 **饰品广场** 看到喜欢的社区饰品，点击 **「佩戴到当前小猫」** 即可立刻戴在你的小猫身上。
- **✨ 社区皮肤广场 & 饰品广场（Fork + PR 零冲突共建）**：
  - 支持展示制作人昵称/主页链接、作品简介（`description`）、标签，以及自定义动态 **`preview.gif` / `preview.png`**（不传预览图时自动启用 **实时 2.5D 互动卡片**，鼠标悬停即转头互动！）；
  - 每款皮肤均支持 **7 动作在线试玩**、**在工坊二次编辑** 与 **一键下载 `.kurocat`**。
- **📦 严格 `.kurocat` v1 规范导出**：与 KuroCat 原生 macOS / Windows / Linux 渲染器 100% 同步。

---

## 向社区广场投稿（Fork + PR 或无代码 Issue）

网页右上角点击 **「投稿到广场」** 可自动打包 `skin.kurocat`（或 `accessory.png`）与 `meta.json`！

### 方式一：Fork + Pull Request（推荐，合并后自动上架）

每位创作者只新增自己独立的子目录，**不需要修改 `index.json`，永远不会产生合并冲突**：

- **投稿皮肤**：新增目录 `community/<你的英文slug>/`，放入：
  - `skin.kurocat`（必填，≤ 2 MB）
  - `meta.json`（必填，含 `title`、`author`、`authorUrl` 可选、`description`、`tags`、`createdAt`）
  - `preview.gif` / `preview.webp` / `preview.png`（可选，≤ 5 MB；不放则自动实时 2.5D 预览）
- **投稿饰品**：新增目录 `community-accessories/<你的英文slug>/`，放入：
  - `accessory.png`（必填，透明底 PNG，≤ 1 MB，建议 2× 分辨率 ≤ 1024×1024）
  - `meta.json`（必填，含 `title`、`author`、`description`、`anchor`、`offsetX`、`offsetY`、`scale`、`rotation`、`tags`、`createdAt`）

提 PR 后 GitHub Actions 会自动运行 `node scripts/validate-community.mjs` 校验规范；PR 合并到 `main` 后自动重建索引并部署到 GitHub Pages！详见 [community/README.md](./community/README.md)。

### 方式二：不会用 Git？直接填表单投稿

- 🐱 [投稿皮肤 Issue 表单](https://github.com/chanke17/KuroCat-Workshop/issues/new?template=submit-skin.yml)
- 🎀 [投稿饰品 Issue 表单](https://github.com/chanke17/KuroCat-Workshop/issues/new?template=submit-accessory.yml)

---

## 本地运行与索引校验

项目为纯静态 HTML / CSS / JS，零前端构建依赖：

```bash
git clone https://github.com/chanke17/KuroCat-Workshop.git
cd KuroCat-Workshop

# 校验社区投稿并重建广场索引（需 Node.js >= 18）
node scripts/validate-community.mjs
node scripts/build-plaza-index.mjs

# 本地预览
python3 -m http.server 8765
```

然后在浏览器打开 `http://127.0.0.1:8765/` 即可。

---

## 导入到 KuroCat 桌面端

1. 点击右上角 **「导出 .kurocat」**（或在皮肤广场点击 **「下载 .kurocat」**）；
2. 在桌面右键小猫 → **「猫咪皮肤 🐱 → 导入皮肤…」** 打开 **「换装间」**，把 `.kurocat` 文件拖进去（或双击 `.kurocat` 文件直接打开）；
3. 导入的皮肤保存在系统用户数据目录（与软件本体分离），**KuroCat 后续版本更新会自动保留你上传的所有皮肤**，也可以在「猫咪皮肤 → 打开皮肤文件夹（备份）」中随时备份。

---

## 开源协议

[MIT License](./LICENSE)
