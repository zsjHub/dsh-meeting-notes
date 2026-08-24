export const name = 'dsh-meeting-notes'
export const inject = ['timer', 'llm']

export function apply(ctx) {
  var settings = ctx.get('settings')
  var cfg = ctx.get('config') || {}

  // ── Step 1: Register the meeting-notes namespace with a schema ──
  // CRITICAL: settings.update() throws if the namespace is not registered
  // (see SettingsProvider.write line 587: "settings namespace is not registered").
  // settings.get() also returns undefined for unregistered namespaces.
  // We create a simple catch-all schema function (no @deepseek-ai/schemastery
  // dependency needed - it's a type-only import in the settings source).
  var meetingNotesScope = null
  try {
    // Check if already registered (e.g. after a reload)
    var existing = settings.get('meeting-notes')
    if (existing !== undefined) {
      // Namespace is already registered; create a scope-compatible wrapper
      meetingNotesScope = {
        get: function() { return settings.get('meeting-notes') },
        update: function(patch) { return settings.update('meeting-notes', patch) },
        replace: function(section) { return settings.replace('meeting-notes', section) },
      }
    } else {
      var catchAllSchema = Object.assign(function(value) { return value !== undefined ? value : {} }, { toJSON: function() { return {} } })
      meetingNotesScope = settings.register('meeting-notes', catchAllSchema)
    }
  } catch (e) {
    console.warn('[meeting-notes] Failed to register namespace:', e.message)
  }

  // ── Step 2: Register a wrapper adapter (like vision-router's deepseek-vision) ──
  // This makes the provider appear in llm.listProviders(), which is required
  // for the Settings → Models page to link the entry.
  var adapterHandle = null
  try {
    adapterHandle = ctx.llm.registerAdapter(['meeting-notes'], {
      providerInfo: function(provider) {
        return { id: provider, name: '会议听记' }
      },
      listModels: async function() {
        return []
      },
      resolveModel: async function(provider, model) {
        throw new Error('meeting-notes adapter does not serve models directly')
      },
      prepareModel: async function(provider, model, config) {
        throw new Error('meeting-notes adapter does not serve models directly')
      },
      stream: async function*(provider, model, options) {
        throw new Error('meeting-notes adapter does not serve models directly')
      },
    })
  } catch (e) {
    console.warn('[meeting-notes] Failed to register adapter:', e.message)
  }

  // ── Step 2: Register in Settings → Models (follow vision-router pattern) ──
  // The UI hides entries whose settingsNs is not a registered settings namespace.
  // So we must discover the first available configurable provider and copy its
  // settingsNs and settingsPath (same approach as vision-router's wrapper-directory.js).
  var providerHandle = null
  var syncing = false
  var disposed = false

  function resolveSourceProvider() {
    try {
      var providers = ctx.llm.listConfigurableProviders()
      if (!Array.isArray(providers)) return null
      for (var i = 0; i < providers.length; i++) {
        var entry = providers[i]
        if (entry && typeof entry.settingsNs === 'string' && entry.settingsNs !== '') {
          return entry
        }
      }
    } catch (e) {}
    return null
  }

  function syncModelsDirectory() {
    if (disposed || syncing) return
    syncing = true
    try {
      var source = resolveSourceProvider()
      if (!source) {
        console.warn('[meeting-notes] No configurable provider with settingsNs found, deferring...')
        return
      }

      var entries = [{
        provider: 'meeting-notes',
        displayName: '会议听记',
        settingsNs: source.settingsNs,
        settingsPath: Array.isArray(source.settingsPath) ? [...source.settingsPath] : [],
      }]

      if (providerHandle) {
        providerHandle.replace(entries)
      } else {
        providerHandle = ctx.llm.registerConfigurableProviders(entries)
      }

      // Refresh API config now that we have a source provider
      refreshApiConfig()
    } catch (e) {
      console.warn('[meeting-notes] Failed to register in Settings → Models:', e.message)
    } finally {
      syncing = false
    }
  }

  syncModelsDirectory()
  ctx.on('llm/adapters-updated', function() { syncModelsDirectory() })

  // ── Step 3: Read API key from the source provider's settings namespace ──
  var apiKey = ''
  var apiBaseUrl = 'https://api.deepseek.com'
  var model = 'deepseek-chat'
  var summarizationInterval = (cfg.summarizationInterval || 15) * 1000

  function refreshApiConfig() {
    var source = resolveSourceProvider()
    if (!source) return
    try {
      var sourceSettings = settings && settings.get(source.settingsNs)
      if (sourceSettings && typeof sourceSettings === 'object') {
        apiKey = sourceSettings.apiKey || sourceSettings.api_key || ''
        if (sourceSettings.baseUrl) apiBaseUrl = sourceSettings.baseUrl
        if (sourceSettings.model) model = sourceSettings.model
      }
    } catch (e) {
      console.warn('[meeting-notes] Failed to read API config:', e.message)
    }
    console.log('[meeting-notes] API key configured:', !!apiKey)
  }
  refreshApiConfig()

  var transcriptBuffer = ''
  var lastSummarizedAt = 0
  var summarizerTimer = null

  function stopSummarizer() { if (summarizerTimer) { summarizerTimer(); summarizerTimer = null } }

  function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }

  function getNotes() {
    if (!meetingNotesScope || typeof meetingNotesScope.get !== 'function') return []
    try {
      var data = meetingNotesScope.get()
      return (data && Array.isArray(data._notes)) ? data._notes : []
    } catch (e) { return [] }
  }

  function saveNotes(notes) {
    if (!meetingNotesScope || typeof meetingNotesScope.update !== 'function') return
    try {
      meetingNotesScope.update({ _notes: notes })
    } catch (e) {}
  }

  function appendNote(note) {
    var notes = getNotes()
    notes.push(note)
    saveNotes(notes)
  }

  // ── Step 4: Listen for settings updates from client ──
  // Use the registered scope's watch() method for reliable change detection.
  // This is called directly when the namespace's resolved value changes.
  // Fallback to ctx.on('settings/updated', ...) if watch() is not available.
  var watchDisposer = null
  if (meetingNotesScope && typeof meetingNotesScope.watch === 'function') {
    watchDisposer = meetingNotesScope.watch(function(next, prev) {
      try {
        if (next._transcript && typeof next._transcript === 'string' && next._transcript.length > 0) {
          transcriptBuffer += next._transcript + ' '
          if (transcriptBuffer.trim().length >= 30 && Date.now() - lastSummarizedAt >= summarizationInterval) {
            runSummarization(false)
          }
        }

        if (next._finalTranscript && typeof next._finalTranscript === 'string' && next._finalTranscript.length > 10) {
          transcriptBuffer = next._finalTranscript
          runSummarization(true)
        }
      } catch (e) {
        console.warn('[meeting-notes] Error handling settings update:', e.message)
      }
    })
  } else {
    // Fallback: use ctx.on('settings/updated', ...) which works for registered namespaces
    ctx.on('settings/updated', function(ns) {
      if (String(ns) !== 'meeting-notes') return
      try {
        var data = settings.get('meeting-notes')
        if (!data || typeof data !== 'object') return

        if (data._transcript && typeof data._transcript === 'string' && data._transcript.length > 0) {
          transcriptBuffer += data._transcript + ' '
          if (transcriptBuffer.trim().length >= 30 && Date.now() - lastSummarizedAt >= summarizationInterval) {
            runSummarization(false)
          }
        }

        if (data._finalTranscript && typeof data._finalTranscript === 'string' && data._finalTranscript.length > 10) {
          transcriptBuffer = data._finalTranscript
          runSummarization(true)
        }
      } catch (e) {
        console.warn('[meeting-notes] Error handling settings update:', e.message)
      }
    })
  }

  // Also listen for changes to the source provider's settings (API key may change)
  ctx.on('settings/updated', function(ns) {
    var source = resolveSourceProvider()
    if (source && String(ns) === source.settingsNs) {
      refreshApiConfig()
    }
  })

  // ── Step 5: AI Summarization ──
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
    transcriptBuffer = ''

    var fsp = 'You are a professional meeting minutes assistant. Summarize the meeting transcript below into a structured summary.\n\nRespond with **valid JSON only**, no markdown fences, no extra text:\n{\n  "summary": "One-sentence summary of the core topic (max 30 characters)",\n  "key_points": ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5"],\n  "action_items": ["Action 1", "Action 2", "Action 3"]\n}'

    var noteData
    if (apiKey) {
      try { noteData = await callDeepSeek(fsp, fullText) } catch (error) {
        console.error('[meeting-notes] Summary failed: ' + error.message)
        if (isFinal) {
          noteData = { summary: '(完整摘要生成失败)', key_points: ['(API调用失败)'], action_items: [] }
        } else { return }
      }
    } else {
      noteData = generateDemoSummary(fullText)
    }

    var note = {
      id: generateId(), timestamp: Date.now(),
      summary: noteData.summary || '',
      key_points: Array.isArray(noteData.key_points) ? noteData.key_points : [],
      action_items: Array.isArray(noteData.action_items) ? noteData.action_items : [],
      isFinal: isFinal || false,
    }

    if (isFinal) { var notes = getNotes(); notes.unshift(note); saveNotes(notes) }
    else { appendNote(note) }

    lastSummarizedAt = Date.now()
    console.log('[meeting-notes] Summary added: ' + (isFinal ? 'final' : 'periodic') + ' (' + note.key_points.length + ' points, ' + note.action_items.length + ' actions)')
  }

  // ── Cleanup ──
  ctx.effect(function() {
    return function() {
      disposed = true
      if (providerHandle) { try { providerHandle() } catch (e) {}; providerHandle = null }
      if (adapterHandle) { try { adapterHandle() } catch (e) {}; adapterHandle = null }
      if (watchDisposer) { try { watchDisposer() } catch (e) {}; watchDisposer = null }
      stopSummarizer()
      console.log('[meeting-notes] Cleanup')
    }
  }, 'meeting-notes: cleanup')
  console.log('[meeting-notes] Plugin loaded. API key configured:', !!apiKey)
}