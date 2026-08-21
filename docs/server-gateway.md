# Inspiration Drawer Mobile 服务端网关

## 目标

移动端应用不保存 XAIS、New API、Bigmodel 或其他上游渠道密钥，也不允许用户填写 API。
APK 只发送稳定的公开模型 ID；应用服务端负责鉴权、余额判断、渠道选择、失败重试与任务轮询。

移动端配置：

```powershell
$env:INSPIRATION_DRAWER_SERVER_URL = "https://api.example.com"
# 仅用于内网联调；生产环境应替换为登录后签发的短期用户会话。
$env:INSPIRATION_DRAWER_SERVER_TOKEN = "development-session-token"
npm run tauri android build -- --apk
```

Android 模拟器访问电脑本机服务时可使用 `http://10.0.2.2:8787`。真机联调应使用电脑的局域网
IP 和允许访问的端口；正式环境必须使用 HTTPS。

## 1. 生图接口

`POST /api/tablet/v1/images/generations`

请求：

```json
{
  "requestId": "generation-request-123",
  "model": "nano-banana-pro",
  "prompt": "已合并工业设计系统提示词和规则的最终提示词",
  "aspectRatio": "1:1",
  "resolution": "2k",
  "count": 4,
  "ruleKeys": ["product_consistency", "premium_lighting"],
  "references": [
    {
      "name": "reference.png",
      "mimeType": "image/png",
      "dataUri": "data:image/png;base64,..."
    }
  ]
}
```

同步成功响应：

```json
{
  "requestId": "generation-request-123",
  "images": [
    { "url": "https://cdn.example.com/generated/123-1.png" }
  ]
}
```

每一项也可返回 `dataUri`、`b64Json` 或 `b64_json`。当前客户端最长等待 15 分钟；如果上游是
异步任务，网关应在服务端完成提交和轮询，再把最终图片一次性返回。错误统一返回：

```json
{
  "error": { "message": "可直接展示给用户的错误信息" }
}
```

## 2. 提示词优化接口

`POST /api/tablet/v1/prompts/optimize`

请求：

```json
{
  "prompt": "便携式桌面投影仪，磨砂铝机身",
  "mediaType": "image",
  "locale": "zh-CN"
}
```

响应：

```json
{
  "optimizedPrompt": "优化后的完整工业设计生图提示词"
}
```

优化服务只返回最终提示词，不返回解释、标题或 Markdown。客户端会检查优化期间用户是否已经
改写原提示词；如已改写，则不会覆盖当前输入。

## 3. 三模型服务端路由

| 平板公开模型 ID | 显示名 | XAIS | New API | Bigmodel |
| --- | --- | --- | --- | --- |
| `nano-banana-pro` | Nano Banana Pro | `Xais Nano Pro_2K` / `Xais Nano Pro_4K` | `gemini-3-pro-image` | `gemini-3-pro-image-preview` |
| `nano-banana-2` | Nano Banana 2 | `Xais Nano2_2K` / `Xais Nano2_4K` | `gemini-3.1-flash-image` | — |
| `gpt-image-2` | GPT Image 2 | `Xais Img2_2K` / `Xais Img2_4K` | `gpt-image-2` | `gpt-image-2` |

建议服务端流程：

1. 验证用户会话、请求大小、模型 ID、参考图数量和配额。
2. 根据用户权益、清晰度与渠道健康度选择上表中的实际模型。
3. 复用桌面端对应渠道适配器发起任务；异步渠道在服务端轮询。
4. 把结果上传到受控对象存储，返回短期签名 HTTPS URL。
5. 记录 `requestId`，实现幂等、防重复扣费、审计和故障追踪。

不要让客户端提交任意上游 `provider`、模型名称、Base URL 或渠道密钥。服务端必须将公开模型
ID 映射到白名单路由，避免 APK 被反编译后绕过渠道策略。
