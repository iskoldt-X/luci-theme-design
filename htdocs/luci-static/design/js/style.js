// 设置 indicators 图标。原代码用已废弃的 DOMSubtreeModified 事件 + eval，
// 现改为 MutationObserver + 直接字符常量；并加 null 保护避免 indicators
// 容器在重渲染瞬态为空时调用 firstElementChild.getAttribute 抛错。
(function () {
	var indicators = document.getElementById("indicators");
	if (!indicators) return;

	new MutationObserver(function () {
		var first = indicators.firstElementChild;
		if (first && first.getAttribute("data-indicator") !== "uci-changes") {
			first.textContent = '';
		}
	}).observe(indicators, { childList: true, subtree: true });
})();
