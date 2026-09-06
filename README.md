# 风驰卡丁车 · BREEZE KART

原创卡通 3D 浏览器赛车。在晴风海岸、青森秘境和落日街区，与五位电脑车手完成三圈竞速。

## 直接游玩

双击 **index.html** 即可。解压后保持整个文件夹完整，包含 `vendor`、`js`、`css` 和 `assets`。

无需安装依赖、联网、账号或服务器。适用于支持 WebGL 2、已启用硬件加速的现代电脑浏览器；首版使用键盘操作，未提供手机触控驾驶。

可选本地预览（需要 Node.js，无须 npm install）：

```sh
cd kart-racer
npm start
```

打开 http://localhost:5190。端口可使用 `PORT=5191 npm start` 更改。

## 操作

| 按键 | 功能 |
| --- | --- |
| W / ↑ | 加速 |
| S / ↓ | 刹车，停下后倒车 |
| A、D / ←、→ | 左右转向 |
| Shift + 转向 | 速度达到约 50 km/h 后漂移集气 |
| Space | 使用氮气，持续约 2.3 秒，最多存两瓶 |
| R | 返回有效赛道位置，短暂冷却，复位不增加圈数 |
| Esc | 暂停 / 继续 |

入弯前松开油门或轻踩刹车，配合 Shift 漂移。不同弯道获得的能量会保留，集满得到一瓶氮气；出弯直道加速更有效。驶出路面会减速，护栏与车辆碰撞也会损失速度。

漂移时后轮会产生渐散的烟雾、轮胎辉光和连续胎痕，火花随集气从蓝色过渡到金色；集满氮气会触发金色火花迸发和“氮气就绪”提示。粒子使用固定容量循环复用，松开漂移后自然消散，暂停时冻结，复位和重开时清理残留特效。

按顺序通过检查点才能计圈；逆行不增加圈数，漏过检查点时按 R 返回。离开窗口自动暂停并清空按键状态。个人最佳成绩、赛道、车身颜色和声音开关在浏览器本地保存；浏览器禁止存储时仍可游玩。

## 实现

原生 JavaScript + Three.js 0.180.0，固定 60 Hz 驾驶更新，独立动画渲染。赛道使用闭合样条和等距采样；电脑基于前视路径、弯道速度规划和车道偏移驾驶。模型、道路、纹理和声音由程序生成，无远程资源或第三方跟踪。

Three.js 从 [官方 npm 包](https://www.npmjs.com/package/three/v/0.180.0) 构建为本地普通脚本，确保 `file://` 下可用。引擎许可位于 `vendor/three.LICENSE.txt`。Three.js 的安装方式见[官方文档](https://threejs.org/manual/en/installation.html)。

源文件职责：`tracks.js` 提供赛道配置；`core.js` 实现驾驶和比赛规则；`world.js` 构建与渲染场景；`audio.js` 合成声音；`game.js` 管理输入、界面与本地成绩。`window.__kart.snapshot()` 提供只读诊断快照。

## 开发与验证

```sh
npm ci
npm run check
npm run check:tracks
npm test
npm run test:e2e
```

核心测试覆盖检查点、逆行、氮气、碰撞、暂停、排名、八条赛道电脑完赛与重开。浏览器测试通过真实键盘输入检查驾驶、漂移、加速、结算，并用实际渲染镜头验证方向键和 A/D 在普通驾驶、漂移时的左右转向。另覆盖断网直接打开、存储受限、画面不支持与不同窗口尺寸。测试失败保留截图与 trace，HTML 报告在 `playwright-report`。

如测试机器没有 Playwright Chromium，先运行 `npx playwright install chromium`，或使用 `BREEZE_BROWSER_PATH=/path/to/chromium npm run test:e2e`。macOS 上也会识别已有 Playwright Chromium 缓存。

仅升级或重新构建内置引擎时运行 `npm run vendor`；正常游戏无构建步骤。开启系统“减少动态效果”会关闭装饰镜头摆动、加速视野扩张、漂移烟雾、火花和轮胎辉光，保留胎痕和静态集气提示；运行中切换该设置也会生效。
