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

发布模型包含 31 张程序生成的材质贴图：原有房间 28 张，以及新增 fufu 的短绒、织物、刺绣法线贴图各 1 张。真实照片的纹理引用和原始二进制图像数据均已移除；屏幕桌面和相框装饰由代码生成。仓库不包含拍摄照片、原始扫描、视频、Blender 工程或含照片的旧预览图。

`tests/fixtures/room-textures.json` 记录经过核对的程序材质名称及校验值。测试还检查 GLB 中没有未声明的额外二进制数据、房间几何范围正确、屏幕交互不会改动其他材质。

如需从本地私有原模型重新生成网页模型，使用 `scripts/sanitize-model.mjs`，将私有输入与网页输出路径分开传入；运行后重新验收，不要将原模型加入仓库。

## 床上的 fufu

新增玩偶位于床面靠枕处，左右马尾展开宽度约 40 厘米。它以高斯扫描的轮廓为约束，参考照片和视频重建五官、刘海、发饰与水手服；短绒和织物细节采用生成的法线贴图近似。原有家具及玩偶保持原样。

新增模型包含 63 个独立网格，挂在 `床 · 含床品与玩偶` 下的 `初音未来 fufu · 整体` 节点。移动或缩放该节点即可整体调整玩偶。网页不增加新的控件或接口。

从两个已检查的独立 GLB 合并时，输入房间必须是经过照片清理且尚未加入这只 fufu 的版本。合并脚本会保留原房间几何、节点属性和材质，并更新材质校验清单：

```bash
node scripts/add-fufu.mjs /private/room-before.glb /private/fufu.glb public/models/room.glb tests/fixtures/room-textures.json
npm test
npm run build
```

## 发布

`main` 分支保存源码，`gh-pages` 分支保存经过验收的 `dist/` 内容。GitHub Pages 使用 `gh-pages` 根目录，并通过 `.nojekyll` 直接提供静态文件。

构建产物必须先通过本地验收，再更新发布分支。验收记录见 [QA.md](./QA.md)。
