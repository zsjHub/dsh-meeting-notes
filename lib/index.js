export const name = 'dsh-meeting-notes'
export const inject = ['timer', 'llm']

export function apply(ctx) {
  var settings = ctx.get('settings')
  var cfg = ctx.get('config') || {}

  // Register in Settings → Models
  // Follow the vision-router pattern:
  // 1. registerConfigurableProviders() itself handles cleanup via LlmRuntime's fiber
  // 2. Store the handle in a closure for explicit cleanup on plugin stop
  // 3. ctx.effect cleanup only runs when the plugin is stopped, NOT on apply() fiber dispose
  var providerHandle = null
  var syncing = false
  var disposed = false

  function syncModelsDirectory() {
    if (disposed || syncing) return
    syncing = true
    try {
      var entries = [{ provider: 'meeting-notes', displayName: '会议听记', settingsNs: 'meeting-notes', settingsPath: [] }]
      if (providerHandle) {
        providerHandle.replace(entries)
      } else {
        providerHandle = ctx.llm.registerConfigurableProviders(entries)
      }
    } catch (e) {
      console.warn('[meeting-notes] Failed to register in Settings → Models:', e.message)
    } finally {
      syncing = false
    }
  }

  // Initial sync
  syncModelsDirectory()

  // Re-sync on adapter updates (like vision-router does)
  ctx.on('llm/adapters-updated', function() { syncModelsDirectory() })

  // Read config
  var savedCfg = settings && settings.get('meeting-notes')
  var apiKey = (savedCfg && savedCfg.apiKey) || cfg.apiKey || ''
  if (!apiKey) {
    try { apiKey = (typeof process !== 'undefined' && process.env && process.env.DEEPSEEK_API_KEY) || '' } catch (e) {}
  }
  var apiBaseUrl = cfg.apiBaseUrl || 'https://api.deepseek.com'
  var model = cfg.model || 'deepseek-chat'
  var summarizationInterval = (cfg.summarizationInterval || 15) * 1000

  var transcriptBuffer = ''
  var lastSummarizedAt = 0
  var summarizerTimer = null

  function stopSummarizer() { if (summarizerTimer) { summarizerTimer(); summarizerTimer = null } }

  function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }

  function getNotes() {
    if (!settings || typeof settings.get !== 'function') return []
    try {
      var data = settings.get('meeting-notes')
      return (data && Array.isArray(data._notes)) ? data._notes : []
    } catch (e) { return [] }
  }

  function saveNotes(notes) {
    if (!settings || typeof settings.update !== 'function') return
    try {
      var existing = settings.get('meeting-notes') || {}
      existing._notes = notes
      settings.update('meeting-notes', existing)
    } catch (e) {}
  }

  function appendNote(note) {
    var notes = getNotes()
    notes.push(note)
    saveNotes(notes)
  }

  // Listen for settings updates from client
  if (settings && typeof settings.on === 'function') {
    settings.on('updated', function(ns) {
      if (String(ns) !== 'meeting-notes') return
      try {
        var data = settings.get('meeting-notes')
        if (!data || typeof data !== 'object') return

        // Handle save-config command
        if (data._command === 'save-config' && data.apiKey) {
          apiKey = data.apiKey
          console.log('[meeting-notes] API key updated via settings')
          return
        }

        // Handle transcript data
        if (data._transcript && typeof data._transcript === 'string' && data._transcript.length > 0) {
          transcriptBuffer += data._transcript + ' '
          if (transcriptBuffer.trim().length >= 30 && Date.now() - lastSummarizedAt >= summarizationInterval) {
            runSummarization(false)
          }
        }

        // Handle final summary request
        if (data._finalTranscript && typeof data._finalTranscript === 'string' && data._finalTranscript.length > 10) {
          transcriptBuffer = data._finalTranscript
          runSummarization(true)
        }
      } catch (e) {
        console.warn('[meeting-notes] Error handling settings update:', e.message)
      }
    })
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

  async function runSummarization(isFinal) {
    if (!transcriptBuffer || transcriptBuffer.trim().length < 10) return
    var fullText = transcriptBuffer

    if (isFinal) {
      transcriptBuffer = ''
    } else {
      transcriptBuffer = ''
    }

    var fsp = 'You are a professional meeting minutes assistant. Summarize the meeting transcript below into a structured summary.\n\nRespond with **valid JSON only**, no markdown fences, no extra text:\n{\n  "summary": "One-sentence summary of the core topic (max 30 characters)",\n  "key_points": ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5"],\n  "action_items": ["Action 1", "Action 2", "Action 3"]\n}'

    var noteData
    if (apiKey) {
      try { noteData = await callDeepSeek(fsp, fullText) } catch (error) {
        console.error('[meeting-notes] Summary failed: ' + error.message)
        if (isFinal) {
          noteData = { summary: '(完整摘要生成失败)', key_points: ['(API调用失败)'], action_items: [] }
        } else {
          return
        }
      }
    } else {
      noteData = generateDemoSummary(fullText)
    }

    var note = {
      id: generateId(),
      timestamp: Date.now(),
      summary: noteData.summary || '',
      key_points: Array.isArray(noteData.key_points) ? noteData.key_points : [],
      action_items: Array.isArray(noteData.action_items) ? noteData.action_items : [],
      isFinal: isFinal || false,
    }

    if (isFinal) {
      var notes = getNotes()
      notes.unshift(note)
      saveNotes(notes)
    } else {
      appendNote(note)
    }

    lastSummarizedAt = Date.now()
    console.log('[meeting-notes] Summary added: ' + (isFinal ? 'final' : 'periodic') + ' (' + note.key_points.length + ' points, ' + note.action_items.length + ' actions)')
  }

  ctx.effect(function() {
    return function() {
      disposed = true
      if (providerHandle) {
        try { providerHandle() } catch (e) {}
        providerHandle = null
      }
      stopSummarizer()
      console.log('[meeting-notes] Cleanup')
    }
  }, 'meeting-notes: cleanup')
  console.log('[meeting-notes] Plugin loaded. API key configured:', !!apiKey)
}