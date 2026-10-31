// ==UserScript==
// @name         WorkBuddy 防卡死 / 强制停止 (MVP)
// @namespace    https://workbuddy.cn
// @version      0.1
// @description  嗅探并重放 WorkBuddy 的 cancel 控制帧，提供强制停止浮窗，绕过前端死锁；附一键反馈。
// @match        https://www.workbuddy.cn/*
// @match        https://workbuddy.ai/*
// @match        https://*.workbuddy.cn/*
// @grant        none
// ==/UserScript==

/* =========================================================================
 * 说明（务必先看）
 * -------------------------------------------------------------------------
 * 卡死根因：网页端云会话的「停止」是往当前会话的流式连接(ACP)发一个
 * cancel 控制帧，没有独立 REST 端点。连接实例藏在页面闭包里，外部脚本
 * 拿不到引用，重放又会被 sessionId 绑定 —— 所以「真终止」是尽力而为。
 *
 * 本脚本稳做的三件事：
 *   1) UI 兜底：卡死时浮窗永远能 新建/切换/刷新/反馈，不再被钉死。
 *   2) 嗅探学习：你正常点一次停止，自动记下 cancel 帧（连接+负载）。
 *   3) 一键反馈：复制模板并打开 cnb issue 列表。
 * 以及尽力做的：向「当前仍 OPEN 的、曾发过 cancel 的连接」重放该帧。
 *
 * 用法：
 *   A. 先在【正常会话】里点一次停止按钮 —— 脚本会自动学习 cancel 帧
 *      （控制台看 [WB-FreezeFix] 捕获 cancel ... 日志）。
 *   B. 之后某会话卡死，点浮窗「强制停止」尝试重放。
 *   C. 跨会话卡死时，请在该会话也先「学习」一次（重新点一次正常停止
 *      或点浮窗「重新学习」并手动触发一次停止）。
 * ========================================================================= */

