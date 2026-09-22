// ==UserScript==
// @name         粉笔刷题/背题页面布局优化
// @namespace    https://github.com/baimochen/fenbi-userscript
// @version      2.8
// @description  粉笔背题页面优化：拦截接口一次取全解析/来源/考点、点选项瞬出、隐藏VIP视频/笔记、限宽 900px、题目与选项卡片化、自制答题卡、解析栏一键复制题目
// @author       baimochen
// @match        *://*.fenbi.com/*
// @run-at       document-start
// @grant        none
// @homepageURL  https://github.com/baimochen/fenbi-userscript
// @supportURL   https://github.com/baimochen/fenbi-userscript/issues
// @downloadURL  https://raw.githubusercontent.com/baimochen/fenbi-userscript/main/fenbi-memorize-layout.user.js
// @updateURL    https://raw.githubusercontent.com/baimochen/fenbi-userscript/main/fenbi-memorize-layout.user.js
// ==/UserScript==

(function () {
    'use strict';

    // 版本号。
    //
    // 只在头部 @version 和这里各写一次，测试盯着这两处必须一致 —— 对不上
    // 就会出现「日志说 2.5，装的是 2.4」这种事，而版本号正是用来判断「我
    // 装的是哪版」的，它自己不可信就白搭了。
    //
    // 这个坑真踩过，踩在隔壁的侧边栏上：加了「询问 AI」一整条链路却没动
    // 版本号，日志和旧版一字不差，于是「点了没反应」到底是旧版没这功能、
    // 还是新版坏了，从页面上完全看不出来。这份脚本当时是漏网的 —— 现在补上。
    const VERSION = '2.8';


    // =========================================================
    // 配置
    // =========================================================

    const CONFIG = {

        // =====================================================
        // 宽度 —— 要调就调这两个
        // =====================================================

        // 答题区（题干 + 选项）的宽度上限。
        //
        // 屏幕不够宽的时候会自动缩，不会溢出去。想让题目排得舒展就往上加，
        // 想让它窄一点、眼睛少走些路就往下减。
        questionMaxWidth: 900,

        // 答题卡的宽度。
        //
        // 答题卡钉在右上角，它占掉的横向空间是从答题区里扣掉的（见下面的
        // RIGHT_RESERVE），所以改这一个数就够了，不用再去别处同步。
        //
        // 这个数和 .fbac-body 的内边距是一对，不能单独动：题号区实宽 =
        // 本值 - 2（面板边框）- 内边距 * 2，而实宽决定一行几个题号。
        // 240 / 16px 这一组算出来是 206px，正好还是 5 列。想再加内边距
        // 就得把这个数一起往上加，否则默认列数会从 5 掉到 4。
        // test/card.test.mjs 里有一条断言把这两个数绑在一起。
        cardWidth: 240,

        // =====================================================

        // 答题卡
        cardTop: 65,
        cardRight: 16,

        // 答题卡下边缘离屏幕底留多少。
        //
        // 它决定卡片的高度上限（题目多了就从这儿开始滚），值照抄侧边栏的
        // panelBottom，两块悬浮物上下留白才是齐的。
        cardBottom: 16,

        // 答题卡和答题区之间留的空隙。调到 0 两块就贴一起了。
        cardGap: 14,

        // 答题卡里每个题号格子的最小宽度。
        //
        // 一行排几个是**算出来的**，不是写死的（原先这里是个 columns: 5）。
        // 写死的话，卡放宽了格子白白变胖、卡被媒体查询压窄了格子又挤成一条，
        // 而且两种都不报错。
        //
        // 33 是照格子的高度来的 —— 格子高 33px，宽高相等就是正方形。
        minCellWidth: 33,

        // 题号格子之间的间距。
        //
        // 算列数要用它，画格子也要用它，所以从 CSS 提到这儿来。抄两份的话，
        // 改了 CSS 里的 gap，列数还按老间距算，最后一行会挤出去或者缺一块。
        gridGap: 7,

        // =====================================================

        // 两个悬浮物的层级。
        //
        // 必须和 fenbi-ai-sidebar.user.js 的 CONFIG.zIndex 相等，有测试盯着。
        //
        // 这个数要夹在粉笔自己的**内容层和模态层之间**：
        //
        //   500  —— 粉笔页面元素里最高的那个（--z-index-footer）
        //   900  —— 我们
        //   1000 —— 粉笔「暂停答题」的遮罩（DIV.modal-overlay，盖满屏幕、
        //           半透明黑）
        //
        // 比 500 低，答题卡会被页脚之类的东西压住；比 1000 高，暂停时就会
        // 浮在遮罩上面 —— 遮罩是模态的，浮在它上面的东西看着就是穿帮。
        //
        // 原先这里是 2147483646，比遮罩高了一截，于是「暂停答题」盖住了 AI
        // 面板、盖不住答题卡。当时误判成「两个助手差一位数」，把两边调成同
        // 一个数就以为修好了 —— 其实真正的原因是侧边栏的宿主元素没有
        // z-index（见 fenbi-ai-sidebar.user.js 里那段注释），两个数根本不在
        // 一个档上，比不了。
        zIndex: 900,

        // Observer 延迟
        observerDelay: 150,

        // 布局类优化的低频周期
        layoutInterval: 1500,

        // 当前题号几何回退的缓存时长
        currentIndexTTL: 250
    };


    // 答题卡占掉的横向空间：右边距 + 卡宽 + 和答题区之间的空隙。
    //
    // 算出来而不是写死 —— 写死的话，改了 cardWidth 忘了改它，答题卡就压在
    // 题目上了。这个坑原来就在，只是没人去动那个数所以没踩到。
    const RIGHT_RESERVE =
        CONFIG.cardRight + CONFIG.cardWidth + CONFIG.cardGap;


    const PANEL_CLASS = 'fb-sol-panel';
    const PANEL_VISIBLE = 'fb-sol-visible';
    const PANEL_EXPANDED = 'fb-sol-expanded';
    const TOGGLE_CLASS = 'fb-solution-toggle';
    const COPY_CLASS = 'fb-copy-question';

    const API_KEYWORD = '/combine/static/solution';


    // 复制按钮上显示的字，以及复制成功后短暂替换成的字
    const COPY_LABEL = '复制题目';
    const COPY_DONE_LABEL = '已复制 ✓';

    // 复制成功提示停留时长
    const COPY_FEEDBACK_MS = 1500;


    // 展开 / 收起按钮上的字。
    //
    // 提成常量是因为它俩在代码里各出现两次 —— 初始 HTML 里写一次，点完
    // 之后再回写一次。抄两遍就会有一遍忘了改，表现是点一下按钮上的字就
    // 变回了旧的。
    //
    // 展开那半句带着「解析」两个字：标题栏最左边原来有个「解析」标题，
    // 删掉之后这层意思只能由按钮自己扛着。
    const EXPAND_LABEL = '解析和展开 ▾';
    const COLLAPSE_LABEL = '收起 ▴';


    // =========================================================
    // 「询问 AI」
    //
    // 这个按钮自己不做任何 AI 的事 —— 它把题目写在一个 DOM 属性上，发一个
    // 事件，然后读另一个属性看结果。真正干活的是 fenbi-ai-sidebar.user.js。
    //
    // 为什么不直接调函数：粉笔页面上的两份脚本各在油猴自己的沙箱里，看不到
    // 对方的变量。能共用的只有 DOM。
    //
    // 为什么用属性传而不是 CustomEvent.detail：detail 跨沙箱传不传得过来
    // 不稳，属性是两边都看得见的普通 DOM。
    //
    // 三个名字必须和 fenbi-ai-sidebar.user.js 里的那几个一致，有测试盯着。
    // =========================================================

    const ASK_CLASS = 'fb-ask-ai';

    const ASK_LABEL = '询问 AI';

    const ASK_EVENT = 'fbai-ask';
    const ASK_ATTR = 'data-fbai-ask';
    const ASK_RESULT_ATTR = 'data-fbai-ask-result';

    // 结果码 -> 按钮上闪的字。侧边栏写码，这边负责说人话。
    const ASK_RESULT_LABELS = {
        sent: '已发送 ✓',
        copied: '已复制 ✓',
        none: '没送出去'
    };


    // =========================================================
    // 「下载」按钮
    //
    // 答题界面右上角「交卷」旁边那个。目前只把它吃掉（点了没反应），
    // 不做别的 —— 以后要接管下载内容，往 window.fbDownloadHook 里写函数。
    //
    // 用标签名认，不用 class：button 的 class 一改版就换一批，
    // 而 app-download 是粉笔自己的组件名，改它等于改组件。
    // =========================================================

    const DOWNLOAD_SELECTOR = 'app-download';


    // =========================================================
    // 自定义刷题：任意出题数量
    //
    // 只在目录页（www.fenbi.com/spa/tiku/guide/catalog）那个「自定义刷题」
    // 模态框里干活。别处一律不碰 —— 这是别人的页面，不是我们的。
    // =========================================================

    const CATALOG_PATH = '/spa/tiku/guide/catalog';

    const COUNT_LIST_SELECTOR =
        '.customize-question-content .question-mode-count';

    const CUSTOM_COUNT_INPUT_CLASS = 'fb-count-input';

    // 出题数量的上下界。
    //
    // 上界不是随手定的：粉笔自己给的最大预设是 40。放到 500 是为了留出
    // 「整套刷一遍」这种用法，再往上就没有意义了 —— 一次推几千道题只会把
    // 接口拖死，而用户很可能只是多按了个 0。
    const MIN_CUSTOM_COUNT = 1;
    const MAX_CUSTOM_COUNT = 500;

    // 探针武装多久。
    //
    // 点完自定义数量到点「保存」之间要留出人手操作的时间，3 秒是估的。
    // 真过了也能在控制台敲 fbCountProbe() 再来一次。
    const PROBE_WINDOW_MS = 3000;

    // 探针日志的前缀。测试盯着它 —— 控制台里没有这个前缀就分不出哪几行
    // 是探针打的。
    const PROBE_TAG = '[粉笔自定义数量·探针]';


    let customCard = null;
    let observerTimer = null;
    let layoutTimer = null;

    // 答题卡收起来时带的类。
    //
    // 名字跟卡片自己那套 fbac-* 一致。CSS 里那条 .fbac-hidden 必须带
    // !important，理由写在那边。
    const CARD_HIDDEN_CLASS = 'fbac-hidden';

    /*
     * 接口缓存：globalId -> solution 对象。
     *
     * globalId 与 app-ti[data-question-key] 一一对应。
     */
    const solutionCache = new Map();


    // =========================================================
    // 工具
    // =========================================================

    function qs(selector, root = document) {
        return root.querySelector(selector);
    }


    function qsa(selector, root = document) {
        return Array.from(root.querySelectorAll(selector));
    }


    /*
     * 写内联样式前先比对。
     *
     * 这是本版最关键的性能修复之一：
     * 重复写入同样的值会产生 mutation，
     * 而 observer 监听 body 子树，
     * 于是形成 150ms 的自我触发死循环。
     */
    function important(el, property, value) {

        if (!el) return;

        try {

            if (
                el.style.getPropertyValue(property) === value &&
                el.style.getPropertyPriority(property) === 'important'
            ) {
                return;
            }

            el.style.setProperty(property, value, 'important');

        } catch (e) {}
    }


    /*
     * 同理：文本没变就不写。
     */
    function setText(el, text) {

        if (!el) return;

        if (el.textContent !== text) {
            el.textContent = text;
        }
    }


    function escapeHtml(text) {

        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }


    // =========================================================
    // ★ 接口拦截
    //
    // key 参数不在页面 HTML 里，由 SPA 自己生成，
    // 脚本无法复现，所以直接挂钩 XHR / fetch 抄响应。
    //
    // 该接口一次性返回整份练习的全部 solution，
    // 因此这里是「一次拿全」，不需要按题预取。
    // =========================================================

    function isSolutionApi(url) {

        return (
            typeof url === 'string' &&
            url.indexOf(API_KEYWORD) !== -1
        );
    }


    function ingestPayload(payload) {

        if (
            !payload ||
            !Array.isArray(payload.solutions)
        ) {
            return;
        }


        let added = 0;


        payload.solutions.forEach(
            item => {

                if (!item || !item.globalId) {
                    return;
                }


                if (!solutionCache.has(item.globalId)) {
                    added++;
                }


                solutionCache.set(
                    item.globalId,
                    item
                );
            }
        );


        const total = qsa('app-ti').length;


        console.log(
            '[粉笔布局优化] 接口解析缓存：' +
            '本次新增 ' + added +
            '，缓存共 ' + solutionCache.size +
            ' 道 / 页面共 ' + total + ' 道'
        );


        /*
         * 数据到手，立刻补面板。
         */
        optimizeDynamic();
    }


    function installNetworkHooks() {

        // -----------------------------------------------------
        // XMLHttpRequest
        // -----------------------------------------------------

        try {

            const proto = XMLHttpRequest.prototype;
            const rawOpen = proto.open;
            const rawSend = proto.send;


            proto.open = function (method, url) {

                try {
                    this.__fbUrl = url;
                    this.__fbMethod = method;
                } catch (e) {}


                return rawOpen.apply(this, arguments);
            };


            proto.send = function (body) {

                try {

                    /*
                     * 探针只看不动 —— 它不改 URL 也不改 body，
                     * 只是把发出去的东西抄一份到控制台。
                     */
                    noteProbeRequest(
                        this.__fbMethod,
                        this.__fbUrl,
                        body
                    );


                    if (isSolutionApi(this.__fbUrl)) {

                        this.addEventListener(
                            'load',
                            function () {

                                try {

                                    ingestPayload(
                                        JSON.parse(
                                            this.responseText
                                        )
                                    );

                                } catch (e) {}
                            }
                        );
                    }

                } catch (e) {}


                return rawSend.apply(this, arguments);
            };

        } catch (e) {}


        // -----------------------------------------------------
        // fetch
        // -----------------------------------------------------

        try {

            const rawFetch = window.fetch;


            if (rawFetch) {

                window.fetch = function (input, init) {

                    const url =
                        typeof input === 'string'
                            ? input
                            : (input && input.url) || '';


                    try {

                        noteProbeRequest(
                            (init && init.method) ||
                                (input && input.method) ||
                                'GET',
                            url,
                            init && init.body
                        );

                    } catch (e) {}


                    const promise =
                        rawFetch.apply(this, arguments);


                    if (isSolutionApi(url)) {

                        promise
                            .then(
                                response => {

                                    try {

                                        response
                                            .clone()
                                            .json()
                                            .then(ingestPayload)
                                            .catch(() => {});

                                    } catch (e) {}
                                }
                            )
                            .catch(() => {});
                    }


                    return promise;
                };
            }

        } catch (e) {}
    }


    // =========================================================
    // CSS
    // =========================================================

    function injectStyle() {

        if (
            document.getElementById(
                'fenbi-layout-v20-style'
            )
        ) {
            return;
        }


        const style =
            document.createElement('style');


        style.id =
            'fenbi-layout-v20-style';


        style.textContent = `

            /* =====================================================
               VIP 视频 / 笔记
               ===================================================== */

            html body
            [id^="section-video"],

            html body
            [id*="section-video"],

            html body
            .section-video,

            html body
            .solution-video,

            html body
            .solution-video-container,

            html body
            app-solution-video,

            html body
            [class*="solution-video"],

            html body
            [class*="vip-video"],

            html body
            [class*="video-solution"],

            html body
            [id^="section-note"],

            html body
            [id*="section-note"],

            html body
            .section-note,

            html body
            .solution-note,

            html body
            .solution-note-container,

            html body
            app-solution-note,

            html body
            [class*="solution-note"],

            html body
            [class*="note-container"],

            html body
            [class*="vip-note"] {

                display: none !important;

                visibility: hidden !important;

                pointer-events: none !important;
            }


            /* =====================================================
               ★ 原生解析整块隐藏

               app-result-common 里只有
               video / solution / keypoint / source / note，
               全部是我们不要的东西，
               所以整块干掉，只留自制面板一套 UI。

               这样就彻底摆脱粉笔的按题懒渲染：
               没点过的题不再需要等 Angular 渲染。
               ===================================================== */

            html body
            app-result-common,

            html body
            [id^="section-solution"],

            html body
            [id*="section-solution"],

            html body
            [id^="section-keypoint"],

            html body
            [id*="section-keypoint"],

            html body
            [id^="section-source"],

            html body
            [id*="section-source"] {

                display: none !important;

                visibility: hidden !important;
            }


            /* =====================================================
               ★ 自制解析面板

               默认整块不显示，满足下面任一条才加 .fb-sol-visible：
               点过该题选项 / 该题已作答 / 填空题（常显）。

               见 syncPanelVisibility()。
               ===================================================== */

            html body
            .${PANEL_CLASS} {

                display: none;

                width: 100% !important;

                max-width: 100% !important;

                min-width: 0 !important;

                margin: 10px 0 0 !important;

                padding: 8px 0 0 !important;

                border-top: 1px dashed #e8eaee !important;

                box-sizing: border-box !important;
            }


            html body
            .${PANEL_CLASS}.${PANEL_VISIBLE} {

                display: block;
            }


            /* =====================================================
               考点 / 来源行
               ===================================================== */

            html body
            .${PANEL_CLASS} .fb-sol-row {

                display: flex !important;

                flex-direction: row !important;

                align-items: flex-start !important;

                justify-content: flex-start !important;

                width: 100% !important;

                min-width: 0 !important;

                padding: 1px 0 !important;

                box-sizing: border-box !important;
            }


            html body
            .${PANEL_CLASS} .fb-sol-label {

                flex: 0 0 auto !important;

                margin-right: 5px !important;

                color: #8a9099 !important;

                font-size: 11px !important;

                line-height: 18px !important;

                font-weight: 400 !important;

                white-space: nowrap !important;
            }


            html body
            .${PANEL_CLASS} .fb-sol-text {

                flex: 1 1 auto !important;

                min-width: 0 !important;

                font-size: 11px !important;

                line-height: 18px !important;

                font-weight: 400 !important;

                white-space: normal !important;

                word-break: break-all !important;

                overflow-wrap: anywhere !important;

                text-align: left !important;
            }


            html body
            .${PANEL_CLASS} .fb-sol-keypoint .fb-sol-text {

                color: #4b91d9 !important;
            }


            html body
            .${PANEL_CLASS} .fb-sol-source .fb-sol-text {

                color: #737982 !important;
            }


            /* =====================================================
               解析标题栏
               ===================================================== */

            html body
            .${PANEL_CLASS} .fb-sol-head {

                display: flex !important;

                flex-direction: row !important;

                align-items: center !important;

                justify-content: flex-start !important;

                flex-wrap: nowrap !important;

                margin-top: 7px !important;

                box-sizing: border-box !important;
            }


            /* =====================================================
               ★ 复制题目

               和「询问 AI」「展开 / 收起」并排，靠 margin-left:auto
               这一组一起顶到标题栏右侧 —— 标题栏左边那个「解析」标题
               已经删了，整行只剩右边这三个按钮。

               颜色比展开按钮重一档 —— 它是主动作，展开只是看解析。
               ===================================================== */

            html body
            .${PANEL_CLASS} .${COPY_CLASS} {

                appearance: none !important;

                -webkit-appearance: none !important;

                flex: 0 0 auto !important;

                margin: 0 0 0 auto !important;

                padding: 3px 12px !important;

                border: 1px solid #bcd6f2 !important;

                border-radius: 999px !important;

                background: #eef5fd !important;

                color: #2f6feb !important;

                font-family: inherit !important;

                font-size: 15px !important;

                line-height: 22px !important;

                font-weight: 400 !important;

                white-space: nowrap !important;

                cursor: pointer !important;

                user-select: none !important;

                outline: none !important;

                box-sizing: border-box !important;

                transition:
                    background 0.12s ease,
                    border-color 0.12s ease !important;
            }


            html body
            .${PANEL_CLASS} .${COPY_CLASS}:hover {

                background: #e0edfc !important;

                border-color: #8fbdf0 !important;
            }


            /* 复制成功后的瞬时反馈 */

            html body
            .${PANEL_CLASS} .${COPY_CLASS}.fb-copied {

                background: #e8f6ec !important;

                border-color: #a8d8b9 !important;

                color: #2c8a4b !important;
            }


            /* =====================================================
               ★ 询问 AI

               和「复制题目」并排。做成实心蓝，跟旁边两个描边按钮区分开
               —— 这一下会把东西发出去，是这排里唯一的主动作。

               不抢 margin-left:auto，那个由复制按钮负责把整组顶到右边。
               ===================================================== */

            html body
            .${PANEL_CLASS} .${ASK_CLASS} {

                appearance: none !important;

                -webkit-appearance: none !important;

                flex: 0 0 auto !important;

                margin: 0 0 0 8px !important;

                padding: 3px 12px !important;

                border: 1px solid #2f6feb !important;

                border-radius: 999px !important;

                background: #2f6feb !important;

                color: #fff !important;

                font-family: inherit !important;

                font-size: 15px !important;

                line-height: 22px !important;

                font-weight: 400 !important;

                white-space: nowrap !important;

                cursor: pointer !important;

                user-select: none !important;

                outline: none !important;

                box-sizing: border-box !important;

                transition:
                    background 0.12s ease,
                    border-color 0.12s ease !important;
            }


            html body
            .${PANEL_CLASS} .${ASK_CLASS}:hover {

                background: #2a63d4 !important;

                border-color: #2a63d4 !important;
            }


            /* 闪反馈时两个按钮共用 .fb-copied，这里要盖回实心底 */

            html body
            .${PANEL_CLASS} .${ASK_CLASS}.fb-copied {

                background: #2c8a4b !important;

                border-color: #2c8a4b !important;

                color: #fff !important;
            }


            /* =====================================================
               ★ 展开 / 收起按钮

               本版按需求放大到 15px。
               ===================================================== */

            html body
            .${PANEL_CLASS} .${TOGGLE_CLASS} {

                appearance: none !important;

                -webkit-appearance: none !important;

                flex: 0 0 auto !important;

                margin: 0 0 0 8px !important;

                padding: 3px 12px !important;

                border: 1px solid #e0e4ea !important;

                border-radius: 999px !important;

                background: #fff !important;

                color: #4b91d9 !important;

                font-family: inherit !important;

                font-size: 15px !important;

                line-height: 22px !important;

                font-weight: 400 !important;

                white-space: nowrap !important;

                cursor: pointer !important;

                user-select: none !important;

                outline: none !important;

                box-sizing: border-box !important;

                transition:
                    background 0.12s ease,
                    border-color 0.12s ease !important;
            }


            html body
            .${PANEL_CLASS} .${TOGGLE_CLASS}:hover {

                background: #f4f7fb !important;

                border-color: #bcd6f2 !important;
            }


            /* =====================================================
               解析正文

               面板可见 ≠ 解析展开，
               展开是第二个独立动作。
               ===================================================== */

            html body
            .${PANEL_CLASS} .fb-sol-body {

                display: none !important;

                margin-top: 6px !important;

                color: #4a4f57 !important;

                font-size: 13px !important;

                line-height: 22px !important;

                word-break: break-word !important;

                overflow-wrap: anywhere !important;
            }


            html body
            .${PANEL_CLASS}.${PANEL_EXPANDED} .fb-sol-body {

                display: block !important;
            }


            html body
            .${PANEL_CLASS} .fb-sol-body p {

                margin: 0 0 6px !important;
            }


            html body
            .${PANEL_CLASS} .fb-sol-body img {

                max-width: 100% !important;

                height: auto !important;
            }


            /* =====================================================
               题目主区域
               ===================================================== */

            html body
            .memorize-main {

                width:
                    calc(
                        100% - ${RIGHT_RESERVE}px
                    ) !important;

                max-width:
                    ${CONFIG.questionMaxWidth}px !important;

                margin-left: auto !important;

                margin-right: auto !important;

                box-sizing: border-box !important;

                display: block !important;

                min-width: 0 !important;
            }


            html body
            .memorize-main
            app-tis,

            html body
            .memorize-main
            .tis-container,

            html body
            .memorize-main
            app-ti {

                width: 100% !important;

                max-width: 100% !important;

                min-width: 0 !important;

                box-sizing: border-box !important;
            }


            /* =====================================================
               ★ 卡片布局

               题目、每个选项各自成卡片。

               颜色全部走粉笔自己的 CSS 变量，
               .dark 下自动翻转，不另配一套。
               ===================================================== */

            /*
             * 题目卡片做在 .questions-single-container 上，
             * 而不是里层的 .ti-container。
             *
             * 粉笔自己就把每个题组包在这个容器里，
             * 而且已经给了 border-radius:8px / overflow:hidden /
             * 白底 / padding:12px 0 16px —— 它本来就是一张卡片，
             * 只是没画边框。
             *
             * 再把卡片做一层到 .ti-container 上就成了「卡中卡」：
             * 外面那层白底和上下内边距会从卡片四周露出来，
             * 看上去就是题目外面多了一圈东西。
             *
             * 题目之间的 20px 间距也不用管：
             * 外层 .ti 本来就带 margin-bottom:20px。
             */

            html body
            .memorize-main
            .questions-single-container {

                border:
                    1px solid
                    var(--color-border-section) !important;

                box-shadow:
                    0 1px 3px rgba(0, 0, 0, .04) !important;

                box-sizing: border-box !important;
            }


            /*
             * 题目底部留白修一下。
             *
             * 粉笔给 app-ti 的 14px 内边距是给「材料题」里
             * 那条 1px 分隔线定位用的（分隔线 bottom:2px
             * 挂在 app-ti 上），所以 :not(:last-child) 不能动。
             *
             * 但每张卡片的最后一道题不需要它 ——
             * 留着就变成上下 12px / 下 14+16=30px，太偏。
             * 归零后是 12 / 16，基本对称。
             */

            html body
            app-ti:last-child {

                padding-bottom: 0 !important;
            }


            /*
             * 已答题时粉笔会在题目顶部画一条红/绿渐变条
             * （top:-11px; left:1px; width:calc(100% - 2px);
             *   height:110px），靠容器的 12px 上内边距
             * 和 overflow:hidden 裁掉溢出部分、修出圆角。
             *
             * 现在容器多了一圈 1px 边框，内边距盒整体缩了 1px，
             * 粉笔预留的那 1px 内缩就变成 2px ——
             * 边框和渐变条之间会露出一条白缝。
             *
             * 这里把渐变条推到内边距盒的边缘，让它紧贴边框，
             * 圆角交给容器的 overflow:hidden 去裁。
             */

            html body
            .memorize-main
            .questions-single-container
            .ti-container.showBg:before {

                top: -12px !important;

                left: 0 !important;

                width: 100% !important;
            }


            /*
             * 选项卡片。
             *
             * 粉笔本来就给了 display:flex / padding:8px 10px /
             * border-radius:8px / hover 变色，这里只补边框
             * 和选项之间的间距。
             *
             * 不写 background：卡片本来就是白底，透明即白底，
             * 一旦写死就会盖掉粉笔的 :hover 变色。
             */

            html body
            .choice-radio-label,

            html body
            .choice-checkbox-label {

                border:
                    1px solid
                    var(--color-border-choice) !important;

                margin: 0 -10px 10px !important;

                box-sizing: border-box !important;
            }


            /*
             * 最后一个选项不留底部间距，
             * 免得和卡片的下内边距叠在一起。
             */

            html body
            .choice-radio:last-child
            .choice-radio-label,

            html body
            .choice-checkbox:last-child
            .choice-checkbox-label {

                margin-bottom: 0 !important;
            }


            /* =====================================================
               question-overall-container
               ===================================================== */

            html body
            .question-overall-container {

                display: grid !important;

                grid-template-columns:
                    repeat(
                        4,
                        minmax(0, 1fr)
                    ) !important;

                column-gap: 10px !important;

                row-gap: 0 !important;

                width: 100% !important;

                max-width: 100% !important;

                padding:
                    10px 12px !important;

                box-sizing: border-box !important;

                overflow: hidden !important;
            }


            /* =====================================================
               统计项目
               ===================================================== */

            html body
            .question-overall-container
            > .overall-item {

                min-width: 0 !important;

                box-sizing: border-box !important;

                text-align: center !important;

                display: flex !important;

                flex-direction: column !important;

                align-items: center !important;

                justify-content: center !important;

                min-height: 44px !important;

                padding: 2px 3px !important;
            }


            html body
            .question-overall-container
            > .overall-item
            .overall-item-value {

                display: block !important;

                font-size: 16px !important;

                line-height: 21px !important;

                font-weight: 600 !important;

                white-space: nowrap !important;
            }


            html body
            .question-overall-container
            > .overall-item
            .overall-item-title {

                display: block !important;

                margin-top: 1px !important;

                color: #8a9099 !important;

                font-size: 10px !important;

                line-height: 16px !important;

                white-space: nowrap !important;
            }


            html body
            .question-overall-container
            .overall-item
            .overall-item-sub {

                font-size: 10px !important;

                font-weight: 500 !important;
            }


            /* =====================================================
               自制答题卡
               ===================================================== */

            #fenbi-custom-answer-card {

                position: fixed !important;

                top:
                    ${CONFIG.cardTop}px !important;

                right:
                    ${CONFIG.cardRight}px !important;

                width:
                    ${CONFIG.cardWidth}px !important;

                box-sizing:
                    border-box !important;

                z-index:
                    ${CONFIG.zIndex} !important;

                /*
                 * 题多的时候不要一路长到屏幕外面去。
                 *
                 * 高度上限由上下两个留白算出来，剩下的交给 .fbac-grid
                 * 自己滚 —— 标题、状态行、底部那行都钉着不动。
                 */

                max-height:
                    calc(
                        100vh
                        - ${CONFIG.cardTop}px
                        - ${CONFIG.cardBottom}px
                    ) !important;

                display:
                    flex !important;

                flex-direction:
                    column !important;

                font-family:
                    -apple-system,
                    BlinkMacSystemFont,
                    "Segoe UI",
                    "Microsoft YaHei",
                    sans-serif !important;

                user-select:
                    none !important;

                pointer-events:
                    auto !important;
            }


            /*
             * 没题目的时候整张卡收掉。
             *
             * 这个 !important 不是顺手加的，是这条功能的命门：上面
             * #fenbi-custom-answer-card 那条把 display 钉成了
             * flex !important。CSS 先比重要性、再比特异性，所以一条不带
             * important 的类选择器根本盖不住它 —— 表现是「隐藏类加上了，
             * 卡片照样杵在那儿」，而且一点报错都没有。测试里专门有一条
             * 盯着这个感叹号。
             *
             * 用类而不是往 style 里写 display：露出来的时候把内联样式撤掉
             * 就行，flex 这个值仍旧只由上面那一条说了算，不会多出第二处
             * 定义。
             */
            #fenbi-custom-answer-card.fbac-hidden {

                display:
                    none !important;
            }


            /*
             * 原生答题卡移出屏幕。
             *
             * 不删除它，
             * 保留粉笔 Angular 的原生题目跳转逻辑。
             */

            html body
            app-answer-card {

                position: fixed !important;

                left: -10000px !important;

                top: -10000px !important;

                width: 1px !important;

                height: 1px !important;

                opacity: 0 !important;

                pointer-events: none !important;

                overflow: hidden !important;

                z-index: -1 !important;
            }


            #fenbi-custom-answer-card
            .fbac-panel {

                width: 100% !important;

                box-sizing: border-box !important;

                /*
                 * 卡片是 flex 列，面板得跟着撑满，并且允许自己被压扁 ——
                 * flex 子项的默认最小高度是内容高度，不写 min-height: 0
                 * 的话它永远压不下去，底下那个 overflow 就永远不触发。
                 * 这是 flex 里最经典的「明明写了滚动却滚不动」。
                 */

                display: flex !important;

                flex-direction: column !important;

                max-height: 100% !important;

                min-height: 0 !important;

                background:
                    rgba(255, 255, 255, 0.98) !important;

                border: 1px solid #e7eaf0 !important;

                border-radius: 9px !important;

                box-shadow:
                    0 3px 14px
                    rgba(0, 0, 0, 0.07) !important;

                overflow: hidden !important;
            }


            #fenbi-custom-answer-card
            .fbac-header {

                height: 42px !important;

                /* 标题行不参与压缩，滚的只是下面的题号 */
                flex: 0 0 auto !important;

                padding: 0 12px !important;

                display: flex !important;

                align-items: center !important;

                justify-content: space-between !important;

                box-sizing: border-box !important;

                background: #fff !important;

                border-bottom: 1px solid #f0f1f3 !important;
            }


            #fenbi-custom-answer-card
            .fbac-title {

                display: flex !important;

                align-items: center !important;

                gap: 7px !important;

                font-size: 14px !important;

                font-weight: 600 !important;

                color: #303133 !important;
            }


            #fenbi-custom-answer-card
            .fbac-icon {

                width: 23px !important;

                height: 23px !important;

                display: flex !important;

                align-items: center !important;

                justify-content: center !important;

                border-radius: 5px !important;

                background: #f4f7fb !important;

                font-size: 14px !important;
            }


            #fenbi-custom-answer-card
            .fbac-count {

                color: #909399 !important;

                font-size: 12px !important;

                font-weight: 400 !important;
            }


            #fenbi-custom-answer-card
            .fbac-body {

                /*
                 * 内边距和 cardWidth 是一对：这一层是题号区外面那圈留白，
                 * 加它就等于减题号区实宽，也就是减列数。16px 是配着 240px
                 * 的卡宽来的，两个一起改才保得住默认的 5 列。
                 */

                padding: 16px !important;

                box-sizing: border-box !important;

                /*
                 * 竖向 flex，题号那格吃掉剩下的高度。
                 *
                 * min-height: 0 同上 —— 少了它这道链子就断在这儿，
                 * 题号再多也撑不出一根滚动条。
                 */

                display: flex !important;

                flex-direction: column !important;

                flex: 1 1 auto !important;

                min-height: 0 !important;
            }


            #fenbi-custom-answer-card
            .fbac-status {

                display: flex !important;

                align-items: center !important;

                justify-content: space-between !important;

                flex: 0 0 auto !important;

                margin-bottom: 9px !important;

                padding: 0 1px !important;

                font-size: 11px !important;

                color: #9aa0a8 !important;
            }


            #fenbi-custom-answer-card
            .fbac-legend-wrap {

                display: flex !important;

                align-items: center !important;

                gap: 10px !important;
            }


            #fenbi-custom-answer-card
            .fbac-legend {

                display: flex !important;

                align-items: center !important;

                gap: 4px !important;
            }


            #fenbi-custom-answer-card
            .fbac-dot {

                width: 7px !important;

                height: 7px !important;

                border-radius: 50% !important;

                display: inline-block !important;
            }


            #fenbi-custom-answer-card
            .fbac-dot-wrong {

                background: #ff5b5f !important;
            }


            #fenbi-custom-answer-card
            .fbac-dot-right {

                background: #2ac7a9 !important;
            }


            /*
             * 题号格。
             *
             * 一行几个由 --fbac-columns 决定，那个值是 JS 按卡片的实测宽度
             * 算出来写上去的（见 syncCardColumns）。这里给个 5 只是兜底 ——
             * 万一 JS 那边没跑起来，至少还是一个能看的五列。
             *
             * 滚的是这一格，不是整张卡：标题、状态行、底部「当前：N」都
             * 在滚动区外面，题再多也一直看得见。
             */

            #fenbi-custom-answer-card
            .fbac-grid {

                display: grid !important;

                grid-template-columns:
                    repeat(
                        var(--fbac-columns, 5),
                        minmax(0, 1fr)
                    ) !important;

                gap: ${CONFIG.gridGap}px !important;

                width: 100% !important;

                box-sizing: border-box !important;

                flex: 1 1 auto !important;

                min-height: 0 !important;

                overflow-y: auto !important;

                /* 滚动条别太占地方，卡本来就窄 */
                scrollbar-width: thin !important;
            }


            #fenbi-custom-answer-card
            .fbac-question {

                appearance: none !important;

                -webkit-appearance: none !important;

                display: block !important;

                width: 100% !important;

                height: 33px !important;

                margin: 0 !important;

                padding: 0 !important;

                border: 1px solid #e6e9ed !important;

                border-radius: 6px !important;

                background: #f7f8fa !important;

                color: #70757d !important;

                font-family: inherit !important;

                font-size: 12px !important;

                font-weight: 500 !important;

                line-height: 31px !important;

                text-align: center !important;

                cursor: pointer !important;

                box-sizing: border-box !important;

                outline: none !important;

                transition:
                    transform 0.12s ease,
                    box-shadow 0.12s ease !important;
            }


            #fenbi-custom-answer-card
            .fbac-question:hover {

                transform:
                    translateY(-1px) !important;

                box-shadow:
                    0 2px 6px
                    rgba(0, 0, 0, 0.10) !important;
            }


            #fenbi-custom-answer-card
            .fbac-question.is-right {

                background: #2ac7a9 !important;

                border-color: #2ac7a9 !important;

                color: #fff !important;
            }


            #fenbi-custom-answer-card
            .fbac-question.is-wrong {

                background: #ff5b5f !important;

                border-color: #ff5b5f !important;

                color: #fff !important;
            }


            #fenbi-custom-answer-card
            .fbac-question.is-unanswered {

                background: #f7f8fa !important;

                border-color: #e6e9ed !important;

                color: #70757d !important;
            }


            #fenbi-custom-answer-card
            .fbac-question.is-current {

                box-shadow:
                    0 0 0 2px
                    rgba(64, 158, 255, 0.28) !important;

                font-weight: 700 !important;
            }


            #fenbi-custom-answer-card
            .fbac-footer {

                display: flex !important;

                align-items: center !important;

                justify-content: space-between !important;

                flex: 0 0 auto !important;

                margin-top: 10px !important;

                padding-top: 9px !important;

                border-top: 1px solid #f0f1f3 !important;

                font-size: 11px !important;

                color: #a0a5ad !important;
            }


            #fenbi-custom-answer-card
            .fbac-current {

                color: #60656d !important;

                font-weight: 500 !important;
            }


            /* =====================================================
               小屏
               ===================================================== */

            @media (max-width: 1000px) {

                html body
                .memorize-main {

                    width:
                        calc(
                            100% - 220px
                        ) !important;
                }


                #fenbi-custom-answer-card {

                    width: 195px !important;

                    right: 8px !important;
                }
            }


            @media (max-width: 750px) {

                html body
                .memorize-main {

                    width: 100% !important;

                    max-width: 100% !important;
                }


                #fenbi-custom-answer-card {

                    width: 185px !important;

                    right: 6px !important;
                }
            }


            /* =====================================================
               自定义刷题：任意出题数量
               ===================================================== */

            /*
             * 输入框带着粉笔自己的 .select-button / .square-button，
             * 底色、边框、圆角、高度都归它的 CSS 管 —— 这样换主题（暗色模式）
             * 时这一项会跟着变，不会突兀地亮着。
             *
             * 这里只补 input 特有的那几处：原生输入框的边框、以及那个在这么
             * 窄的格子里挤成一团的数字上下箭头。
             */

            .fb-count-input {

                width: 66px !important;

                padding: 0 4px !important;

                text-align: center !important;

                font-family: inherit !important;

                box-sizing: border-box !important;

                appearance: none !important;

                -webkit-appearance: none !important;
            }

            .fb-count-input::-webkit-outer-spin-button,
            .fb-count-input::-webkit-inner-spin-button {

                appearance: none !important;

                -webkit-appearance: none !important;

                margin: 0 !important;
            }

            .fb-count-input::placeholder {

                font-size: 12px !important;
            }
        `;


        (
            document.head ||
            document.documentElement
        ).appendChild(style);
    }


    // =========================================================
    // 隐藏 VIP 视频 / 笔记
    //
    // CSS 已经覆盖同样的选择器，
    // 这里只作为一次性保险，不进热路径。
    // =========================================================

    function hideVipModules() {

        const selectors = [

            '[id^="section-video"]',
            '[id*="section-video"]',
            '.section-video',
            '.solution-video',
            '.solution-video-container',
            'app-solution-video',
            '[class*="solution-video"]',
            '[class*="vip-video"]',
            '[class*="video-solution"]',

            '[id^="section-note"]',
            '[id*="section-note"]',
            '.section-note',
            '.solution-note',
            '.solution-note-container',
            'app-solution-note',
            '[class*="solution-note"]',
            '[class*="note-container"]',
            '[class*="vip-note"]'
        ];


        selectors.forEach(
            selector => {

                qsa(selector).forEach(
                    el => {

                        important(el, 'display', 'none');

                        important(el, 'visibility', 'hidden');

                        important(el, 'pointer-events', 'none');
                    }
                );
            }
        );
    }


    // =========================================================
    // ★ 题目数据
    //
    // 优先用接口缓存；
    // 接口没命中（拦截失败 / 换域名）时，
    // 退回抓原生 DOM，保证脚本不会整个哑掉。
    //
    // 注意：回退路径用 textContent 而不是 innerText，
    // innerText 会强制同步重排。
    // =========================================================

    function scrapeNativeData(ti) {

        const solutionSec =
            qs('[id^="section-solution"]', ti);


        if (!solutionSec) {
            return null;
        }


        const content =
            qs('.content', solutionSec) ||
            qs('.solution-content', solutionSec);


        const sourceSec =
            qs('[id^="section-source"]', ti);


        const sourceContent =
            sourceSec
                ? qs('.content', sourceSec)
                : null;


        const keypointSec =
            qs('[id^="section-keypoint"]', ti);


        const keypoints =
            keypointSec
                ? qsa(
                    '.solution-keypoint-item-name',
                    keypointSec
                )
                    .map(
                        el => el.textContent.trim()
                    )
                    .filter(Boolean)
                : [];


        return {

            solution:
                content ? content.innerHTML : '',

            source:
                sourceContent
                    ? sourceContent.textContent.trim()
                    : '',

            keypoints: keypoints
        };
    }


    function resolveQuestionData(ti) {

        const key =
            ti.getAttribute('data-question-key');


        if (!key) {
            return null;
        }


        const cached =
            solutionCache.get(key);


        if (cached) {

            return {

                solution:
                    cached.solution || '',

                source:
                    cached.source || '',

                keypoints:
                    (
                        Array.isArray(cached.keypoints)
                            ? cached.keypoints
                            : []
                    )
                        .map(
                            item =>
                                item && item.name
                                    ? item.name
                                    : ''
                        )
                        .filter(Boolean)
            };
        }


        return scrapeNativeData(ti);
    }


    // =========================================================
    // ★ 一键复制题目
    //
    // 只吃传入的元素，不碰全局，所以能在 Node 里对着真实的背题页存档跑测试。
    //
    // 选择器和 fenbi-ai-sidebar.user.js 里那套是同一份。两份脚本各自独立、
    // 不共享代码，改这里的选择器时记得那边也改。
    // =========================================================

    // 题干：选择题在 app-question-choice 里，填空题在 solution-blank 的正文里
    const COPY_STEM_SELECTOR = 'app-question-choice app-format-html';
    const COPY_STEM_BLANK_SELECTOR = '.solution-blank-container article.content';

    // 选项：单选、多选/不定项、判断题是三套不同的结构
    const COPY_ITEM_SELECTOR = 'li.choice-radio, li.choice-checkbox';
    const COPY_LABEL_SELECTOR = '.input-radio, .input-checkbox';
    const COPY_TEXT_SELECTOR = 'p.input-text, app-format-html';

    const COPY_BLANK = '____';


    // Angular 会往标签之间塞大量换行缩进，统一压成单空格
    function copyNormalize(value) {

        return String(value == null ? '' : value)
            .replace(/\s+/g, ' ')
            .trim();
    }


    // 填空题的题干是被 <input readonly> 挖了空的，textContent 读不到 input，
    // 直接取会得到「有目的、、有组织」这种缺字的题干，所以先把空位换成占位符。
    // 要克隆再改，不能动真实 DOM。
    function copyTextOf(el, blankForInput) {

        if (!el) {
            return '';
        }


        if (!blankForInput || !el.querySelector) {

            return copyNormalize(el.textContent);
        }


        if (!el.querySelector('input, textarea')) {

            return copyNormalize(el.textContent);
        }


        const node =
            el.cloneNode(true);

        const doc =
            el.ownerDocument;


        node.querySelectorAll('input, textarea').forEach(input => {

            input.replaceWith(
                doc.createTextNode(COPY_BLANK)
            );
        });


        return copyNormalize(node.textContent);
    }


    // 读成结构化数据。读不出题型也读不出题干时返回 null。
    function extractForCopy(ti) {

        if (!ti || !ti.querySelector) {
            return null;
        }


        const scope =
            ti.querySelector('.ti-content') || ti;


        const type =
            copyTextOf(ti.querySelector('.title-type-name'));


        const stemEl =

            scope.querySelector(COPY_STEM_SELECTOR)
            || scope.querySelector(COPY_STEM_BLANK_SELECTOR);


        if (!type && !stemEl) {
            return null;
        }


        const choices =

            qsa(COPY_ITEM_SELECTOR, scope)

                .map(li => ({

                    label: copyTextOf(li.querySelector(COPY_LABEL_SELECTOR)),

                    text: copyTextOf(li.querySelector(COPY_TEXT_SELECTOR))
                }))

                .filter(choice => choice.text);


        return {

            type: type,

            index: copyTextOf(ti.querySelector('.title-index')),

            stem: copyTextOf(stemEl, true),

            choices: choices
        };
    }


    // 拼成一段可以直接粘进 ChatGPT 的文本。
    //
    // 这里不带「请给出正确答案」之类的指令 —— 这个按钮的职责就是复制题目，
    // 要连着问 AI 用侧边栏那个脚本的「问这道题」。
    function formatForCopy(question) {

        if (!question) {
            return '';
        }


        const lines = [];


        const numbering =

            question.index
                ? '第' + question.index.replace(/\.$/, '') + '题'
                : '';


        lines.push(
            '【' + (question.type || '题目') + '】' + numbering
        );


        if (question.stem) {

            lines.push(question.stem);
        }


        question.choices.forEach(choice => {

            lines.push(
                choice.label
                    ? choice.label + '. ' + choice.text
                    : choice.text
            );
        });


        return lines.join('\n').trim();
    }


    // 剪贴板。fenbi 是 https，navigator.clipboard 可用；http 或旧浏览器上退回
    // execCommand。
    function copyToClipboard(text) {

        try {

            if (navigator.clipboard && navigator.clipboard.writeText) {

                navigator.clipboard.writeText(text);

                return true;
            }

        } catch (error) {

            // 落到下面的兜底
        }


        try {

            const area =
                document.createElement('textarea');


            area.value = text;

            area.style.cssText =
                'position:fixed;left:-9999px;top:0;opacity:0;';


            document.body.appendChild(area);

            area.select();

            const ok =
                document.execCommand('copy');


            area.remove();

            return ok;

        } catch (error) {

            return false;
        }
    }


    // 把这道题交给 AI 面板。
    //
    // 返回按钮上该闪的字。整条链路是同步的：dispatchEvent 会立刻跑完侧边栏
    // 的监听器，所以这行返回的时候结果码已经写好了。
    //
    // 侧边栏没装、或者没跑起来的时候没人应答 —— 那就自己复制一份。这一下
    // 不能白点。
    function askAi(ti) {

        const question =
            extractForCopy(ti);


        if (!question || (!question.stem && !question.choices.length)) {
            return '没读到题目';
        }


        const text =
            formatForCopy(question);


        if (!text) {
            return '没读到题目';
        }


        const root =
            document.documentElement;


        root.setAttribute(ASK_ATTR, text);

        // 上一次的结果先擦掉，不然这次没人应答就会读到上次的
        root.removeAttribute(ASK_RESULT_ATTR);


        document.dispatchEvent(new Event(ASK_EVENT));


        const result =
            root.getAttribute(ASK_RESULT_ATTR);


        root.removeAttribute(ASK_ATTR);
        root.removeAttribute(ASK_RESULT_ATTR);


        if (result && ASK_RESULT_LABELS[result]) {
            return ASK_RESULT_LABELS[result];
        }


        // 没人应答：自己复制。跟「复制题目」那条路走的是同一个函数。
        return copyToClipboard(text)
            ? '已复制 ✓'
            : '没送出去';
    }


    // =========================================================
    // ★ 自制解析面板
    // =========================================================

    function rowHtml(label, value, extraClass) {

        return (
            '<div class="fb-sol-row ' + extraClass + '">' +
                '<span class="fb-sol-label">' +
                    escapeHtml(label) +
                '</span>' +
                '<span class="fb-sol-text">' +
                    escapeHtml(value) +
                '</span>' +
            '</div>'
        );
    }


    function buildPanel(ti, data) {

        const container =
            qs('.ti-container', ti) || ti;


        const panel =
            document.createElement('div');


        panel.className = PANEL_CLASS;


        const rows = [];


        if (data.keypoints.length) {

            rows.push(
                rowHtml(
                    '考点：',
                    data.keypoints.join('、'),
                    'fb-sol-keypoint'
                )
            );
        }


        if (data.source) {

            rows.push(
                rowHtml(
                    '来源：',
                    data.source,
                    'fb-sol-source'
                )
            );
        }


        panel.innerHTML =
            (
                rows.length
                    ? '<div class="fb-sol-meta">' +
                        rows.join('') +
                      '</div>'
                    : ''
            ) +
            '<div class="fb-sol-head">' +
                '<button type="button" class="' +
                    COPY_CLASS +
                    '">' + COPY_LABEL + '</button>' +
                '<button type="button" class="' +
                    ASK_CLASS +
                    '">' + ASK_LABEL + '</button>' +
                '<button type="button" class="' +
                    TOGGLE_CLASS +
                    '" aria-expanded="false">' +
                    EXPAND_LABEL + '</button>' +
            '</div>' +
            '<div class="fb-sol-body">' +
                '<div class="fb-sol-content"></div>' +
            '</div>';


        /*
         * 解析正文是接口返回的 HTML，
         * 与页面自身渲染的是同一份内容。
         */
        qs('.fb-sol-content', panel).innerHTML =
            data.solution || '';


        const button =
            qs('.' + TOGGLE_CLASS, panel);


        button.addEventListener(
            'click',
            function (event) {

                event.preventDefault();

                event.stopPropagation();


                const open =
                    panel.classList.toggle(
                        PANEL_EXPANDED
                    );


                setText(
                    button,
                    open ? COLLAPSE_LABEL : EXPAND_LABEL
                );


                button.setAttribute(
                    'aria-expanded',
                    open ? 'true' : 'false'
                );
            }
        );


        /*
         * 复制题目。
         *
         * 每次点击都现读一次 DOM —— 题目内容不会变，但面板是按题渲染的，
         * 缓存一份反而要在题目更新时记得失效。
         */
        qs('.' + COPY_CLASS, panel).addEventListener(
            'click',
            function (event) {

                event.preventDefault();

                event.stopPropagation();


                const copyButton =
                    event.currentTarget;


                const question =
                    extractForCopy(ti);


                if (!question || (!question.stem && !question.choices.length)) {

                    flashButton(copyButton, '没读到题目', true, COPY_LABEL);

                    return;
                }


                const ok =
                    copyToClipboard(formatForCopy(question));


                flashButton(
                    copyButton,
                    ok ? COPY_DONE_LABEL : '复制失败',
                    !ok,
                    COPY_LABEL
                );
            }
        );


        /*
         * 询问 AI。
         *
         * 只负责把题目递出去，送不送得到是侧边栏的事 —— 它把结果码写回来，
         * 这里照着闪一下。
         */
        qs('.' + ASK_CLASS, panel).addEventListener(
            'click',
            function (event) {

                event.preventDefault();

                event.stopPropagation();


                const askButton =
                    event.currentTarget;


                const label =
                    askAi(ti);


                flashButton(
                    askButton,
                    label,
                    label === '没送出去' || label === '没读到题目',
                    ASK_LABEL
                );
            }
        );


        container.appendChild(panel);


        return panel;
    }


    /*
     * 按钮的瞬时反馈。
     *
     * 失败时停久一点（用户要看清「复制失败」），成功一闪就过。
     * restore 是闪完之后回落到哪个文案 —— 复制和询问 AI 各是各的。
     */
    function flashButton(button, text, isError, restore) {

        if (button.dataset.copyTimer) {

            clearTimeout(
                Number(button.dataset.copyTimer)
            );
        }


        setText(button, text);


        button.classList.toggle('fb-copied', !isError);


        button.dataset.copyTimer =
            String(
                setTimeout(
                    function () {

                        setText(button, restore);

                        button.classList.remove('fb-copied');

                        delete button.dataset.copyTimer;

                    },
                    isError
                        ? COPY_FEEDBACK_MS * 2
                        : COPY_FEEDBACK_MS
                )
            );
    }


    /*
     * 这道题是否已经作答。
     *
     * 单选 / 判断 / 多选：粉笔会给选项元素挂上
     * correct / wrong / correctLost，三种题型通用。
     *
     * 填空不落在这套 class 上，用「粉笔自己渲染了原生
     * 解析」兜底 —— 粉笔只替该显示解析的题渲染它。
     */
    function isAnswered(ti) {

        if (
            ti.querySelector(
                '.input-radio.correct, ' +
                '.input-radio.wrong, ' +
                '.input-radio.correctLost, ' +
                '.input-checkbox.correct, ' +
                '.input-checkbox.wrong, ' +
                '.input-checkbox.correctLost'
            )
        ) {
            return true;
        }


        return !!ti.querySelector('app-result-common');
    }


    /*
     * 填空题没有选项可点，解析常显。
     */
    function isBlank(ti) {

        return !!ti.querySelector('app-solution-blank');
    }


    /*
     * 面板该不该显示：
     * 点过 → 显示；已答 → 显示（刷新后不用再点一遍）；
     * 填空 → 常显。
     */
    function shouldShowPanel(ti) {

        return !!(
            ti.__fbRevealed ||
            isBlank(ti) ||
            isAnswered(ti)
        );
    }


    /*
     * 可见性单独抽出来，两个原因：
     *
     * 1. 粉笔渲染 app-result-common 比第一次 syncQuestion
     *    晚，面板建好之后还得再刷几轮才认得出来；
     * 2. 一旦显示就不回退，所以先看当前状态，已经可见的
     *    直接返回，省掉每轮 mutation 的选择器开销。
     */
    function syncPanelVisibility(ti) {

        const panel = ti.__fbPanel;


        if (!panel || !panel.isConnected) {
            return;
        }


        if (panel.classList.contains(PANEL_VISIBLE)) {
            return;
        }


        if (!shouldShowPanel(ti)) {
            return;
        }


        panel.classList.add(PANEL_VISIBLE);
    }


    /*
     * 单题同步：没面板就建，建过就补一次可见性。
     */
    function syncQuestion(ti) {

        if (
            ti.__fbPanel &&
            ti.__fbPanel.isConnected
        ) {

            syncPanelVisibility(ti);

            return;
        }


        const data =
            resolveQuestionData(ti);


        if (!data) {
            return;
        }


        if (
            !data.solution &&
            !data.source &&
            !data.keypoints.length
        ) {
            return;
        }


        ti.__fbPanel = buildPanel(ti, data);


        syncPanelVisibility(ti);
    }


    function syncQuestions() {

        qsa('app-ti').forEach(syncQuestion);
    }


    /*
     * 点选项 -> 立刻从缓存出解析，
     * 不等 Angular 的网络往返和懒渲染。
     */
    function revealQuestion(ti) {

        if (!ti) {
            return;
        }


        ti.__fbRevealed = true;


        if (
            !ti.__fbPanel ||
            !ti.__fbPanel.isConnected
        ) {
            syncQuestion(ti);
        }


        syncPanelVisibility(ti);
    }


    function installRevealListener() {

        document.addEventListener(
            'click',
            function (event) {

                const target = event.target;


                if (!target || !target.closest) {
                    return;
                }


                /*
                 * 单选 / 判断用 choice-radio 这一套，
                 * 多选用 choice-checkbox 那一套，
                 * 两组 class 互不重叠，一起写在这里。
                 */
                const choice =
                    target.closest(
                        '.choice-radio, ' +
                        '.option-radio, ' +
                        '.choice-radio-label, ' +
                        '.choice-checkbox, ' +
                        '.option-checkbox, ' +
                        '.choice-checkbox-label'
                    );


                if (!choice) {
                    return;
                }


                revealQuestion(
                    choice.closest('app-ti')
                );
            },
            true
        );
    }


    // =========================================================
    // 布局类优化
    //
    // CSS 已经覆盖绝大部分，
    // 这里只做低频兜底，不进热路径。
    // =========================================================

    function optimizeQuestionWidth() {

        qsa('.memorize-main').forEach(
            main => {

                important(
                    main,
                    'width',
                    `calc(100% - ${RIGHT_RESERVE}px)`
                );

                important(
                    main,
                    'max-width',
                    `${CONFIG.questionMaxWidth}px`
                );

                important(main, 'margin-left', 'auto');

                important(main, 'margin-right', 'auto');

                important(main, 'box-sizing', 'border-box');

                important(main, 'display', 'block');

                important(main, 'min-width', '0');
            }
        );
    }


    function optimizeOverall() {

        qsa('.question-overall-container').forEach(
            overall => {

                important(overall, 'display', 'grid');

                important(
                    overall,
                    'grid-template-columns',
                    'repeat(4,minmax(0,1fr))'
                );

                important(overall, 'column-gap', '10px');

                important(overall, 'row-gap', '0');

                important(overall, 'width', '100%');

                important(overall, 'max-width', '100%');

                important(overall, 'box-sizing', 'border-box');
            }
        );
    }


    function optimizeLayout() {

        try {

            optimizeQuestionWidth();

            optimizeOverall();

            /*
             * 列数的低频兜底。
             *
             * 正常情况下是 ResizeObserver 在管，这里只是怕它漏（比如环境
             * 里没有 ResizeObserver）。syncCardColumns 自己会比对上一次的
             * 列数，没变就什么都不写，所以这轮基本是白跑的。
             */
            syncCardColumns();

        } catch (error) {

            console.warn(
                '[粉笔布局优化 ' + VERSION + '] layout',
                error
            );
        }
    }


    // =========================================================
    // 答题卡
    // =========================================================

    /*
     * 一行排几个题号。
     *
     * 从卡片的实测宽度算，而不是读一个写死的列数 —— 卡宽本身是个会变的量
     * （小屏的媒体查询会把它压到 195px），写死的列数到那时候就错了，而且
     * 改卡宽的时候没人会想起来还有个数得跟着同步。
     *
     * 拿到的宽度可能是 0 或者 NaN（卡片刚插进 DOM、布局还没跑），所以出口
     * 一律夹在「至少一列」上 —— 返回 0 会让 grid-template-columns 整条失效，
     * 题号直接不见。
     */
    function computeColumns(innerWidth, minCellWidth, gap) {

        const cell = Number(minCellWidth);
        const space = Number(gap);

        if (!Number.isFinite(cell) || cell <= 0) {
            return 1;
        }

        if (!Number.isFinite(space) || space < 0) {
            return 1;
        }


        const width = Number(innerWidth);

        if (!Number.isFinite(width) || width <= 0) {
            return 1;
        }


        /*
         * n 列加上 (n-1) 个间隙正好放得下，等价于
         * n <= (width + gap) / (cell + gap)
         */
        const columns = Math.floor(
            (width + space) / (cell + space)
        );


        return columns >= 1 ? columns : 1;
    }


    // 上一次算出来的列数。值没变就不碰 DOM —— 写样式会产生 mutation，
    // 而 observer 正盯着 body 子树，这正是那个 150ms 死循环的成因。
    let cardColumns = 0;

    let cardResizeObserver = null;


    /*
     * 按答题卡自己的宽度决定一行几个题号。
     *
     * 用 ResizeObserver 驱动，不在 mutation 热路径里量尺寸：这份脚本被
     * 「自我触发的重排循环」咬过一次，病根就是每轮都去读几何尺寸。这里只有
     * 卡片尺寸真变了才会跑。
     */
    function syncCardColumns() {

        if (!customCard) {
            return;
        }


        const grid = qs('.fbac-grid', customCard);


        if (!grid) {
            return;
        }


        let available = 0;


        try {

            /*
             * 量 border box，不用 clientWidth。
             *
             * clientWidth 会把滚动条扣掉：题目一多、滚动条一出来，量到的
             * 宽度就变小、列数跟着变少、卡片跟着变矮、滚动条又可能消失……
             * 来回抖。border box 不受滚动条影响，量出来是稳的。
             */
            available = grid.getBoundingClientRect().width;

        } catch (e) {
            return;
        }


        const columns = computeColumns(
            available,
            CONFIG.minCellWidth,
            CONFIG.gridGap
        );


        if (columns === cardColumns) {
            return;
        }


        cardColumns = columns;

        important(grid, '--fbac-columns', String(columns));
    }


    function observeCardSize() {

        if (cardResizeObserver || !customCard) {
            return;
        }


        if (typeof ResizeObserver !== 'function') {

            /*
             * 没有 ResizeObserver 也不至于就不动了：optimizeLayout 那轮
             * 低频兜底里会调 syncCardColumns，只是要等到那一轮。
             */
            return;
        }


        try {

            cardResizeObserver =
                new ResizeObserver(syncCardColumns);

            cardResizeObserver.observe(customCard);

        } catch (e) {
            cardResizeObserver = null;
        }
    }


    function getNativeAnswerButtons() {

        const card = qs('app-answer-card');


        if (!card) {
            return [];
        }


        return qsa(
            'app-answer-button .answer-btn',
            card
        );
    }


    function getButtonState(button) {

        if (!button) {
            return 'unanswered';
        }


        if (button.classList.contains('wrong')) {
            return 'wrong';
        }


        if (button.classList.contains('correct')) {
            return 'right';
        }


        const host =
            button.closest('app-answer-button');


        if (host) {

            const cls = host.className || '';


            if (/\bwrong\b/.test(cls)) {
                return 'wrong';
            }


            if (/\bcorrect\b/.test(cls)) {
                return 'right';
            }
        }


        return 'unanswered';
    }


    /*
     * 几何回退要读 40 次 getBoundingClientRect，
     * 属于布局读取，因此做短时缓存，
     * 避免每次 mutation 都重算一遍。
     */
    let currentIndexCache = {
        value: -1,
        time: 0
    };


    function computeCurrentQuestionIndex() {

        const buttons =
            getNativeAnswerButtons();


        if (!buttons.length) {
            return -1;
        }


        const selectors = [

            '.current',
            '.active',
            '.selected',
            '.is-current',
            '.current-question',
            '.active-question'
        ];


        for (const selector of selectors) {

            const el =
                qs(`app-answer-card ${selector}`);


            if (!el) {
                continue;
            }


            const button =
                el.matches('.answer-btn')
                    ? el
                    : qs('.answer-btn', el);


            if (!button) {
                continue;
            }


            const index =
                buttons.indexOf(button);


            if (index >= 0) {
                return index;
            }
        }


        /*
         * 找不到就用屏幕位置猜：
         * 取最接近视口 35% 高度的题。
         */

        const questions = qsa('app-ti');


        if (!questions.length) {
            return -1;
        }


        let bestIndex = -1;
        let bestDistance = Infinity;


        questions.forEach(
            (question, index) => {

                const rect =
                    question.getBoundingClientRect();


                if (
                    rect.bottom < 0 ||
                    rect.top > window.innerHeight
                ) {
                    return;
                }


                const center =
                    rect.top + rect.height / 2;


                const distance =
                    Math.abs(
                        center -
                        window.innerHeight * 0.35
                    );


                if (distance < bestDistance) {

                    bestDistance = distance;

                    bestIndex = index;
                }
            }
        );


        if (
            bestIndex >= 0 &&
            bestIndex < buttons.length
        ) {
            return bestIndex;
        }


        return -1;
    }


    function getCurrentQuestionIndex() {

        const now = Date.now();


        if (
            now - currentIndexCache.time <
            CONFIG.currentIndexTTL
        ) {
            return currentIndexCache.value;
        }


        const value =
            computeCurrentQuestionIndex();


        currentIndexCache = {
            value: value,
            time: now
        };


        return value;
    }


    function jumpToQuestion(index) {

        const buttons =
            getNativeAnswerButtons();


        const nativeButton = buttons[index];


        if (!nativeButton) {
            return;
        }


        try {
            nativeButton.click();
        } catch (e) {}


        try {

            nativeButton.dispatchEvent(
                new MouseEvent(
                    'click',
                    {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    }
                )
            );

        } catch (e) {}


        /*
         * 给 Angular 一点时间更新状态。
         */

        setTimeout(updateCustomCard, 80);
        setTimeout(updateCustomCard, 250);
        setTimeout(updateCustomCard, 500);
    }


    /*
     * 答题卡露脸还是收起来。
     *
     * 判据是「粉笔的题号按钮有几个」—— 这张卡要显示的就是那些题号，一个
     * 都没有就等于没数据：要么题还没加载出来，要么这一页压根不是答题页
     * （目录、解析、首页之类）。空卡上只剩「0/0」「共 0 题」，白占一块
     * 地方，还压着底下的页面。
     *
     * 返回这一下是不是**刚从藏变成露**。藏用的是 display: none，没有盒子
     * 就量不到宽度，computeColumns 会把 0 宽兜成 1 列 —— 所以从藏变露那
     * 一次，调用方必须重量一遍宽度（见 updateCustomCard），否则卡片会以
     * 1 列的样子闪一下才跳回去。
     */
    function applyCardVisibility(card, buttons) {

        if (!card) {
            return false;
        }


        const visible =
            Boolean(buttons) && buttons.length > 0;


        /*
         * 状态没变就别碰 DOM。这是热路径，每轮 mutation 都会走到，无条件
         * 写 classList 等于自己给自己再造一轮 —— 这份脚本被那个自我触发
         * 的循环咬过。
         */
        if (
            card.classList.contains(CARD_HIDDEN_CLASS) ===
            !visible
        ) {
            return false;
        }


        card.classList.toggle(CARD_HIDDEN_CLASS, !visible);


        return visible;
    }


    function createCustomCard() {

        const existing =
            document.getElementById(
                'fenbi-custom-answer-card'
            );


        if (existing) {

            customCard = existing;

            return;
        }


        customCard =
            document.createElement('div');


        customCard.id =
            'fenbi-custom-answer-card';


        /*
         * 先藏起来再上屏。
         *
         * 建出来就露着、等下一轮 updateCustomCard 再收的话，没题目的页面上
         * 会先闪一下写着「0/0 / 共 0 题」的空卡 —— 正好是这次要消掉的东西。
         * 露不露由 updateCustomCard 说了算，它手里才有题号。
         */
        customCard.classList.add(CARD_HIDDEN_CLASS);


        customCard.innerHTML = `

            <div class="fbac-panel">

                <div class="fbac-header">

                    <div class="fbac-title">

                        <span class="fbac-icon">▦</span>

                        <span>答题卡</span>

                        <span class="fbac-count">0/0</span>

                    </div>

                </div>


                <div class="fbac-body">

                    <div class="fbac-status">

                        <div class="fbac-legend-wrap">

                            <span class="fbac-legend">

                                <i class="
                                    fbac-dot
                                    fbac-dot-wrong
                                "></i>

                                错

                            </span>


                            <span class="fbac-legend">

                                <i class="
                                    fbac-dot
                                    fbac-dot-right
                                "></i>

                                对

                            </span>

                        </div>


                        <span class="fbac-total">共 0 题</span>

                    </div>


                    <div class="fbac-grid"></div>


                    <div class="fbac-footer">

                        <span>点击题号跳转</span>

                        <span>
                            当前：
                            <b class="fbac-current">-</b>
                        </span>

                    </div>

                </div>

            </div>
        `;


        document.body.appendChild(customCard);


        /*
         * 上屏了才有宽度可量。ResizeObserver 在 observe 时会立刻回调一次，
         * 所以量这件事交给它；这里再直接量一次是为了没有 ResizeObserver
         * 的环境下第一屏也是对的。
         */
        syncCardColumns();
        observeCardSize();
    }


    /*
     * 全部写操作都先比对再写。
     *
     * 原先这里每轮都无条件写 textContent，
     * 会生成 mutation -> 再次触发 observer ->
     * 再次全页重扫，形成永动的 150ms 重排循环。
     */
    function updateCustomCard() {

        if (!customCard) {
            return;
        }


        const nativeButtons =
            getNativeAnswerButtons();


        const grid =
            qs('.fbac-grid', customCard);


        if (!grid) {
            return;
        }


        const count = qs('.fbac-count', customCard);
        const total = qs('.fbac-total', customCard);
        const currentText = qs('.fbac-current', customCard);


        const justShown =
            applyCardVisibility(customCard, nativeButtons);


        /*
         * 刚从藏变露，重量一遍宽度。
         *
         * 藏着的这段时间 display: none 没有盒子，量出来是 0 宽，
         * computeColumns 把 0 兜成 1 列。不重量的话，卡片会先以 1 列的样子
         * 画出来，等 ResizeObserver 下一轮回调才跳回 5 列 —— 一眼能看见的闪。
         *
         * getBoundingClientRect 会强制同步布局，所以这里量到的已经是换成
         * flex 之后的真宽度，不用等下一帧。
         */
        if (justShown) {
            syncCardColumns();
        }


        if (!nativeButtons.length) {

            /*
             * 卡片这会儿已经收起来了，下面这些只是把它归零 —— 免得下次
             * 露出来的时候先闪一下上一页的旧数字。
             */
            if (grid.childElementCount) {
                grid.innerHTML = '';
            }

            setText(count, '0/0');
            setText(total, '共 0 题');
            setText(currentText, '-');

            return;
        }


        const currentIndex =
            getCurrentQuestionIndex();


        let right = 0;
        let wrong = 0;


        nativeButtons.forEach(
            button => {

                const state =
                    getButtonState(button);


                if (state === 'right') {
                    right++;
                }


                if (state === 'wrong') {
                    wrong++;
                }
            }
        );


        setText(
            count,
            `${right + wrong}/${nativeButtons.length}`
        );


        setText(
            total,
            `共 ${nativeButtons.length} 题`
        );


        setText(
            currentText,
            currentIndex >= 0
                ? String(currentIndex + 1)
                : '-'
        );


        /*
         * 只有题目数量变化时重新生成。
         */

        if (
            grid.childElementCount !==
            nativeButtons.length
        ) {

            grid.innerHTML = '';


            nativeButtons.forEach(
                (nativeButton, index) => {

                    const button =
                        document.createElement('button');


                    button.type = 'button';

                    button.className = 'fbac-question';

                    button.dataset.index = String(index);

                    button.textContent = String(index + 1);


                    button.addEventListener(
                        'click',
                        function (event) {

                            event.preventDefault();

                            event.stopPropagation();


                            jumpToQuestion(
                                Number(this.dataset.index)
                            );
                        }
                    );


                    grid.appendChild(button);
                }
            );
        }


        /*
         * toggle 带 force：
         * 状态没变时不会产生 mutation。
         */

        qsa('.fbac-question', grid).forEach(
            (button, index) => {

                const state =
                    getButtonState(
                        nativeButtons[index]
                    );


                button.classList.toggle(
                    'is-right',
                    state === 'right'
                );

                button.classList.toggle(
                    'is-wrong',
                    state === 'wrong'
                );

                button.classList.toggle(
                    'is-unanswered',
                    state === 'unanswered'
                );

                button.classList.toggle(
                    'is-current',
                    index === currentIndex
                );
            }
        );
    }


    // =========================================================
    // 自定义刷题：任意出题数量
    //
    // 目录页那个「自定义刷题」模态框里，出题数量原本只有 5/10/15/20/25/30/
    // 35/40 八个按钮。这里往里插一个能自己输数的。
    //
    // ★ 当前状态：只做了界面和探针，**还没有真的把数送到粉笔那边**。
    //   那个模态框是 Angular 的：*ngFor 渲染出来的按钮各带自己的点击监听，
    //   我们动态插进去的节点没有，改 textContent 也不会被读到。值到底走
    //   请求还是走组件状态，得先量一次才知道 —— 见下面的探针。
    // =========================================================

    /*
     * 全角数字转半角。
     *
     * 中文输入法底下很容易打出 １２３。直接当非法的话，用户只会觉得
     * 「输了没反应」，而他根本看不出自己输的是全角。
     */
    function toHalfWidthDigits(text) {

        return String(text).replace(
            /[０-９]/g,
            char => String.fromCharCode(
                char.charCodeAt(0) - 0xFEE0
            )
        );
    }


    /*
     * 解析用户输的那个数。不合法返回 null。
     *
     * 挡的是很具体的几种输入：0、负数、小数、以及一长串里混了别的字符。
     * 这种值一旦漏进去，粉笔那边要么报错、要么真给你推一整套题，而页面上
     * 不会有任何提示 —— 静默出错是最难查的。
     */
    function parseCustomCount(text) {

        if (text === null || text === undefined) {
            return null;
        }


        const raw = toHalfWidthDigits(text).trim();


        // 只认纯数字：'1e3'、'+5'、'2.5'、'20题' 一律挡掉
        if (!/^\d+$/.test(raw)) {
            return null;
        }


        const value = Number(raw);


        if (!Number.isSafeInteger(value)) {
            return null;
        }


        if (
            value < MIN_CUSTOM_COUNT ||
            value > MAX_CUSTOM_COUNT
        ) {
            return null;
        }


        return value;
    }


    /*
     * 是不是那个「自定义刷题」的目录页。
     *
     * 不能用 indexOf === 0 了事：那样 /spa/tiku/guide/catalogX 也算数。
     * 后面必须跟 / ? # 或者就到头。
     */
    function isCatalogPage(pathname) {

        if (typeof pathname !== 'string' || !pathname) {
            return false;
        }


        if (pathname === CATALOG_PATH) {
            return true;
        }


        return (
            pathname.indexOf(CATALOG_PATH) === 0 &&
            /[/?#]/.test(pathname.charAt(CATALOG_PATH.length))
        );
    }


    function onCustomCountChange(input, list) {

        const value = parseCustomCount(input.value);


        if (value === null) {

            input.classList.remove('select-button-active');

            return;
        }


        /*
         * 选中态挪到自己身上。
         *
         * 只动出题数量这一组里的 —— 年份、做题模式那几组各有自己的
         * select-button-active，一起清掉的话模态框上会同时有好几组没有
         * 选中项，看着像坏了。
         */
        qsa('.select-button-active', list).forEach(
            node => node.classList.remove('select-button-active')
        );


        input.classList.add('select-button-active');


        armProbe(value);
    }


    /*
     * 把出题数量那一组的第一个预设（就是「5」）让给一个输入框。
     *
     * 早先的做法是往末尾再接一个 <li>，凑成第 9 格 —— 八个小方块那一行本来
     * 就满了，第 9 个把行撑爆，和旁边那几个方块放一起一眼就是硬塞的。改成
     * 顶掉第一格，一行还是八格，看着仍然是粉笔自己的东西。
     *
     * 代价是「5」这个预设没了，要 5 道得自己敲。10 到 40 都不动。
     *
     * 那个 <a> 是 **藏起来**，不是删掉：它是 Angular *ngFor 渲染出来的，
     * 身上挂着粉笔自己的点击监听，从人家的清单里挖掉一个节点，下一轮重建
     * 时对不上。留着它、只是不显示，粉笔那边完全不知道自己少了一格。
     */
    function installCustomCount(list) {

        if (!list) {
            return null;
        }


        // 模态框是会被反复重建的，自己先去重，别装出第二个
        const existing = list.querySelector(
            '.' + CUSTOM_COUNT_INPUT_CLASS
        );


        if (existing) {
            return existing;
        }


        const first = list.querySelector('a.select-button');


        // 结构变了，找不到预设按钮 —— 宁可不做，也别往空列表里塞东西
        if (!first || !first.parentElement) {
            return null;
        }


        const doc = list.ownerDocument;


        /*
         * 带上粉笔自己的 class，长得才和旁边几个是一伙的 ——
         * 自己描一套颜色边框，它换主题时这一格就会突兀地亮着。
         */
        const input = doc.createElement('input');

        input.type = 'number';

        input.className =
            'select-button square-button ' +
            CUSTOM_COUNT_INPUT_CLASS;

        input.min = String(MIN_CUSTOM_COUNT);
        input.max = String(MAX_CUSTOM_COUNT);
        input.step = '1';
        input.placeholder = '自定义';

        input.title =
            '任意出题数量（' +
            MIN_CUSTOM_COUNT + '-' + MAX_CUSTOM_COUNT +
            '）';

        input.addEventListener(
            'input',
            () => onCustomCountChange(input, list)
        );


        first.style.display = 'none';

        first.setAttribute('aria-hidden', 'true');


        // 放进「5」原来那个 <li> 里，位置就还是第一格
        first.parentElement.appendChild(input);


        return input;
    }


    // =========================================================
    // 探针
    //
    // 这一轮刻意**不接管**真实出题数量 —— 值怎么送到粉笔那边还没接上。
    // 猜着改请求字段是最坏的做法：猜错了是静默出错，猜对了也没人知道。
    //
    // 所以先量。点了自定义数量之后武装 3 秒，把这期间发出去的请求、
    // localStorage 的变化、以及能不能摸到这个模态框的 Angular 组件实例，
    // 全部打到控制台。拿到这份报告，接线就是一次到位的事。
    // =========================================================

    let probeUntil = 0;
    let probeCount = null;
    let probeRecords = [];

    let probeExposed = false;
    let probeTimer = null;


    function snapshotStorage() {

        const out = {};

        try {

            for (let i = 0; i < localStorage.length; i++) {

                const key = localStorage.key(i);

                out[key] = localStorage.getItem(key);
            }

        } catch (e) {}


        return out;
    }


    function storageDiff(before) {

        const after = snapshotStorage();
        const lines = [];


        Object.keys(after).forEach(
            key => {

                if (!(key in before)) {
                    lines.push('  新增 ' + key + ' = ' + after[key]);

                    return;
                }


                if (before[key] !== after[key]) {
                    lines.push(
                        '  改动 ' + key + '：' +
                        before[key] + ' -> ' + after[key]
                    );
                }
            }
        );


        Object.keys(before).forEach(
            key => {

                if (!(key in after)) {
                    lines.push('  删除 ' + key);
                }
            }
        );


        return lines;
    }


    function bodyText(body) {

        try {

            if (typeof body === 'string') {
                return body;
            }


            if (!body) {
                return '';
            }


            if (typeof URLSearchParams !== 'undefined' &&
                body instanceof URLSearchParams) {

                return body.toString();
            }


            if (typeof FormData !== 'undefined' &&
                body instanceof FormData) {

                const pairs = [];

                body.forEach(
                    (value, key) => pairs.push(key + '=' + value)
                );

                return pairs.join('&');
            }


            return String(body);

        } catch (e) {

            return '(读不出 body)';
        }
    }


    /*
     * 摸一摸 Angular 的组件实例。
     *
     * 摸得到的话，第二轮可以直接改它的属性，不用去猜请求字段；
     * 摸不到就只能走拦截请求那条路。这里只报情况，不动它。
     */
    function describeAngularContext(element) {

        if (!element) {
            return ['  找不到模态框元素'];
        }


        const context = element.__ngContext__;


        if (!context) {
            return ['  模态框上没有 __ngContext__'];
        }


        const lines = [];


        try {

            const instances = [];


            if (Array.isArray(context)) {

                /*
                 * Ivy 的 LView：第 8 位是组件实例，第 3 位是父 LView。
                 * 往上走几层是为了找到真正持有出题数量的那个组件。
                 */
                let view = context;

                for (
                    let depth = 0;
                    depth < 12 && view;
                    depth++
                ) {

                    const instance = view[8];

                    if (
                        instance &&
                        typeof instance === 'object' &&
                        instances.indexOf(instance) === -1
                    ) {
                        instances.push(instance);
                    }

                    view = view[3];
                }
            }


            if (!instances.length) {

                lines.push(
                    '  拿到了 __ngContext__，但没从中找到组件实例'
                );
            }


            instances.forEach(
                instance => {

                    const numbers = [];


                    Object.keys(instance).forEach(
                        key => {

                            if (typeof instance[key] === 'number') {
                                numbers.push(
                                    key + '=' + instance[key]
                                );
                            }
                        }
                    );


                    lines.push(
                        '  实例 ' +
                        (
                            (instance.constructor &&
                                instance.constructor.name) ||
                            '匿名'
                        ) +
                        (
                            numbers.length
                                ? '，数字属性：' + numbers.join(', ')
                                : '，没有数字属性'
                        )
                    );
                }
            );

        } catch (error) {

            lines.push('  读 __ngContext__ 时抛错：' + error);
        }


        return lines;
    }


    /*
     * 探针上报。
     *
     * 每条请求是**当场**打出去的，不等汇总 —— 点「保存」之后页面很可能
     * 就跳走了，汇总日志根本来不及看。汇总只是给「没跳页」的情况补一份。
     */
    function noteProbeRequest(method, url, body) {

        if (Date.now() > probeUntil) {
            return;
        }


        const text = bodyText(body);


        const line =
            (method || '?') + ' ' + (url || '?') +
            (text ? '\n       body: ' + text : '');


        probeRecords.push(line);


        console.log(PROBE_TAG + ' 抓到请求 ' + line);
    }


    function finishProbe(before) {

        const storage = storageDiff(before);

        const context = describeAngularContext(
            qs('.customize-question-content')
        );


        const lines = [
            PROBE_TAG + ' ===== 开始 =====',
            '自定义数量：' + probeCount,
            '抓到的请求（' + probeRecords.length + ' 条）：'
        ];


        if (probeRecords.length) {
            probeRecords.forEach(line => lines.push('  · ' + line));
        } else {
            lines.push('  （一条都没有 —— 是不是没点到「保存」？）');
        }


        lines.push('localStorage 变化：');

        if (storage.length) {
            storage.forEach(line => lines.push(line));
        } else {
            lines.push('  无');
        }


        lines.push('Angular 组件实例：');
        context.forEach(line => lines.push(line));

        lines.push(PROBE_TAG + ' ===== 以上整段贴回来 =====');


        console.log(lines.join('\n'));
    }


    function armProbe(value) {

        probeCount = value;
        probeRecords = [];
        probeUntil = Date.now() + PROBE_WINDOW_MS;


        const before = snapshotStorage();


        console.log(
            PROBE_TAG + ' 已武装 ' + PROBE_WINDOW_MS + 'ms，' +
            '自定义数量 ' + value + '。' +
            '现在去点「保存」—— 报告会当场一行行打出来。'
        );


        clearTimeout(probeTimer);

        probeTimer = setTimeout(
            () => finishProbe(before),
            PROBE_WINDOW_MS
        );
    }


    function exposeProbe() {

        if (probeExposed) {
            return;
        }


        probeExposed = true;


        /*
         * 自动武装只有 3 秒，等用户想起来点「保存」往往已经过了。
         * 控制台敲一句就能再来一次：
         *
         *     fbCountProbe(23)
         */
        try {

            window.fbCountProbe = function (count) {

                const value = parseCustomCount(count);


                armProbe(
                    value === null
                        ? '（没给数量，只量请求）'
                        : value
                );
            };

        } catch (e) {}
    }


    /*
     * 模态框是 Angular 按需渲染的，出现和销毁都跟着用户的点击走，
     * 所以这里每轮热路径都看一眼 —— 不在目录页的话第一句就返回了，
     * 代价是一次字符串比较。
     */
    function syncCustomCount() {

        if (!isCatalogPage(location.pathname)) {
            return;
        }


        const list = qs(COUNT_LIST_SELECTOR);


        if (!list) {
            return;
        }


        if (!installCustomCount(list)) {
            return;
        }


        exposeProbe();
    }


    // =========================================================
    // 热路径
    // =========================================================

    function optimizeDynamic() {

        try {

            syncQuestions();

            updateCustomCard();

            syncCustomCount();

        } catch (error) {

            console.warn(
                '[粉笔布局优化 ' + VERSION + ']',
                error
            );
        }
    }


    // =========================================================
    // 「下载」按钮：吃掉点击
    //
    // 目前什么都不做，只是让按钮点了没反应，外加一行日志。留的口子在
    // window.fbDownloadHook —— 这份脚本是 @grant none，跑在页面上下文里，
    // 控制台直接就能给它赋值：
    //
    //     fbDownloadHook = el => console.log('你点的是', el)
    //
    // 以后要接管下载（导出成 Markdown 之类），把逻辑写进这个函数即可，
    // 不用回来动这里的拦截。
    // =========================================================

    function isDownloadTarget(target) {

        return Boolean(
            target &&
            typeof target.closest === 'function' &&
            target.closest(DOWNLOAD_SELECTOR)
        );
    }


    function installDownloadGuard(doc, host) {

        const root = doc || document;
        const context = host || window;


        root.addEventListener(
            'click',
            function (event) {

                if (!isDownloadTarget(event.target)) {
                    return;
                }


                /*
                 * 三道都要。
                 *
                 * preventDefault 挡浏览器的默认动作，
                 * stopPropagation 挡住继续往上传，
                 * stopImmediatePropagation 挡住**同一层上**后面那些监听 ——
                 * 粉笔自己的下载逻辑就挂在文档上，少这一道，文件照样下下来，
                 * 而且从页面上完全看不出脚本没生效。
                 */
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();


                const element =
                    event.target.closest(DOWNLOAD_SELECTOR);


                console.log(
                    '[粉笔布局优化] 下载按钮已拦截（暂无对应功能）'
                );


                const hook = context.fbDownloadHook;


                if (typeof hook === 'function') {

                    try {
                        hook(element, event);

                    } catch (error) {

                        console.warn(
                            '[粉笔布局优化] fbDownloadHook 抛错了',
                            error
                        );
                    }
                }
            },

            /*
             * 捕获阶段。
             *
             * 挂冒泡的话，粉笔挂在 document 上的监听先跑完，下载已经开始了。
             */
            true
        );
    }



    // =========================================================
    // MutationObserver
    // =========================================================

    function startObserver() {

        const target =
            document.body ||
            document.documentElement;


        if (!target) {
            return;
        }


        const observer =
            new MutationObserver(
                () => {

                    clearTimeout(observerTimer);


                    observerTimer =
                        setTimeout(
                            optimizeDynamic,
                            CONFIG.observerDelay
                        );
                }
            );


        observer.observe(
            target,
            {
                childList: true,
                subtree: true
            }
        );
    }


    // =========================================================
    // 初始化
    // =========================================================

    function init() {

        injectStyle();


        if (document.body) {

            hideVipModules();

            createCustomCard();

            optimizeLayout();

            optimizeDynamic();

            startObserver();

        } else {

            const wait =
                setInterval(
                    () => {

                        if (!document.body) {
                            return;
                        }


                        clearInterval(wait);

                        hideVipModules();

                        createCustomCard();

                        optimizeLayout();

                        optimizeDynamic();

                        startObserver();

                    },
                    20
                );
        }


        installRevealListener();

        installDownloadGuard();


        /*
         * Angular 延迟渲染，多补几轮。
         */

        setTimeout(optimizeLayout, 200);
        setTimeout(optimizeLayout, 500);
        setTimeout(optimizeLayout, 1000);
        setTimeout(optimizeLayout, 2000);

        setTimeout(optimizeDynamic, 200);
        setTimeout(optimizeDynamic, 500);
        setTimeout(optimizeDynamic, 1000);
        setTimeout(optimizeDynamic, 2000);


        /*
         * 布局类优化低频兜底。
         */

        layoutTimer =
            setInterval(
                optimizeLayout,
                CONFIG.layoutInterval
            );


        console.log(
            '[粉笔布局优化] ' + VERSION + ' 已加载'
        );
    }


    /*
     * 出口。
     *
     * 有 module 就是 Node（跑测试），只导出纯函数，一行 DOM 都不碰；
     * 否则是浏览器，按原来的顺序启动：document-start 先挂钩网络，再注入 CSS。
     *
     * 测试测的就是这份要发布的代码本身，不是它的副本。
     */

    if (typeof module !== 'undefined' && module.exports) {

        module.exports = {

            VERSION: VERSION,

            extractForCopy: extractForCopy,
            formatForCopy: formatForCopy,
            copyTextOf: copyTextOf,

            // 展开按钮上的两个字。测试盯着它们别再被抄成第二份 ——
            // 抄了的话，点一下按钮字就变回旧的。
            EXPAND_LABEL: EXPAND_LABEL,
            COLLAPSE_LABEL: COLLAPSE_LABEL,

            // 问 AI 那条链路的信道名。侧边栏的测试要拿它俩比对 ——
            // 两边对不上就是点了没反应，而且页面上一点线索都没有。
            askAi: askAi,
            ASK_EVENT: ASK_EVENT,
            ASK_ATTR: ASK_ATTR,
            ASK_RESULT_ATTR: ASK_RESULT_ATTR,

            // 导出是为了让侧边栏脚本的测试能读到答题卡的位置 —— 那边有
            // 一条测试盯着「AI 面板的上边缘和答题卡齐平」。数字抄一份过去
            // 比不出来的话，改了一边另一边就悄悄错位了。
            //
            // z-index 同理，而且更隐蔽：两个助手差一位数，表现是暂停遮罩
            // 盖住一个、盖不住另一个，肉眼看不出原因。
            CONFIG: CONFIG,

            // 同理，宽度那几个数也得能被读出来验
            RIGHT_RESERVE: RIGHT_RESERVE,

            // 一行几个题号。宽度是个会变的量（媒体查询会压窄卡片），
            // 所以要测的是算式，不是某个固定的列数。
            computeColumns: computeColumns,

            // 「下载」按钮的拦截。判定是纯的，拦截要起真 DOM 来验事件
            // 传播顺序 —— 少一道 stopImmediatePropagation 就是「看着拦了，
            // 文件还是下下来了」，从页面上完全看不出来。
            isDownloadTarget: isDownloadTarget,
            installDownloadGuard: installDownloadGuard,
            DOWNLOAD_SELECTOR: DOWNLOAD_SELECTOR,

            // 没题目就把答题卡收起来。判定和切换是同一件事（要区分
            // 「刚露出来」和「一直露着」，后者不该重量宽度），所以只出
            // 这一个口子。
            applyCardVisibility: applyCardVisibility,
            CARD_HIDDEN_CLASS: CARD_HIDDEN_CLASS,

            // 自定义刷题：任意出题数量
            parseCustomCount: parseCustomCount,
            isCatalogPage: isCatalogPage,
            installCustomCount: installCustomCount,

            CUSTOM_COUNT_INPUT_CLASS: CUSTOM_COUNT_INPUT_CLASS,
            COUNT_LIST_SELECTOR: COUNT_LIST_SELECTOR,
            MIN_CUSTOM_COUNT: MIN_CUSTOM_COUNT,
            MAX_CUSTOM_COUNT: MAX_CUSTOM_COUNT
        };

    } else {

        installNetworkHooks();

        injectStyle();


        if (document.readyState === 'loading') {

            document.addEventListener(
                'DOMContentLoaded',
                init,
                {
                    once: true
                }
            );

        } else {

            init();
        }
    }

})();
