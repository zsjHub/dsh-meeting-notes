# dsh-meeting-notes

AI 实时会议听记助手 — DeepSeek Harness 插件。

在 DSH 浏览器界面中添加一个「会议听记」面板，支持实时语音转写、AI 纪要生成、历史会话管理。

## 功能

- **侧边栏入口**：在侧边栏「设置」上方常驻「听记」按钮，一键进入会议听记模式
- **历史会话管理**：每次录音独立保存，左侧列表展示所有历史记录，支持查看、删除
- **实时语音转写**：使用 Web Speech API 将语音实时转换为文字
- **AI 纪要生成**：结束录音后自动调用 DeepSeek API 生成结构化摘要（会议摘要、关键要点、待办事项）
- **数据持久化**：所有会议记录存储在 `$DSH_HOME/meeting-notes/` 目录，切换标签页不丢失

## 安装

```bash
npm install dsh-meeting-notes
```

然后在 DSH profile 中安装该插件：

```bash
dsh plugin add dsh-meeting-notes
```

## 配置

API Key 通过 **Settings → Models** 界面配置，无需设置环境变量。

## 使用

1. 打开 DSH Web 界面
2. 在侧边栏底部点击「听记」按钮（⚙️ 设置上方）
3. 点击「新听记」或「开始听记」按钮
4. 允许麦克风权限
5. 开始说话，转写文字实时显示
6. 点击「结束并生成纪要」自动生成结构化摘要

## 技术架构

```
浏览器端（lib/client.js）          Node端（lib/index.js）
┌──────────────────────┐          ┌──────────────────────┐
│ SidebarEntry         │          │ harness.handle()     │
│ MeetingNotesApp      │──host──→│ 会议管理 / 文件存储   │
│  - 历史列表           │  .call   │ 索引 index.json      │
│  - 详情视图           │←───────│ 笔记 notes/{id}.json │
│  - 录音控制           │  RPC     │ LLM 摘要生成         │
│  - 实时转写           │          └──────────────────────┘
└──────────────────────┘
```

### 数据存储

```
$DSH_HOME/meeting-notes/
├── index.json              # 会议索引列表（id/标题/日期/时长/状态）
└── notes/{id}.json         # 每条会议的完整数据（含转写全文、摘要）
```

## 许可

MIT