// ==UserScript==
// @name         WorkBuddy 网页端卡死应急 (anti_wbw_chat)
// @namespace    https://github.com/VZService/anti_wbw_chat
// @version      0.3.0
// @description  解决 workbuddy.cn/app 网页端云会话卡死：停止失效/刷新无效时的应急兜底 + 一键提 issue（自动带会话ID）。注意：真正让僵尸 run 复活的只能是官方后台作废。
// @author       VZService
// @match        https://www.workbuddy.cn/app/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const LOG = (...a) => console.log('[WB-FreezeFix]', ...a);
  LOG('脚本注入 v0.3.0');

  /* ---------- 1. 自动抓 conversationId ---------- */
  function getConversationId() {
    const u = new URL(location.href);
    let id =
      u.searchParams.get('conversation') ||
      u.searchParams.get('conv') ||
      u.searchParams.get('session');
    if (!id) {
      const m = location.pathname.match(/[/=]([0-9]{10,})/);
      if (m) id = m[1];
    }
    return id || null;
  }

  /* ---------- 2. 尝试从 React fiber 找 zustand sessionStore api ----------
     局限（重要）：zustand api 只活在模块闭包里，未必出现在 fiber 可枚举属性上，
     所以本函数很可能返回 null。返回 null 时说明此版本页面结构下无法前端解锁，
     请直接用"一键提 issue"把会话ID交给官方后台作废 run。 */
  function findSessionStoreApi() {
    const roots = [];
    const all = document.querySelectorAll('*');
    for (const el of all) {
      for (const k in el) {
        if (k.startsWith('__reactContainer$') || k === '_reactRootContainer') {
          const f = el[k];
          if (f) roots.push(f);
        }
      }
    }
    if (!roots.length) return null;

    const fibers = [];
    const fseen = new Set();
    (function collect(f) {
      if (!f || typeof f !== 'object' || fseen.has(f)) return;
      fseen.add(f);
      fibers.push(f);
      if (f.child) collect(f.child);
      if (f.sibling) collect(f.sibling);
    })(roots[0].current || roots[0]);

    // 在 fiber 的 memoizedState / memoizedProps / stateNode 三种挂载点上递归找 api
    const aseen = new Set();
    let found = null;
    let scanned = 0;
    (function scan(o, depth) {
      if (!o || typeof o !== 'object' || aseen.has(o) || found || depth > 12) return;
      aseen.add(o);
      scanned++;
      if (
        typeof o.getState === 'function' &&
        typeof o.setState === 'function' &&
        typeof o.subscribe === 'function'
      ) {
        try {
          const s = o.getState();
          if (s && typeof s === 'object' && 'bootstrapPhase' in s && 'conversationId' in s) {
            found = o;
            return;
          }
        } catch (e) {}
      }
      const keys = Object.keys(o);
      if (keys.length > 30) keys.length = 30;
      for (const k of keys) {
        try { scan(o[k], depth + 1); } catch (e) {}
      }
    })(null, 0);

    for (const f of fibers) {
      if (found) break;
      scan(f.memoizedState, 0);
      scan(f.memoizedProps, 0);
      scan(f.stateNode, 0);
    }
    LOG('store 查找：扫描对象数=' + scanned + ' 命中=' + (found ? 'yes' : 'no'));
    return found;
  }

  /* ---------- 3. 解锁前端自锁（尽力，可能失败）---------- */
  function unlockFrontend() {
    const api = findSessionStoreApi();
    if (!api) {
      LOG('未找到 sessionStore，前端解锁不可用（此版本页面结构下无解，请用一键提 issue）');
      return false;
    }
    try {
      api.setState({ bootstrapPhase: undefined, isCancelBarrierActive: false });
      LOG('已尝试解锁前端状态：bootstrapPhase->undefined, isCancelBarrierActive->false');
      return true;
    } catch (e) {
      LOG('解锁失败', e);
      return false;
    }
  }

  /* ---------- 4. 找原生 stop 按钮并点击（解锁后才可能生效）---------- */
  function clickNativeStop() {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      const label = (
        b.getAttribute('aria-label') ||
        b.getAttribute('title') ||
        b.textContent ||
        ''
      ).toLowerCase();
      if (label.includes('停止') || label.includes('stop') || label.includes('中断')) {
        b.click();
        LOG('已点击原生 stop 按钮:', label.trim());
        return true;
      }
    }
    LOG('未找到原生 stop 按钮');
    return false;
  }

  /* ---------- 5. 一键提 issue（真正能救僵尸 run 的路径）---------- */
  function openIssue() {
    const cid = getConversationId();
    const tmpl =
      `【严重Bug】网页端某轮生成中追加消息 / @链接后，会话永久卡死：一直"思考中"、停止按钮点不动、刷新无效。\n` +
      `诉求：请在后台把该会话的悬挂任务(run)标记结束/取消，救活对话（保留历史与文件）。\n` +
      `会话ID：${cid || '(从卡死对话地址栏 URL 的 conversation 参数复制)'}\n` +
      `复现：生成中追加消息或 @cnb 链接 → 连接器解析卡在 pending-auth+ssrf_blocked → 队列永不 drain → 取消入口被 b8e(awaiting-response) 焊死。\n` +
      `建议官方修复：cancel 15s 超时后必须释放 barrier（源码 setCancelBarrier 超时未 release）；await activeSendAcceptance 加超时；服务端 run 必设最大运行时长 + 僵尸检测。`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tmpl).then(
        () => {
          LOG('反馈模板已复制到剪贴板');
          window.open('https://cnb.cool/codebuddy/codebuddy-code/-/issues/new', '_blank');
        },
        () => {
          LOG('复制失败，已打开 issue 页');
          window.open('https://cnb.cool/codebuddy/codebuddy-code/-/issues/new', '_blank');
        }
      );
    } else {
      window.open('https://cnb.cool/codebuddy/codebuddy-code/-/issues/new', '_blank');
    }
  }

  /* ---------- 6. 可折叠浮窗（左下角，不挡发送按钮）---------- */
  function buildUI() {
    if (document.getElementById('wb-freezefix-fab')) return;
    const fab = document.createElement('div');
    fab.id = 'wb-freezefix-fab';
    fab.textContent = 'WB';
    fab.style.cssText =
      'position:fixed;left:16px;bottom:16px;z-index:2147483647;width:40px;height:40px;border-radius:50%;' +
      'background:#111827;color:#60a5fa;border:1px solid #374151;font:600 14px system-ui;' +
      'display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'wb-freezefix-panel';
    panel.style.cssText =
      'position:fixed;left:16px;bottom:64px;z-index:2147483647;background:#111827;color:#e5e7eb;' +
      'border:1px solid #374151;border-radius:10px;padding:10px;font:13px/1.4 system-ui;width:190px;' +
      'box-shadow:0 8px 30px rgba(0,0,0,.4);display:none';
    panel.innerHTML =
      '<div style="font-weight:600;margin-bottom:6px">WB 卡死应急</div>' +
      '<div style="font-size:11px;color:#9ca3af;margin-bottom:8px">会话ID:<span id="wb-cid" style="color:#60a5fa">读取中</span></div>' +
      '<button data-act="unlock" style="display:block;width:100%;margin:3px 0;padding:6px;background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:6px;cursor:pointer">尝试解锁(不稳定)</button>' +
      '<button data-act="stop" style="display:block;width:100%;margin:3px 0;padding:6px;background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:6px;cursor:pointer">点原生停止</button>' +
      '<button data-act="issue" style="display:block;width:100%;margin:3px 0;padding:6px;background:#7c2d12;color:#fff;border:1px solid #b45309;border-radius:6px;cursor:pointer">一键提 issue</button>' +
      '<button data-act="new" style="display:block;width:100%;margin:3px 0;padding:6px;background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:6px;cursor:pointer">新建会话</button>' +
      '<button data-act="reload" style="display:block;width:100%;margin:3px 0;padding:6px;background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:6px;cursor:pointer">刷新</button>' +
      '<div style="font-size:10px;color:#6b7280;margin-top:6px">僵尸 run 仍需官方后台作废</div>';
    document.body.appendChild(panel);

    panel.querySelector('#wb-cid').textContent = getConversationId() || '未取到';

    fab.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    panel.addEventListener('click', (e) => {
      const act = e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'unlock') {
        const ok = unlockFrontend();
        e.target.style.background = ok ? '#065f46' : '#7f1d1d';
        if (!ok) setTimeout(() => (e.target.style.background = '#1f2937'), 1200);
      } else if (act === 'stop') {
        clickNativeStop();
      } else if (act === 'issue') {
        openIssue();
      } else if (act === 'new') {
        location.href = 'https://www.workbuddy.cn/app/';
      } else if (act === 'reload') {
        location.reload();
      }
    });
    LOG('浮窗已挂载（左下角可折叠）');
  }

  if (document.readyState !== 'loading') buildUI();
  else document.addEventListener('DOMContentLoaded', buildUI);

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      const fab = document.getElementById('wb-freezefix-fab');
      const panel = document.getElementById('wb-freezefix-panel');
      if (fab) fab.remove();
      if (panel) panel.remove();
      buildUI();
    }
  }, 2000);
})();
