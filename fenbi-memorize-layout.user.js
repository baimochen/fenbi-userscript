// ==UserScript==
// @name         粉笔刷题/背题页面布局优化
// @namespace    https://github.com/baimochen/fenbi-userscript
// @version      2.0
// @description  粉笔背题页面优化：拦截接口一次取全解析/来源/考点、点选项瞬出、隐藏VIP视频/笔记、限制题目宽度、自制答题卡
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

    // =========================================================
    // 配置
    // =========================================================

    const CONFIG = {

        // 题目最大宽度
        questionMaxWidth: 1200,

        // 右侧答题卡预留空间
        rightReserve: 250,

        // 答题卡
        cardTop: 65,
        cardRight: 16,
        cardWidth: 220,
        columns: 5,

        // Observer 延迟
        observerDelay: 150,

        // 布局类优化的低频周期
        layoutInterval: 1500,

        // 当前题号几何回退的缓存时长
        currentIndexTTL: 250
    };


    const PANEL_CLASS = 'fb-sol-panel';
    const PANEL_VISIBLE = 'fb-sol-visible';
    const PANEL_EXPANDED = 'fb-sol-expanded';
    const TOGGLE_CLASS = 'fb-solution-toggle';

    const API_KEYWORD = '/combine/static/solution';


    let customCard = null;
    let observerTimer = null;
    let layoutTimer = null;

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
                } catch (e) {}


                return rawOpen.apply(this, arguments);
            };


            proto.send = function () {

                try {

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

                window.fetch = function (input) {

                    const url =
                        typeof input === 'string'
                            ? input
                            : (input && input.url) || '';


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

               默认整块不显示，
               点过该题选项后才加 .fb-sol-visible。
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


            html body
            .${PANEL_CLASS} .fb-sol-title {

                flex: 0 0 auto !important;

                color: #303133 !important;

                font-size: 13px !important;

                line-height: 20px !important;

                font-weight: 600 !important;
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

                margin: 0 0 0 auto !important;

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
                        100% - ${CONFIG.rightReserve}px
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
                    2147483646 !important;

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

                padding: 11px !important;

                box-sizing: border-box !important;
            }


            #fenbi-custom-answer-card
            .fbac-status {

                display: flex !important;

                align-items: center !important;

                justify-content: space-between !important;

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


            #fenbi-custom-answer-card
            .fbac-grid {

                display: grid !important;

                grid-template-columns:
                    repeat(
                        ${CONFIG.columns},
                        minmax(0, 1fr)
                    ) !important;

                gap: 7px !important;

                width: 100% !important;

                box-sizing: border-box !important;
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
                '<span class="fb-sol-title">解析</span>' +
                '<button type="button" class="' +
                    TOGGLE_CLASS +
                    '" aria-expanded="false">展开 ▾</button>' +
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
                    open ? '收起 ▴' : '展开 ▾'
                );


                button.setAttribute(
                    'aria-expanded',
                    open ? 'true' : 'false'
                );
            }
        );


        container.appendChild(panel);


        return panel;
    }


    /*
     * 单题同步：没面板就建，建过就跳过。
     */
    function syncQuestion(ti) {

        if (
            ti.__fbPanel &&
            ti.__fbPanel.isConnected
        ) {
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


        const panel =
            buildPanel(ti, data);


        ti.__fbPanel = panel;


        /*
         * 用户已经点过这题，
         * 但面板当时还没建出来（数据晚到），
         * 这里补上可见状态。
         */
        if (ti.__fbRevealed) {
            panel.classList.add(PANEL_VISIBLE);
        }
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


        if (ti.__fbPanel) {
            ti.__fbPanel.classList.add(
                PANEL_VISIBLE
            );
        }
    }


    function installRevealListener() {

        document.addEventListener(
            'click',
            function (event) {

                const target = event.target;


                if (!target || !target.closest) {
                    return;
                }


                const choice =
                    target.closest(
                        '.choice-radio, ' +
                        '.option-radio, ' +
                        '.choice-radio-label'
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
                    `calc(100% - ${CONFIG.rightReserve}px)`
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

        } catch (error) {

            console.warn(
                '[粉笔布局优化 2.0] layout',
                error
            );
        }
    }


    // =========================================================
    // 答题卡
    // =========================================================

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


        if (!nativeButtons.length) {

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
    // 热路径
    // =========================================================

    function optimizeDynamic() {

        try {

            syncQuestions();

            updateCustomCard();

        } catch (error) {

            console.warn(
                '[粉笔布局优化 2.0]',
                error
            );
        }
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
            '[粉笔布局优化] 2.0 已加载'
        );
    }


    /*
     * document-start：
     * 先挂钩网络，再注入 CSS。
     */

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

})();
