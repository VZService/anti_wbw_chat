# WorkBuddy 网页端卡死应急 (anti_wbw_chat)

Tampermonkey 篡改猴 userscript，针对 [workbuddy.cn/app](https://www.workbuddy.cn/app/) 网页端云会话卡死场景。

## 是什么

WorkBuddy 网页端（cloud = web 产品，与桌面客户端 client 是两回事）存在一个系统性卡死 bug：在某轮还在生成时追加消息、或 `@` 一个连接器链接（如 cnb），会话会永久卡在「思考中」——停止按钮点不动、刷新无效。根因在服务端那条悬挂的 run/任务假死，前端每次刷新只是把这个假死状态重新投影出来。cnb.cool 上 codebuddy-code 的 issues #1909 到 #1938 就是一整片同类故障。

本脚本**不声称能替官方修服务端**，而是提供三件稳的事：

1. 左下角可折叠浮窗，永远能「新建会话 / 刷新 / 一键提 issue」，不再被钉死在卡死页。
2. 「一键提 issue」自动抓取地址栏的会话 ID 并复制反馈模板，打开 cnb issue 页——这是真正能救僵尸 run 的路径（官方后台作废 run 并保留数据）。
3. 「尝试解锁 / 点原生停止」作为尽力而为的本地尝试，但**不保证有效**，见下方边界。

## 红线（已踩坑）

> 网页端某轮还在生成时，绝对不要追加或发送新消息，也不要 `@` 未授权/被拦截的外部链接。

一旦触发，队列永不 drain、取消入口被 `b8e(awaiting-response)` 焊死，表现就是一直「思考中」+ 停止点不动 + 刷新无效。想换话题先停、等图标变回发送再输入。

## 安装

1. 浏览器装 [Tampermonkey](https://www.tampermonkey.net/)（篡改猴）插件。
2. 把 `anti_wbw_chat.user.js` 内容新建为一条用户脚本，或拖入 Tampermonkey 管理页。
3. 打开 `https://www.workbuddy.cn/app/` 任意会话，左下角出现 `WB` 圆按钮即生效。

## 用法

- 点 `WB` 圆按钮展开面板。
- 浮窗默认收起在**左下角**，刻意避开底部输入框右侧的发送按钮，不挡操作。
- 卡死时：直接点「一键提 issue」，会话 ID 会自动带进模板，把链接和模板递给官方即可。
- 「新建会话 / 刷新」用于兜底脱离卡死页。

## 边界（诚实说明，纯前端无法突破）

- **「尝试解锁」不可靠**：zustand 的 `sessionStore` api 只活在模块闭包里，未必出现在 React fiber 的可枚举属性上，脚本大概率找不到。找不到时按钮变红提示，属正常。
- **「点原生停止」在卡死会话上通常无效**：正常会话能停（证明原生取消路径有效），但卡死会话的停止点击被 `k0c()` 在发帧前静默吞掉；即便解锁成功，还有两道闸脚本够不到——controller 实例字段 `this.cancelBarrier`（若残留为 `true` 仍拦），以及最致命的**服务端僵尸 run 是否响应 cancel 不可保证**。
- 所以「脚本强停卡死会话」从架构上走不通；唯一能把会话救活的，是把会话 ID 交给官方后台作废 run。脚本的价值是**应急脱离 + 自动报警（带 ID 提 issue）**。

## 真正的修复（建议官方）

1. `cancel()` 的 15s 超时后必须释放 `cancelBarrier` 并复位 `isCanceling`（源码里超时只是 return，导致 barrier 永久为 true）。
2. `await this.activeSendAcceptance` 加超时（否则追加消息那次 sendPrompt 的悬挂 Promise 会卡死后续取消）。
3. 服务端每个 run 必设最大运行时长 + 僵尸检测，超时主动推 terminal 事件。
4. `k0c()` 不应把 `awaiting-response` 当作「禁止取消」，应保留一个强制停止绕过拦截。
5. 连接器链接解析（`pending-auth` + `ssrf_blocked`、`linkResolveState=idle`）改为异步、可失败、超时降级为纯文本，不阻塞主流程。

## 仓库

- 源码：`anti_wbw_chat.user.js`
- License：MIT（`LICENSE`）
- 关联记忆：`VZService-AI/files` 的 `memory/workbuddy-cloud.md`（网页端卡死笔记，已归入 cloud 而非 client）
