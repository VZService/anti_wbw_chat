# anti_wbw_chat

WorkBuddy 网页端（cloud，即 workbuddy.cn/app）对话卡死应急脚本（Tampermonkey / 篡改猴 userscript）。

## 背景

网页端某轮还在生成时追加或发送消息，消息只进云端队列（cloud transport 不支持把新话注入当前 turn），队列唯一出口是上一轮彻底结束。一旦服务端那个 turn 卡死（典型触发是 @了一个连接器链接，解析停在 `pending-auth` + `ssrf_blocked`、`linkResolveState=idle`），队列永不 drain，且取消入口被 `b8e(awaiting-response)` 焊死：停止点击静默 return，连取消请求都不发。表现：一直「思考中」、停止按钮点不动、刷新无数次无效。根因在服务端悬挂 run，前端每次刷新只是把假死状态重新投影出来。cnb.cool 上 codebuddy-code 的 issues #1909 到 #1938 是一整片系统性卡死。

> 红线：网页端某轮还在生成时，绝对不要追加或发送新消息。想换话题就先停止、等图标变回发送、再输入。

## 这个脚本能做什么

纯前端 userscript，治不了服务端病根，但能做三件实事：

1. **UI 兜底**：卡死时右下角浮窗永远能「强制停止 / 新建会话 / 刷新 / 一键反馈」，不再被钉死在当前页。
2. **嗅探学习**：你在【正常会话】点一次停止，脚本自动记下 cancel 控制帧（连接 + 负载），控制台有 `[WB-FreezeFix]` 日志。
3. **一键反馈**：复制模板并打开 cnb issue 列表。

以及尽力做的：向当前仍 OPEN 的、曾发过 cancel 的连接重放该帧，尝试在浏览器侧终结那一轮（受 sessionId 绑定限制，不保证 100%）。

## 用法

1. 安装 Tampermonkey / 篡改猴，导入 `anti_wbw_chat.user.js`。
2. 先在【正常会话】点一次停止按钮 —— 脚本学习 cancel 帧（控制台看 `[WB-FreezeFix] 捕获 cancel ...`）。
3. 之后某会话卡死，点浮窗「强制停止」尝试重放。
4. 跨会话卡死时，请在该会话也先「学习」一次（点浮窗「重新学习 cancel」并手动触发一次正常停止）。

## 诚实的边界

- 真终止服务端 run 只能尽力，最稳的解法仍是官方后台把悬挂任务标记结束（把卡死对话的会话 ID 贴到 cnb issue）。
- 根治要官方改两处：#1 取消 15s 超时后必须释放 barrier；#3 服务端 run 必须有最大运行时长与僵尸检测，超时主动推 terminal。
- 沙箱里没法实跑 WorkBuddy 网页，本脚本按代码逆向出的机制编写；装上后把控制台 `[WB-FreezeFix]` 日志反馈，可进一步精修重放逻辑。

## 许可

MIT
