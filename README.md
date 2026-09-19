# 粉笔刷题/背题页面布局优化

一个 Tampermonkey 油猴脚本，重排粉笔（fenbi.com）背题页面的布局。

核心解决一件事：**点完选项等解析的那一下卡顿**。

---

## 效果对比

| | 原版 | 装了脚本 |
|---|---|---|
| 点选项出解析 | 等 Angular 取数 + 渲染，肉眼可见地卡一下 | 从已缓存的数据瞬时渲染 |
| 考点 / 来源 | 只有被渲染过的题才有，且只显示第一个考点 | 全部题目都有，多考点完整显示 |
| VIP 视频 / 笔记 | 占据大片版面 | 隐藏 |
| 题目宽度 | 跟随窗口无限拉宽 | 限宽 900px 居中，右侧给答题卡留位 |
| 题目 / 选项 | 白色圆角块，无边框，靠 20px 底色间距分隔 | 各自成卡片：边框 + 圆角 + 淡阴影，选项之间留 10px 间距 |
| 解析 | 展开时和 Angular 的折叠动画打架，会闪 | 自建面板，默认折叠，展开/收起按钮加大到 15px |
| 答题卡 | 原生 | 右上角自制悬浮答题卡（原生答题卡移出屏幕，跳转逻辑保留） |

---

## 安装