(function () {
  'use strict';
  const LOG = (...a) => console.log('[WB-FreezeFix]', ...a);
  const LS_KEY = 'wbfreezefix_cancel_capture_v1';

  // ---- 运行时状态 ----
  const activeSockets = [];          // 当前 OPEN 的 WebSocket 实例
  let cancelCapture = null;          // { kind:'ws'|'xhr'|'fetch', conn, data, url, init }

  // ---- 从 localStorage 恢复（ws 实例无法序列化，仅记录“曾捕获过”标记） ----
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved && saved.kind) cancelCapture = saved; // 仅作“已学习”标记，conn 会重新捕获
    LOG('启动，已学习模板标记 =', !!saved);
  } catch (e) {}

  function persistMarker(kind) {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ kind })); } catch (e) {}
  }

  // ---- 判断是否像 cancel 消息 ----
  function looksLikeCancel(str) {
    if (!str) return false;
    return /cancel/i.test(str) || /cancelQueueByConversation/i.test(str) || /cancelCurrentTurn/i.test(str);
  }

  // ============================ 嗅探 WebSocket ============================
  const OrigWSSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      let str = null;
      if (typeof data === 'string') str = data;
      else if (data instanceof ArrayBuffer) { try { str = new TextDecoder().decode(data); } catch (e) {} }
      else if (data && typeof data.toString === 'function') str = data.toString();

      if (looksLikeCancel(str)) {
        cancelCapture = { kind: 'ws', conn: this, data, _learnedAt: Date.now() };
        persistMarker('ws');
        LOG('捕获 cancel (WebSocket):', (str || '').slice(0, 200));
      }
    } catch (e) { /* 忽略嗅探错误，绝不影响原功能 */ }
    return OrigWSSend.apply(this, arguments);
  };

  const OrigWSOpen = WebSocket.prototype.constructor;
  // 记录 OPEN 的连接，便于重放
  const _origAdd = WebSocket.prototype.addEventListener;
  WebSocket.prototype.addEventListener = function (type, listener, options) {
    if (type === 'open') {
      const self = this;
      activeSockets.push(self);
      self.addEventListener('close', () => {
        const i = activeSockets.indexOf(self);
        if (i >= 0) activeSockets.splice(i, 1);
      });
    }
    return _origAdd.apply(this, arguments);
  };

  // ============================ 嗅探 fetch / XHR ============================
  const OrigFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const body = init && init.body;
      const s = (url + ' ' + (typeof body === 'string' ? body : (body ? body.toString() : '')));
      if (looksLikeCancel(s)) {
        cancelCapture = { kind: 'fetch', url, init, _learnedAt: Date.now() };
        persistMarker('fetch');
        LOG('捕获 cancel (fetch):', url);
      }
    } catch (e) {}
    return OrigFetch.apply(this, arguments);
  };

  // ============================ 浮窗 UI ============================
  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'wbfreeze-panel';
    panel.style.cssText = [
      'position:fixed', 'right:14px', 'bottom:14px', 'z-index:2147483647',
      'width:210px', 'background:#1f1f24', 'color:#eee', 'border:1px solid #444',
      'border-radius:10px', 'font:12px/1.4 system-ui,sans-serif', 'box-shadow:0 6px 20px rgba(0,0,0,.4)',
      'user-select:none', 'overflow:hidden'
    ].join(';');
    panel.innerHTML = `
      <div style="padding:8px 10px;background:#2b2b33;font-weight:600;cursor:move;display:flex;justify-content:space-between;align-items:center">
        <span>WB 防卡死</span>
        <span id="wbf-min" style="cursor:pointer;opacity:.7">－</span>
      </div>
      <div style="padding:8px 10px;display:flex;flex-direction:column;gap:6px">
        <button data-act="stop"   style="all:unset;cursor:pointer;background:#c0392b;color:#fff;padding:7px;border-radius:6px;text-align:center">强制停止</button>
        <button data-act="relearn" style="all:unset;cursor:pointer;background:#2c3e50;color:#fff;padding:6px;border-radius:6px;text-align:center">重新学习 cancel</button>
        <button data-act="newchat" style="all:unset;cursor:pointer;background:#27ae60;color:#fff;padding:6px;border-radius:6px;text-align:center">新建会话</button>
        <button data-act="feedback" style="all:unset;cursor:pointer;background:#2980b9;color:#fff;padding:6px;border-radius:6px;text-align:center">一键反馈</button>
        <button data-act="reload" style="all:unset;cursor:pointer;background:#555;color:#fff;padding:6px;border-radius:6px;text-align:center">刷新页面</button>
        <div id="wbf-status" style="font-size:11px;opacity:.8;margin-top:2px">状态：未学习 cancel</div>
      </div>`;
    document.body.appendChild(panel);

    // 拖拽
    const head = panel.firstChild;
    let drag = false, ox = 0, oy = 0;
    head.addEventListener('mousedown', (e) => { if (e.target.id === 'wbf-min') return; drag = true; ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop; });
    window.addEventListener('mousemove', (e) => { if (drag) { panel.style.left = (e.clientX - ox) + 'px'; panel.style.top = (e.clientY - oy) + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto'; } });
    window.addEventListener('mouseup', () => drag = false);
    panel.querySelector('#wbf-min').addEventListener('click', () => {
      const body = panel.lastChild; const hidden = body.style.display === 'none';
      body.style.display = hidden ? 'flex' : 'none';
    });

    panel.querySelector('[data-act="stop"]').addEventListener('click', doForceStop);
    panel.querySelector('[data-act="relearn"]').addEventListener('click', () => { cancelCapture = null; localStorage.removeItem(LS_KEY); setStatus('已清除，请在正常会话点一次停止来重新学习'); });
    panel.querySelector('[data-act="newchat"]').addEventListener('click', () => { const a = document.querySelector('a[href*="/app"], [href*="conversation"]'); window.location.href = 'https://www.workbuddy.cn/app/'; });
    panel.querySelector('[data-act="reload"]').addEventListener('click', () => location.reload());
    panel.querySelector('[data-act="feedback"]').addEventListener('click', doFeedback);

    window.__wbf_panel = panel;
    updateStatus();
  }

  function setStatus(t) { const el = document.getElementById('wbf-status'); if (el) el.textContent = '状态：' + t; }
  function updateStatus() {
    if (!cancelCapture) { setStatus('未学习 cancel（先在正常会话点一次停止）'); return; }
    const age = cancelCapture._learnedAt ? Math.round((Date.now() - cancelCapture._learnedAt) / 1000) + 's 前' : '';
    setStatus(`已学习(${cancelCapture.kind}) ${age}，连接活跃 ${activeSockets.filter(s=>s.readyState===1).length}`);
  }

  // ============================ 强制停止（尽力重放） ============================
  function doForceStop() {
    if (!cancelCapture) { alert('还没学到 cancel 帧。请先在【正常会话】点一次停止按钮，脚本会自动记录。'); return; }
    try {
      if (cancelCapture.kind === 'ws') {
        // 优先用捕获时那条仍 OPEN 的连接；否则用当前任意 OPEN 的 ws
        const open = activeSockets.filter(s => s.readyState === 1);
        const target = (cancelCapture.conn && cancelCapture.conn.readyState === 1) ? cancelCapture.conn : open[open.length - 1];
        if (!target) { setStatus('无可用连接，尝试刷新或重新学习'); return; }
        target.send(cancelCapture.data);
        LOG('已重放 cancel 帧到连接', target.url);
        setStatus('已发送强制停止，等待服务端终结…（若无效请刷新后重学）');
      } else if (cancelCapture.kind === 'fetch') {
        OrigFetch(cancelCapture.url, cancelCapture.init).then(() => setStatus('已重发 cancel 请求'));
        LOG('已重发 cancel fetch', cancelCapture.url);
      }
    } catch (e) {
      LOG('强制停止失败', e);
      setStatus('强制停止失败：' + e.message);
    }
  }

  // ============================ 一键反馈 ============================
  const FEEDBACK_TMPL = `产品：WorkBuddy 网页版（非本地 IDE）
会话/任务 ID：（填卡死对话 URL 里 conversation 后的长串数字）

现象：某轮生成中追加消息后对话永久卡在“思考中/完成中”，停止按钮点不动，刷新无数次无效。
已尝试：停止、刷新、退出重登、换网络均无效。
复现触发：生成/任务进行中追加消息（疑似队列 drain 竞态）。
诉求：请勿删除任务；请后端强制终止该 run 并保留历史与产物。
同类参考：#1928 #1924 #1929 #1931 #1937 #1938 #1915 #1909`;

  function doFeedback() {
    navigator.clipboard?.writeText(FEEDBACK_TMPL).then(
      () => setStatus('反馈模板已复制，去粘贴'),
      () => setStatus('复制失败，见控制台')
    );
    if (!navigator.clipboard) console.log('[WB-FreezeFix] 反馈模板:\n' + FEEDBACK_TMPL);
    window.open('https://cnb.cool/codebuddy/codebuddy-code/-/issues', '_blank');
  }

  // ============================ 启动 ============================
  function init() {
    if (document.getElementById('wbfreeze-panel')) return;
    if (document.body) buildPanel();
    else document.addEventListener('DOMContentLoaded', buildPanel);
    // 周期性刷新状态
    setInterval(updateStatus, 3000);
  }
  init();
  LOG('脚本已加载。先在【正常会话】点一次停止来学习 cancel 帧，卡死时再用浮窗「强制停止」。');
})();
