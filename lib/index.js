export const name = 'dsh-meeting-notes'
export const inject = ['timer']

export function apply(ctx) {
  var cfg = ctx.get('config') || {}
  var apiKey = ''
  var apiBaseUrl = 'https://api.deepseek.com'
  var model = 'deepseek-chat'
  var llm = ctx.get('llm')

  // ── Register a configurable provider for Settings → Models ──
  var providerHandle = null
  var syncing = false

  function resolveSourceProvider() {
    try {
      var providers = llm.listConfigurableProviders()
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
        providerHandle = llm.registerConfigurableProviders(entries)
      }

      refreshApiConfig()
    } catch (e) {
      console.warn('[meeting-notes] Failed to register in Settings → Models:', e.message)
    } finally {
      syncing = false
    }
  }

  syncModelsDirectory()
  ctx.on('llm/adapters-updated', function() { syncModelsDirectory() })

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

  ctx.on('settings/updated', function(ns) {
    var source = resolveSourceProvider()
    if (source && String(ns) === source.settingsNs) {
      refreshApiConfig()
    }
  })

  // ── Register a custom LLM adapter for summarization ──
  // The client-side code calls llm.stream({ model: 'meeting-notes-summarize', messages: [...] })
  try {
    llm.registerAdapter({
      name: 'meeting-notes-summarize',
      model: 'meeting-notes-summarize',
      stream: async function(messages, options) {
        if (!apiKey) {
          // No API key, return a demo summary
          var transcript = ''
          for (var i = 0; i < messages.length; i++) {
            if (messages[i].role === 'user') {
              transcript = messages[i].content
              break
            }
          }
          var result = generateDemoSummary(transcript)
          return [{
            role: 'assistant',
            content: JSON.stringify(result)
          }]
        }

        var url = apiBaseUrl.replace(/\/+$/, '') + '/v1/chat/completions'
        var response = await fetch(url, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: model,
            messages: messages,
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
        return [data.choices[0].message]
      }
    })
    console.log('[meeting-notes] LLM adapter registered')
  } catch (e) {
    console.warn('[meeting-notes] Failed to register LLM adapter:', e.message)
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