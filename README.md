# Wang Wei’s Room

一个可以拖动浏览的小房间，使用 Vue 3、Vite、TypeScript 和 Three.js。

[打开互动房间](https://gitgundam.github.io/wangwei-room/)

## 运行

需要 Node.js 22.12 或更新的 Node.js 22 版本，以及 npm。

```bash
npm ci
npm run dev
```

打开终端显示的 `/wangwei-room/` 地址。

```bash
npm test
npm run build
npm run preview
```

`dist/` 是可部署的静态网站，不需要后端。Vite 的 `base` 为 `/wangwei-room/`；变更仓库名时同步调整。

## 操作

- 鼠标拖动旋转、滚轮缩放、右键平移。
- 手机单指旋转，双指缩放和平移。
- 「全景」「书桌」切换位置，「重置视角」回到全景。
- 房间灯光和电脑屏幕可独立开关，也可直接点击显示器。
- 聚焦模型后，方向键旋转、加减键缩放、Home 重置。

近侧墙面自动隐藏，天花默认隐藏。模型沿用扫描比例，家具可通过原有分组辨认；本版不提供布置编辑功能。

## 照片处理

发布模型仅保留 28 张程序生成的表面材质。真实照片的纹理引用和原始二进制图像数据均已移除；屏幕桌面和相框装饰由代码生成。仓库不包含拍摄照片、原始扫描、Blender 工程或含照片的旧预览图。

`tests/fixtures/room-textures.json` 记录经过核对的程序材质名称及校验值。测试还检查 GLB 中没有未声明的额外二进制数据、房间几何范围正确、屏幕交互不会改动其他材质。

如需从本地私有原模型重新生成网页模型，使用 `scripts/sanitize-model.mjs`，将私有输入与网页输出路径分开传入；运行后重新验收，不要将原模型加入仓库。

## 发布

`main` 分支保存源码，`gh-pages` 分支保存经过验收的 `dist/` 内容。GitHub Pages 使用 `gh-pages` 根目录，并通过 `.nojekyll` 直接提供静态文件。

构建产物必须先通过本地验收，再更新发布分支。验收记录见 [QA.md](./QA.md)。
