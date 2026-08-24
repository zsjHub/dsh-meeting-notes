export const name = 'dsh-meeting-notes'
export const inject = ['timer', 'llm']

export function apply(ctx) {
  var settings = ctx.get('settings')
  var cfg = ctx.get('config') || {}

  // Step 1: Register in Settings → Models
  try {
    var providerHandle = ctx.llm.registerConfigurableProviders([
      { provider: 'meeting-notes', displayName: '会议听记', settingsNs: 'meeting-notes', settingsPath: [] },
    ])
    ctx.effect(function() { return function() { providerHandle() } }, 'meeting-notes: configurable provider')
  } catch (e) {
    console.warn('[meeting-notes] Failed to register in Settings → Models:', e.message)
  }

  // Step 2: Read config
  var savedCfg = settings && settings.get('meeting-notes')
  var apiKey = (savedCfg && savedCfg.apiKey) || cfg.apiKey || ''
  if (!apiKey) {
    try { apiKey = (typeof process !== 'undefined' && process.env && process.env.DEEPSEEK_API_KEY) || '' } catch (e) {}
  }
  var apiBaseUrl = cfg.apiBaseUrl || 'https://api.deepseek.com'
  var model = cfg.model || 'deepseek-chat'

  var pendingTranscript = ''

  // Step 3: Listen for settings/updated events from client
  // Client writes transcript data to settings, host triggers summarization
  if (settings && typeof settings.on === 'function') {
    ctx.on('settings/updated', function(ns) {
      if (String(ns) !== 'meeting-notes') return
      // Settings updated by client - check for pending work
      var data = settings.get('meeting-notes')
      if (!data || typeof data !== 'object') return
      
      // Handle save-config command
      if (data._command === 'save-config' && data.apiKey) {
        apiKey = data.apiKey
        console.log('[meeting-notes] API key updated via settings')
        return
      }

      // Handle transcript data for summarization
      if (data._transcript && data._transcript.length > 10) {
        pendingTranscript = data._transcript
        runSummarization()
      }
    })
  }

  // Step 4: AI summarization
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
    if (!data.choices || !data.choices[0] || !data.choices[0].message) throw new Error('Invalid API response: ' + JSON.stringify(data))
    var content = data.choices[0].message.content
    var cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    return JSON.parse(cleaned)
  }

  function generateDemoSummary(fullText) {
    var sentences = fullText.split(/[。！？\n]/).filter(function(s) { return s.trim().length > 5 })
    var maxPoints = Math.min(5, Math.max(2, Math.ceil(sentences.length / 3)))
    var keyPoints = sentences.slice(0, maxPoints).map(function(s) { return s.trim().replace(/^[，、\s]+/, '') })
    return { summary: '会议主要讨论了' + (sentences[0] || '相关议题') + '。' + (sentences.length > 1 ? '其中涉及' + sentences.length + '个关键话题。' : ''), key_points: keyPoints.length > 0 ? keyPoints : ['会议内容待进一步分析'], action_items: [] }
  }

  async function runSummarization() {
    if (!pendingTranscript || pendingTranscript.trim().length < 10) return
    var fullText = pendingTranscript
    pendingTranscript = ''

    var fsp = 'You are a professional meeting minutes assistant. Summarize the ENTIRE meeting transcript below into a comprehensive meeting summary.\n\nRespond with **valid JSON only**, no markdown fences, no extra text:\n{\n  "summary": "Comprehensive meeting summary covering the overall topic and key decisions (2-3 sentences)",\n  "key_points": ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5"],\n  "action_items": ["Action 1", "Action 2", "Action 3"]\n}'
    var noteData
    if (apiKey) {
      try { noteData = await callDeepSeek(fsp, fullText) } catch (error) {
        console.error('[meeting-notes] Final summary failed: ' + error.message)
        noteData = { summary: '(完整摘要生成失败)', key_points: ['(API调用失败)'], action_items: [] }
      }
    } else {
      noteData = generateDemoSummary(fullText)
    }

    if (settings && typeof settings.update === 'function') {
      try {
        var existing = settings.get('meeting-notes') || {}
        var notes = Array.isArray(existing._notes) ? existing._notes : []
        notes.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), timestamp: Date.now(), summary: noteData.summary, key_points: noteData.key_points, action_items: noteData.action_items, isFinal: true })
        await settings.update('meeting-notes', { _notes: notes })
        console.log('[meeting-notes] Summary saved to settings')
      } catch (e) {
        console.warn('[meeting-notes] Failed to save summary:', e.message)
      }
    }
  }

  ctx.effect(function() { return function() { console.log('[meeting-notes] Cleanup') } }, 'meeting-notes: cleanup')
  console.log('[meeting-notes] Plugin loaded. API key configured:', !!apiKey)
}