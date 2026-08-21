export const name = 'dsh-meeting-notes'
export const inject = ['timer']

export function apply(ctx) {
  var apiKey = ''
  try { apiKey = (typeof process !== 'undefined' && process.env && process.env.DEEPSEEK_API_KEY) || '' } catch (e) {}
  var apiBaseUrl = 'https://api.deepseek.com'
  var model = 'deepseek-chat'
  var summarizationInterval = 18000

  var state = {
    status: 'idle', startTime: null, totalDuration: 0, speakingTurns: 0,
    transcriptBuffer: '', fullTranscript: '', notes: [],
    lastSummarizedAt: 0, hasFinalSummary: false,
  }

  var summarizerTimer = null

  function stopSummarizer() { if (summarizerTimer) { summarizerTimer(); summarizerTimer = null } }
  function startSummarizer() {
    stopSummarizer()
    summarizerTimer = ctx.timer.interval(async function() {
      if (state.status !== 'running') return
      if (state.transcriptBuffer.trim().length < 10) return
      await runSummarization()
    }, summarizationInterval)
  }

  function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }

  function formatDuration(seconds) {
    var h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60)
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
    return m + ':' + String(s).padStart(2, '0')
  }

  function getSerializableState() {
    var elapsed = state.status === 'running' && state.startTime
      ? state.totalDuration + Math.floor((Date.now() - new Date(state.startTime).getTime()) / 1000)
      : state.totalDuration
    return {
      status: state.status, totalDuration: elapsed, formattedDuration: formatDuration(elapsed),
      speakingTurns: state.speakingTurns, totalNotes: state.notes.length,
      totalActionItems: state.notes.reduce(function(sum, n) { return sum + (n.action_items ? n.action_items.length : 0) }, 0),
      totalKeyPoints: state.notes.reduce(function(sum, n) { return sum + (n.key_points ? n.key_points.length : 0) }, 0),
      hasFinalSummary: state.hasFinalSummary,
    }
  }

  async function callDeepSeek(systemPrompt, transcript) {
    var url = apiBaseUrl.replace(/\/+$/, '') + '/v1/chat/completions'
    var response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: transcript }], temperature: 0.3, max_tokens: 1024 }),
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) { var errorText = await response.text().catch(function() { return 'Unknown error' }); throw new Error('DeepSeek API error ' + response.status + ': ' + errorText) }
    var data = await response.json()
    var content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ''
    var jsonStr = content.trim()
    if (jsonStr.startsWith('```')) { jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '') }
    return JSON.parse(jsonStr)
  }

  function generateDemoSummary(text) {
    var sentences = text.split(/[。！？\n]/).filter(function(s) { return s.trim().length > 0 })
    var summary = sentences.length > 0 ? sentences[0].slice(0, 30) + (sentences[0].length > 30 ? '…' : '') : '(无内容)'
    var words = text.split(/[\s,，。、]+/).filter(function(w) { return w.length > 0 })
    var key_points = ['Demo模式 — 设置DEEPSEEK_API_KEY以获取AI摘要']
    if (words.length > 3) { key_points.unshift('讨论了 ' + words.slice(0, Math.min(3, words.length)).join('、') + ' 等相关话题') }
    var action_items = ['复盘会议内容']
    if (text.includes('需要') || text.includes('应该') || text.includes('要')) { action_items.unshift('跟进讨论中提到的待办事项') }
    return { summary: summary, key_points: key_points, action_items: action_items }
  }

  async function runSummarization() {
    var text = state.transcriptBuffer.trim()
    if (!text) return
    state.transcriptBuffer = ''
    state.lastSummarizedAt = Date.now()
    var noteData
    if (apiKey) {
      try {
        var sp = 'You are a professional meeting minutes assistant. Convert the following meeting transcript into structured minutes.\n\nRespond with **valid JSON only**, no markdown fences, no extra text:\n{\n  \"summary\": \"One-sentence summary of the core content (max 30 words)\",\n  \"key_points\": [\"Point 1\", \"Point 2\", \"Point 3\", \"Point 4\", \"Point 5\"],\n  \"action_items\": [\"Action 1\", \"Action 2\"]\n}\n\nRules:\n- summary must be a single concise sentence\n- key_points: 3-5 bullet points covering the main discussion topics\n- action_items: 0-3 actionable items\n- If the transcript is empty or meaningless, return {\"summary\":\"(No meaningful content)\",\"key_points\":[],\"action_items\":[]}'
        noteData = await callDeepSeek(sp, text)
      } catch (error) {
        console.error('[meeting-notes] Summarization failed: ' + error.message)
        noteData = { summary: '(摘要生成失败)', key_points: ['(API调用失败，请检查API Key和网络连接)'], action_items: [] }
      }
    } else {
      noteData = generateDemoSummary(text)
    }
    state.notes.push({ id: generateId(), timestamp: new Date().toISOString(), summary: noteData.summary || '(无摘要)', key_points: Array.isArray(noteData.key_points) ? noteData.key_points : [], action_items: Array.isArray(noteData.action_items) ? noteData.action_items : [] })
    state.speakingTurns++
  }

  async function generateFinalSummary() {
    if (state.hasFinalSummary) return
    state.hasFinalSummary = true
    if (state.transcriptBuffer.trim().length >= 10) { await runSummarization() }
    var fullText = state.fullTranscript.trim()
    if (!fullText) {
      state.notes.unshift({ id: 'final-' + generateId(), timestamp: new Date().toISOString(), summary: '本次会议无有效录音内容', key_points: [], action_items: [], isFinal: true })
      return
    }
    var fsp = 'You are a professional meeting minutes assistant. Summarize the ENTIRE meeting transcript below into a comprehensive meeting summary.\n\nRespond with **valid JSON only**, no markdown fences, no extra text:\n{\n  \"summary\": \"Comprehensive meeting summary covering the overall topic and key decisions (2-3 sentences)\",\n  \"key_points\": [\"Point 1\", \"Point 2\", \"Point 3\", \"Point 4\", \"Point 5\"],\n  \"action_items\": [\"Action 1\", \"Action 2\", \"Action 3\"]\n}'
    var noteData
    if (apiKey) {
      try { noteData = await callDeepSeek(fsp, fullText) } catch (error) {
        console.error('[meeting-notes] Final summary failed: ' + error.message)
        noteData = { summary: '(完整摘要生成失败)', key_points: ['(API调用失败)'], action_items: [] }
      }
    } else {
      noteData = { summary: '会议讨论了 ' + String(state.notes.length) + ' 个话题', key_points: ['Demo模式'], action_items: ['复盘会议内容'] }
    }
    state.notes.unshift({ id: 'final-' + generateId(), timestamp: new Date().toISOString(), summary: noteData.summary || '(无摘要)', key_points: Array.isArray(noteData.key_points) ? noteData.key_points : [], action_items: Array.isArray(noteData.action_items) ? noteData.action_items : [], isFinal: true })
  }

  harness.handle('meeting-notes:start', async function() {
    if (state.status === 'running') return getSerializableState()
    state.status = 'running'; state.startTime = new Date().toISOString()
    state.transcriptBuffer = ''; state.speakingTurns = 0
    if (state.totalDuration === 0) { state.notes = []; state.fullTranscript = ''; state.hasFinalSummary = false }
    startSummarizer()
    return getSerializableState()
  })
  harness.handle('meeting-notes:pause', async function() {
    if (state.status !== 'running') return getSerializableState()
    state.status = 'paused'
    if (state.startTime) { state.totalDuration += Math.floor((Date.now() - new Date(state.startTime).getTime()) / 1000); state.startTime = null }
    stopSummarizer()
    return getSerializableState()
  })
  harness.handle('meeting-notes:resume', async function() {
    if (state.status !== 'paused') return getSerializableState()
    state.status = 'running'; state.startTime = new Date().toISOString()
    startSummarizer()
    return getSerializableState()
  })
  harness.handle('meeting-notes:stop', async function() {
    var wasRunning = state.status === 'running' || state.status === 'paused'
    state.status = 'stopped'
    if (state.startTime) { state.totalDuration += Math.floor((Date.now() - new Date(state.startTime).getTime()) / 1000); state.startTime = null }
    stopSummarizer()
    if (wasRunning && state.fullTranscript.trim().length > 0) { await generateFinalSummary() }
    return getSerializableState()
  })
  harness.handle('meeting-notes:add-transcript', async function(args) {
    var text = (args && args.text) || ''
    if (!text) return { ok: false }
    if (state.status === 'running') { state.transcriptBuffer += text + ' '; state.fullTranscript += text + ' ' }
    return { ok: true }
  })
  harness.handle('meeting-notes:get-notes', async function() {
    return state.notes.map(function(n) { return { id: n.id, timestamp: n.timestamp, summary: n.summary, key_points: n.key_points, action_items: n.action_items, isFinal: !!n.isFinal } })
  })
  harness.handle('meeting-notes:get-status', async function() { return getSerializableState() })

  ctx.effect(function() { return function() { stopSummarizer(); state.status = 'stopped'; state.startTime = null } }, 'meeting-notes: cleanup')
  console.log('[meeting-notes] Plugin loaded. API key configured:', !!apiKey)
}