1. 先给浏览器装 [Tampermonkey](https://www.tampermonkey.net/)（Chrome / Edge / Firefox / Safari 都有）。
2. 点这个链接安装脚本：

   **https://raw.githubusercontent.com/baimochen/fenbi-userscript/main/fenbi-memorize-layout.user.js**

   Tampermonkey 会自动识别并弹出安装页。
3. 打开粉笔背题页面（`spa.fenbi.com/ti/memorize/...`），刷新一次。

因为脚本头部写了 `@downloadURL` / `@updateURL`，以后这里发新版，Tampermonkey 会自动提示更新，不用手动重装。

---

## 它做了什么

### 1. 拦截接口，一次拿全

背题页的解析数据来自 `tiku.fenbi.com/combine/static/solution`。这个接口**一次性返回整份练习所有题目的** `solution` / `source` / `keypoints` / `correctAnswer`。

脚本在 `document-start` 同时挂钩 `XMLHttpRequest` 和 `fetch`，把这份响应抄下来存进 `Map`。`globalId` 和页面上 `app-ti[data-question-key]` 一一对应，所以能精确地把数据挂到对应题目上。

> 为什么不自己发请求？因为 URL 里的 `key` 参数不在页面 HTML 里，由粉笔的前端运行时生成，脚本无法复现。挂钩是唯一可靠的办法。

### 2. 自建解析面板

粉笔对每道题的解析区是**懒渲染**的：你没点过的题，`app-result-common`、`app-solution-overall` 这些节点根本不在 DOM 里，连正确答案的高亮都没有。点完选项之后 Angular 才去渲染，这就是卡顿的来源。

脚本改为在每题的 `.ti-container` 里挂一个自己的 `.fb-sol-panel`，内容全部来自缓存。面板默认隐藏，在 `document` 上用捕获阶段的 `click` 监听选项，点到就立刻加 `.fb-sol-visible` —— **抢在 Angular 前面**，不等网络也不等渲染。

同时把原生 `app-result-common` 整块隐藏（里面只有 video / solution / keypoint / source / note，全是这个脚本本来就要隐藏的），页面上只留一套解析 UI，不会再出现"闪一下再折叠"。

### 3. 修掉一个自我触发的重排死循环

这是卡顿的真正技术原因，也是 2.0 最大的改动，值得单独说：

原版脚本里 `updateCustomCard()` 每一轮都会无条件写 `count.textContent = ...`。而写 `textContent` 会移除旧文本节点、插入新节点，**产生新的 mutation**；MutationObserver 又正好监听 `document.body` 的 subtree，于是再次触发自己。结果是：

```
写入 → mutation → observer(150ms) → 全页重扫 + 80 次 innerText 强制重排 → 写入 → ...
```

一个永动的 150ms 循环，每轮都在一个 700KB 的 DOM 上强制同步布局。

2.0 做了三件事断掉它：

- **所有写操作先比对再写**：`setText()`、`important()`（比对 `getPropertyValue` + priority）、`classList.toggle(name, force)`。值没变就不碰 DOM，不产生 mutation，循环自然收敛。
- **热路径里删掉全部 `innerText`**：`innerText` 会强制同步重排，改用 `textContent`。
- **冷热分离**：`optimizeDynamic()`（面板同步 + 答题卡）跟着 mutation 走；`optimizeQuestionWidth` / `optimizeOverall` / `hideVipModules` 降级为 1.5 秒一次的低频兜底——这些选择器 CSS 本来就全覆盖了。

另外 `getCurrentQuestionIndex()` 的几何回退要读 40 次 `getBoundingClientRect`，加了 250ms 缓存，不再每次 mutation 重算。

---

## 配置

脚本顶部 `CONFIG` 可以调：

| 键 | 默认 | 说明 |
|---|---|---|
| `questionMaxWidth` | `900` | 题目最大宽度（px） |
| `rightReserve` | `250` | 右侧给答题卡预留的空间（px） |
| `cardTop` | `65` | 答题卡距顶部（px） |
| `cardRight` | `16` | 答题卡距右侧（px） |
| `cardWidth` | `220` | 答题卡宽度（px） |
| `columns` | `5` | 答题卡题号列数 |
| `observerDelay` | `150` | MutationObserver 防抖（ms） |
| `layoutInterval` | `1500` | 低频布局兜底周期（ms） |
| `currentIndexTTL` | `250` | 当前题号几何回退缓存（ms） |

---

## 日志与自检

装好后打开控制台，会看到两条日志：

```
[粉笔布局优化] 2.3 已加载
[粉笔布局优化] 接口解析缓存：本次新增 40，缓存共 40 道 / 页面共 40 道
```

**重点看第二条**：`缓存共 N 道 / 页面共 M 道`。

- `N == M` → 接口一次拿全了，一切正常。
- `N` 明显小于 `M` → 这个接口变成了按题返回，需要在脚本里加按题预取。

---

## 常见问题

**Q：解析没出来 / 面板是空的？**
先看控制台有没有第二条日志。没有的话说明接口拦截没命中——可能是粉笔改了接口路径，改 `CONFIG` 附近的 `API_KEYWORD` 常量即可。

**Q：刷新之后解析全都不见了？**
2.1 已修。2.0 的面板只认"本次加载里点过选项"，刷新把状态清零就会满页空白。现在已答的题会自动显示解析入口。

**Q：解析入口什么时候显示？**
三种情况任一即可：点过该题选项（原有行为）、该题已作答、该题是填空题。除此之外保持折叠，正文要手动展开。

**Q：接口挂了脚本会整个失效吗？**
不会。脚本保留了 DOM 兜底：缓存没命中时会退回抓原生 `section-solution` / `section-source` / `section-keypoint`。只是这种情况下又会回到"粉笔渲染过才有"的老行为。

**Q：公式题显示不正常？**
解析正文是把接口返回的 HTML 直接 `innerHTML` 注入的（和粉笔自己渲染的是同一份）。粉笔的原生 `app-format-html` 组件可能对公式（MathLive）做了额外处理，注入的原始 HTML 有可能渲染不到位。遇到的话开 issue 附上题目。

**Q：正确选项的高亮还是慢？**
选项高亮由粉笔原生逻辑负责，脚本没有接管。接口返回里有 `correctAnswer.choice`，理论上可以自己上色，但改动选项组件风险较高，所以没做。需要的话开 issue。

---

## 已知限制

- 只在**背题页**（`/ti/memorize/...`）实测过。做题页、模考页的 DOM 结构不同，不保证生效。
- 依赖粉笔的接口路径和 `data-question-key` 属性。粉笔前端改版会导致失效，上面两条自检日志就是用来快速定位的。
- 解析内容全部来自粉笔自己的接口，脚本不生成也不存储任何题目内容。

---

## 更新日志

### 2.3

修 2.2 卡片布局的一个问题：**题目外面多了一圈白边**。

2.2 把卡片做到了里层的 `.ti-container` 上，但粉笔自己就已经把每个题组包在 `.questions-single-container` 里，并且给了它 `border-radius:8px` / `overflow:hidden` / 白底 / `padding:12px 0 16px` —— 它本来**就是**一张卡片，只是没画边框。两层卡片叠起来，外面那层的白底和上下内边距就从四周露出来了。

2.3 把卡片移到外层容器上，里层 `.ti-container` 恢复原样。顺带三处都是好的：

- 外层容器的 `overflow:hidden` 正好用来裁已答题时那条红/绿渐变条。2.2 为了绕开它写的那套 `top` / `border-radius` 兜底可以删掉，只留「贴紧新边框」的 1px 修正。
- 题目之间的 20px 间距本来就有（外层 `.ti` 带 `margin-bottom:20px`），2.2 自己加的 `margin-bottom:16px` 是多余的，删掉，否则会变成 36px。
- 「材料题」里粉笔画在子题之间那条 1px 分隔线恢复显示（2.2 把它误当成重复的给隐藏了）。

另外把每张卡片最后一题的 `padding-bottom` 归零（上下 12px / 16px，基本对称）。粉笔给的 14px 是给材料题分隔线定位用的，所以只归零 `:last-child`。

### 2.2

- **题目区宽度 1200px → 900px**
- **题目与选项卡片化**：题目加边框、圆角、淡阴影；每个选项加边框，选项之间留 10px 间距
- 卡片颜色全部走粉笔自己的 CSS 变量（`--color-border-section` / `--color-bg-section` / `--color-border-choice`），**暗色模式自动跟随**，没有另配一套颜色

一个实现上的注意点：

- 选项卡片**没有**写死 `background`。卡片本身就是白底，透明即白底；一旦写死就会盖掉粉笔原生的 `:hover` 变色。

题目卡片当时做在 `.ti-container` 上，2.3 已改到外层 `.questions-single-container`——原因见上。同时撤销了 2.2 的另外两处：隐藏题目之间的 1px 分隔线、把 `app-ti` 的 `padding-bottom` 归零。

### 2.1

修两个"解析不显示"的问题。两者现象像、根因不同：

- **多选点了没反应** —— 点选项的监听只认单选的 `.choice-radio` 那一套 class，多选用的 `.choice-checkbox` / `.option-checkbox` 不在里面，点了不会展开面板。现已补齐。
- **刷新后所有题的解析都不见了** —— 面板可见性原先**只**由"本次页面加载里点过这个选项"决定，而原生解析块又被 CSS 无条件隐藏。刷新会把"点过"的状态清零，于是满页空白。现在改为**已答即显示**：加载时判断题目是否已作答（单选/判断/多选看选项上的 `correct` / `wrong` / `correctLost`，填空等用"粉笔是否已渲染原生解析"兜底），已答的直接露出解析入口，不用再点一遍。
- **填空题解析常显** —— 填空题没有任何选项元素可点，改为无条件显示。
- 面板语义不变：露出的是折叠状态的入口，正文仍要手动展开。

### 2.0

- 新增接口拦截，一次取全解析/来源/考点
- 新增自建解析面板，点选项瞬时显示，不再依赖粉笔的懒渲染
- 修复自我触发的 150ms 重排死循环（写入前比对 + 移除 `innerText` + 冷热分离）
- 考点支持多考点（原版用 `querySelector` 只取第一个）
- 展开/收起按钮字号 12px → 15px
- 保留 DOM 兜底路径

### 1.9

- 隐藏 VIP 视频 / 笔记
- 题目限宽、考点与来源移入题目信息区
- 自制悬浮答题卡
- 解析默认折叠

---

## 说明

个人学习辅助工具，供自己背题时少点几下鼠标用。请配合粉笔官方服务使用，不要用于批量抓取或再分发题目内容。
