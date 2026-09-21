// 这个文件只干一件事：在粉笔页面顶上打一个标记。
//
// 为什么需要标记 —— 跨域的 iframe 被 X-Frame-Options 拦掉之后，外面那层脚本
// 拿不到 contentDocument，也分不清「加载好了」和「被拦了」：两种情况 onload
// 都照常触发。所以「扩展到底装没装」这件事只能由扩展自己说。
//
// 标记打在 documentElement 上（不是 window 上的变量）—— 扩展的 content script
// 跑在隔离世界，window 上的东西页面脚本看不见，但 DOM 属性是共享的。
//
// 属性名要和 fenbi-ai-sidebar.user.js 里的 UNFRAME_MARK 一致。

(() => {

    const MARK = 'data-fbai-unframe';
    const VALUE = '1';

    function mark() {

        const root = document.documentElement;

        if (!root) {
            return false;
        }

        root.setAttribute(MARK, VALUE);

        return true;
    }

    // manifest 里写的是 document_start，正常情况下 documentElement 已经在了。
    // 但万一遇到 XML 文档或者解析还没到那一步，就等根节点出现。
    if (!mark()) {

        const observer = new MutationObserver(() => {
            if (mark()) {
                observer.disconnect();
            }
        });

        observer.observe(document, { childList: true });

        // 兜底：别让观察器一直挂着
        window.setTimeout(() => observer.disconnect(), 10000);
    }

    console.log('[AI 去头] 已生效：这个页面里的 AI 站点可以被嵌入了');
})();
