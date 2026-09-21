# AI 侧边栏去头扩展

配套 `fenbi-ai-sidebar.user.js` 用的。装了这个扩展，侧边栏里选「嵌入」才会真的
把 ChatGPT / Gemini 嵌进粉笔页面，而不是给你一个白框。

## 它做了什么

主流 AI 站点都发 `X-Frame-Options: DENY` 和带 `frame-ancestors` 的 CSP，浏览器
收到这两样就拒绝把页面画进 iframe。这是**浏览器层面**的拦截，油猴脚本改不了 ——
脚本能改 DOM，改不了响应头。

扩展有 `declarativeNetRequest` 权限，能在响应头到达浏览器之前把它们删掉。就这么
一件事。

## 装

1. Chrome 打开 `chrome://extensions`
2. 右上角打开「开发者模式」
3. 「加载已解压的扩展程序」，选这个目录

装好后打开粉笔背题页，按 F12，控制台应该有一行 `[AI 去头] 已生效`。

## 安全边界 —— 请读完

**这个扩展关掉的是浏览器专门用来防点击劫持的保护。** 所以要给它划清范围：

- **只对子框架生效**（`resourceTypes: ["sub_frame"]`）。它不会碰顶层导航，也不会
  碰 XHR / fetch，别的网页该被拦还是被拦。
- **只对来自 fenbi.com 的请求生效**（`initiatorDomains`）。从其他网站发起的 iframe
  请求不受影响 —— 否则等于给全网的点击劫持开门。测试页 `localhost` 是唯一的例外。

即便如此，还是有两件事你得知道：

1. **CSP 是被整个删掉的，不是只删 `frame-ancestors`。** DNR 的 `modifyHeaders` 只能
   整条增删，没法做「保留 A 指令、去掉 B 指令」这种手术。所以这些站点在 iframe 里
   跑的时候，它们自己那层 CSP 防护也没了。
2. **嵌进去的站点是真实的、登录状态的站点。** 没有沙箱隔离，它在 iframe 里能做的事
   和在独立标签页里一样。

**建议：验完就关。** 平时不用嵌入模式的话，`chrome://extensions` 里把它停用，
或者直接删掉 —— 侧边栏脚本检测不到标记会自动退回窗口模式，功能不受影响。

## 自检

```bash
cd fenbi-ai-unframe
python3 -m http.server 8000
```

开 `http://localhost:8000/test.html`，点上面的按钮逐个试。

## 文件

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | MV3 清单，声明权限、域名范围、content script |
| `rules.json` | 30 条 DNR 规则，一条一个域名 |
| `content.js` | 往 `documentElement` 打 `data-fbai-unframe="1"`，告诉侧边栏脚本「扩展在」 |
| `test.html` | 本地自检页 |
| `domains.json` | 域名列表，唯一的手改入口 |
| `build-rules.mjs` | 从 `domains.json` 生成 `rules.json` 并同步 `manifest.json` |

**`rules.json` 和 `manifest.json` 的域名部分是生成的，别手改**，改 `domains.json` 然后：

```bash
node build-rules.mjs
```

加一个 AI 站点只改这一个文件。测试里有一条新鲜度检查，忘了跑的话会直接报错告诉你跑。

## 为什么需要那个标记

跨域 iframe 被拦掉之后，外面那层脚本**分不清「加载好了」和「被拦了」** —— 两种
情况 `onload` 都照常触发，`contentDocument` 都拿不到。

所以不猜：扩展自己在页面上打个标记，脚本读到标记就默认用嵌入模式，读不到就默认
开独立窗口。两条路都不会让用户对着白框发呆。
