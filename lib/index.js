export const name = 'dsh-meeting-notes'
export const inject = ['timer', 'llm']

export function apply(ctx) {
  var cfg = ctx.get('config') || {}
  var apiKey = ''
  var apiBaseUrl = 'https://api.deepseek.com'
  var model = 'deepseek-chat'

  // ── Data directory: $DSH_HOME/meeting-notes/ ──
  var dataDir = ''
  try {
    var home = process.env.DSH_HOME || process.env.HOME || process.env.USERPROFILE || ''
    dataDir = home + '/.dsh/meeting-notes'
  } catch (e) {
    dataDir = './.dsh/meeting-notes'
  }

  // ── Helper: ensure directory exists ──
  var fs = ctx.get('fs')
  function ensureDir(dir) {
    if (!fs) return
    try {
      // Try to create the directory; ignore if it already exists
      fs.mkdir(dir, { recursive: true }).catch(function() {})
    } catch (e) {}
  }

  // ── Helper: read JSON file ──
  function readJSON(filePath) {
    if (!fs) return null
    try {
      var target = fs.resolve(filePath)
      var content = fs.readText(target)
      if (content === null || content === undefined) return null
      return JSON.parse(content)
    } catch (e) { return null }
  }

  // ── Helper: write JSON file ──
  function writeJSON(filePath, data) {
    if (!fs) return
    try {
      ensureDir(dataDir + '/notes')
      var target = fs.resolve(filePath)
      fs.writeText(target, JSON.stringify(data, null, 2))
    } catch (e) {}
  }

  // ── Helper: read index file ──
  function readIndex() {
    var index = readJSON(dataDir + '/index.json')
    return Array.isArray(index) ? index : []
  }

  // ── Helper: write index file ──
  function writeIndex(index) {
    writeJSON(dataDir + '/index.json', index)
  }

  // ── Helper: read note by ID ──
  function readNote(id) {
    return readJSON(dataDir + '/notes/' + id + '.json')
  }

  // ── Helper: write note by ID ──
  function writeNote(id, data) {
    writeJSON(dataDir + '/notes/' + id + '.json', data)
  }

  // ── Helper: generate ID ──
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  }

  // ── Helper: get current time string ──
  function nowISO() { return new Date().toISOString() }

  // ── Helper: format duration ──
  function formatDuration(seconds) {
    var h = Math.floor(seconds / 3600)
    var m = Math.floor((seconds % 3600) / 60)
    var s = Math.floor(seconds % 60)
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
    return m + ':' + String(s).padStart(2, '0')
  }

  // ── Register the handler for client-to-host communication ──
  try {
    harness.handle('meeting-notes', function(args) {
      var action = args && args.action
      if (!action) return { error: 'No action specified' }

      switch (action) {

        // ── list: Get all meeting notes (summary info) ──
        case 'list': {
          var index = readIndex()
          return { success: true, data: index }
        }

        // ── create: Create a new meeting note ──
        case 'create': {
          var id = generateId()
          var now = nowISO()
          var note = {
            id: id,
            title: args.title || '新听记 ' + new Date().toLocaleDateString('zh-CN'),
            date: now,
            startTime: now,
            endTime: '',
            duration: 0,
            transcript: '',
            summary: '',
            keyPoints: [],
            actionItems: [],
            status: 'recording',
          }
          writeNote(id, note)
          var index = readIndex()
          index.unshift({ id: id, title: note.title, date: now, duration: 0, status: 'recording' })
          writeIndex(index)
          return { success: true, data: note }
        }

        // ── get: Get full note by ID ──
        case 'get': {
          var note = readNote(args.id)
          if (!note) return { success: false, error: 'Note not found: ' + args.id }
          return { success: true, data: note }
        }

        // ── save: Save/update note data ──
        case 'save': {
          var existing = readNote(args.id)
          if (!existing) return { success: false, error: 'Note not found: ' + args.id }
          var updated = Object.assign({}, existing, args.data || {})
          updated.updatedAt = nowISO()
          writeNote(args.id, updated)
          // Update index
          var index = readIndex()
          for (var i = 0; i < index.length; i++) {
            if (index[i].id === args.id) {
              index[i].title = updated.title || index[i].title
              index[i].duration = updated.duration || index[i].duration
              index[i].status = updated.status || index[i].status
              break
            }
          }
          writeIndex(index)
          return { success: true, data: updated }
        }

        // ── delete: Delete a note ──
        case 'delete': {
          var index = readIndex().filter(function(n) { return n.id !== args.id })
          writeIndex(index)
          // Try to delete the note file
          try {
            if (fs) {
              var target = fs.resolve(dataDir + '/notes/' + args.id + '.json')
              fs.unlink(target).catch(function() {})
            }
          } catch (e) {}
          return { success: true }
        }

        // ── summarize: Generate AI summary for a note ──
        case 'summarize': {
          var note = readNote(args.id)
          if (!note) return { success: false, error: 'Note not found: ' + args.id }
          if (!note.transcript || note.transcript.trim().length < 10) {
            return { success: false, error: 'Transcript too short to summarize' }
          }

          // Update status to summarizing
          note.status = 'summarizing'
          note.updatedAt = nowISO()
          writeNote(args.id, note)

          var result = null
          if (apiKey) {
            try {
              result = callDeepSeekSync(note.transcript)
            } catch (e) {
              result = { summary: '(摘要生成失败: ' + e.message + ')', key_points: ['(API调用失败)'], action_items: [] }
            }
          } else {
            result = generateDemoSummary(note.transcript)
          }

          note.summary = result.summary || ''
          note.keyPoints = Array.isArray(result.key_points) ? result.key_points : []
          note.actionItems = Array.isArray(result.action_items) ? result.action_items : []
          note.status = 'completed'
          note.endTime = nowISO()
          note.updatedAt = nowISO()

          writeNote(args.id, note)

          // Update index
          var index = readIndex()
          for (var i = 0; i < index.length; i++) {
            if (index[i].id === args.id) {
              index[i].status = 'completed'
              index[i].duration = note.duration || index[i].duration
              break
            }
          }
          writeIndex(index)

          return { success: true, data: note }
        }

        default:
          return { error: 'Unknown action: ' + action }
      }
    })
    console.log('[meeting-notes] Handler registered for "meeting-notes"')
  } catch (e) {
    console.warn('[meeting-notes] Failed to register handler:', e.message)
  }

  // ── Register a configurable provider for Settings → Models ──
  // The UI hides entries whose settingsNs is not a registered settings namespace.
  var providerHandle = null
  var syncing = false

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
    if (syncing) return
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

  // ── Read API key from the source provider's settings namespace ──
  function refreshApiConfig() {
    var source = resolveSourceProvider()
    if (!source) return
    try {
      var settings = ctx.get('settings')
      if (!settings) return
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

  // Listen for changes to the source provider's settings (API key may change)
  ctx.on('settings/updated', function(ns) {
    var source = resolveSourceProvider()
    if (source && String(ns) === source.settingsNs) {
      refreshApiConfig()
    }
  })

  // ── AI Summarization ──
  async function callDeepSeek(systemPrompt, transcript) {
    var url = apiBaseUrl.replace(/\/+$/, '') + '/v1/chat/completions'
    var response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: transcript }],
        temperature: 0.3,
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) {
      var errorText = await response.text().catch(function() { return 'Unknown error' })
      throw new Error('DeepSeek API error ' + response.status + ': ' + errorText)
    }
    var data = await response.json()
    if (!data.choices || !data.choices[0] || !data.choices[0].message) throw new Error('Invalid API response: ' + JSON.stringify(data))
    var content = data.choices[0].message.content
    var cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    return JSON.parse(cleaned)
  }

  // Synchronous wrapper for harness.handle (which returns a Promise)
  async function callDeepSeekSync(transcript) {
    var fsp = 'You are a professional meeting minutes assistant. Summarize the meeting transcript below into a structured summary.\n\nRespond with **valid JSON only**, no markdown fences, no extra text:\n{\n  "summary": "One-sentence summary of the core topic (max 30 characters)",\n  "key_points": ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5"],\n  "action_items": ["Action 1", "Action 2", "Action 3"]\n}'
    return await callDeepSeek(fsp, transcript)
  }

  function generateDemoSummary(fullText) {
    var sentences = fullText.split(/[。！？\n]/).filter(function(s) { return s.trim().length > 5 })
    var maxPoints = Math.min(5, Math.max(2, Math.ceil(sentences.length / 3)))
    var keyPoints = sentences.slice(0, maxPoints).map(function(s) { return s.trim().replace(/^[，、\s]+/, '') })
    return {
      summary: '会议主要讨论了' + (sentences[0] || '相关议题') + '。' + (sentences.length > 1 ? '其中涉及' + sentences.length + '个关键话题。' : ''),
      key_points: keyPoints.length > 0 ? keyPoints : ['会议内容待进一步分析'],
      action_items: []
    }
  }

  // ── Cleanup ──
  ctx.effect(function() {
    return function() {
      if (providerHandle) { try { providerHandle() } catch (e) {}; providerHandle = null }
      console.log('[meeting-notes] Cleanup')
    }
  }, 'meeting-notes: cleanup')
  console.log('[meeting-notes] Plugin loaded. API key configured:', !!apiKey)
}