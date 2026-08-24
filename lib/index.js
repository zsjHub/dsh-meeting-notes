export const name = 'dsh-meeting-notes'
export const inject = ['timer']

export function apply(ctx) {
  var cfg = ctx.get('config') || {}
  var apiKey = ''
  var apiBaseUrl = 'https://api.deepseek.com'
  var model = 'deepseek-chat'
  var llm = ctx.get('llm')

  // ── Register a custom LLM adapter for summarization ──
  // The client-side code calls llm.stream({ model: 'meeting-notes-summarize', messages: [...] })
  if (llm && typeof llm.registerAdapter === 'function') {
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
  } else {
    console.log('[meeting-notes] LLM service not available, summaries will use demo mode')
  }

  // ── Try to read API key from config ──
  if (cfg && typeof cfg === 'object') {
    apiKey = cfg.apiKey || cfg.api_key || ''
    if (cfg.baseUrl) apiBaseUrl = cfg.baseUrl
    if (cfg.model) model = cfg.model
  }
  console.log('[meeting-notes] Plugin loaded. API key configured:', !!apiKey)

  // ── Cleanup ──
  ctx.effect(function() {
    return function() {
      console.log('[meeting-notes] Cleanup')
    }
  }, 'meeting-notes: cleanup')

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
}