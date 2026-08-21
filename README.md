# dsh-meeting-notes

AI 实时会议听记助手 — DeepSeek Harness 插件。

在 DSH 浏览器界面中添加一个「会议听记」面板，支持实时音频采集、语音转写、AI 纪要生成。

## 功能

- **实时音频采集**：同时监听麦克风 + 系统音频（如线上会议）
- **实时语音转写**：使用 Web Speech API 将语音实时转换为文字
- **AI 纪要生成**：每累积 15-20 秒转写文本，自动调用 DeepSeek Chat API 生成结构化纪要
- **纪要卡片时间线**：每段纪要输出为一张图文卡片，按时间线排列
- **完整会议纪要**：结束会议时自动生成完整会议纪要汇总报告
- **统计卡片**：总时长、纪要轮次、要点总数、待办数

## 安装

```bash
npm install dsh-meeting-notes
```

然后在 DSH profile 的 `cordis.yml` 中添加：

```yaml
plugins:
  - id: meeting-notes
    name: dsh-meeting-notes
```

## 配置

设置环境变量 `DEEPSEEK_API_KEY` 以启用 AI 摘要生成。不设置则使用 Demo 模式。

## 使用

1. 打开 DSH Web 界面
2. 在会话页面顶部标签栏中点击「会议听记」
3. 点击「🎤 开始听记」按钮
4. 允许麦克风权限
5. 开始说话，转写文字实时显示在面板底部

## 技术架构

```
浏览器端（lib/client.js）          Node端（lib/index.js）
┌──────────────────────┐          ┌──────────────────────┐
│ AudioCapture         │          │ MeetingNotesService  │
│ ASR (Web Speech)     │──text──→│ Summarizer           │
│ React UI             │←notes──│ (DeepSeek API)       │
│  - StatsBar          │  RPC    │ 状态管理 / 数据队列  │
│  - Timeline          │  host.  └──────────────────────┘
│  - NoteCards         │  call
│  - LiveTranscript    │
│  - ControlBar        │
└──────────────────────┘
```

## 许可

MIT