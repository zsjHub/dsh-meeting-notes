window.__ModuleLoader__.load({
  id: 'dsh-meeting-notes',
  factory: function(require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')

    exports.name = 'dsh-meeting-notes-client'
    exports.inject = ['timer']

    exports.apply = function(ctx) {
      var slots = ctx.get('slots')
      if (!slots) { console.warn('[meeting-notes] Slots not available'); return }

      var C = {
        primary: '#1a73e8', primaryLight: '#e8f0fe',
        success: '#34a853', successLight: '#e6f4ea',
        warning: '#fbbc04', warningLight: '#fef7e0',
        danger: '#ea4335', dangerLight: '#fce8e6',
        orange: '#ff6d01', orangeLight: '#fef3e8',
        bg: '#f8f9fa', card: '#ffffff',
        text: '#202124', textSecondary: '#5f6368',
        border: '#e0e0e0', shadow: 'rgba(0,0,0,0.08)',
        transcriptBg: '#f0f4f8',
      }

      try { styles.insert('@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}') } catch (e) {}

      // Timer state - managed entirely client-side
      var timerInterval = null
      var timerSeconds = 0
      var recordingStatus = 'idle' // idle | running | paused | stopped
      var fullTranscript = ''

      function createASR() {
        var recognition = null
        var isActive = false
        var transcriptHandler = null

        // Check if SpeechRecognition is available
        var SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition
        var isSupported = !!SpeechRecognitionClass

        return {
          get isSupported() { return isSupported },
          get isActive() { return isActive },
          start: function(lang) {
            return new Promise(function(resolve) {
              if (!isSupported) { isActive = false; resolve(false); return }
              try {
                recognition = new SpeechRecognitionClass()
                recognition.lang = lang || 'zh-CN'
                recognition.continuous = true
                recognition.interimResults = true
                recognition.maxAlternatives = 1

                recognition.onresult = function(event) {
                  if (!transcriptHandler) return
                  for (var i = event.resultIndex; i < event.results.length; i++) {
                    var result = event.results[i]
                    transcriptHandler({ text: result[0].transcript, isFinal: result.isFinal })
                  }
                }

                recognition.onerror = function(event) {
                  console.warn('[meeting-notes] ASR error:', event.error)
                  if (event.error === 'not-allowed') { isActive = false; resolve(false) }
                }

                recognition.onend = function() {
                  if (isActive) {
                    try { recognition.start() } catch (e) { isActive = false }
                  }
                }

                recognition.start()
                isActive = true
                resolve(true)
              } catch (error) {
                console.error('[meeting-notes] ASR start failed:', error.message)
                isActive = false
                resolve(false)
              }
            })
          },
          stop: function() {
            if (recognition) {
              try { recognition.stop() } catch {}
              try { recognition.abort() } catch {}
              recognition = null
            }
            isActive = false
          },
          onTranscript: function(handler) { transcriptHandler = handler },
        }
      }

      function formatTime(seconds) {
        var h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60)
        if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
        return m + ':' + String(s).padStart(2, '0')
      }

      function MeetingNotesApp() {
        var _a = React.useState('idle'), status = _a[0], setStatus = _a[1]
        var _b = React.useState(0), elapsed = _b[0], setElapsed = _b[1]
        var _c = React.useState(''), liveTranscript = _c[0], setLiveTranscript = _c[1]
        var _d = React.useState(''), interimText = _d[0], setInterimText = _d[1]
        var asrRef = React.useRef(null)

        React.useEffect(function() {
          asrRef.current = createASR()
          return function() {
            if (asrRef.current) asrRef.current.stop()
            if (timerInterval) { clearInterval(timerInterval); timerInterval = null }
          }
        }, [])

        function startTimer() {
          timerSeconds = 0
          setElapsed(0)
          if (timerInterval) clearInterval(timerInterval)
          timerInterval = setInterval(function() {
            timerSeconds++
            setElapsed(timerSeconds)
          }, 1000)
        }

        function stopTimer() {
          if (timerInterval) { clearInterval(timerInterval); timerInterval = null }
        }

        async function handleStart() {
          try {
            var asr = asrRef.current
            if (!asr.isSupported) {
              console.log('[meeting-notes] ASR not available, demo mode')
            }
            var asrStarted = await asr.start('zh-CN')
            
            asr.onTranscript(function(result) {
              if (result.isFinal) {
                setLiveTranscript(function(prev) { return prev + result.text + ' ' })
                setInterimText('')
                fullTranscript += result.text + ' '
                // Save transcript to host for summarization via settings
                saveTranscriptToHost(result.text)
              } else {
                setInterimText(result.text)
              }
            })

            recordingStatus = 'running'
            setStatus('running')
            startTimer()
          } catch (error) {
            console.error('[meeting-notes] Start failed:', error.message)
            if (asrRef.current) asrRef.current.stop()
          }
        }

        function handlePause() {
          if (status === 'running') {
            asrRef.current.stop()
            recordingStatus = 'paused'
            setStatus('paused')
            stopTimer()
          } else if (status === 'paused') {
            asrRef.current.start('zh-CN')
            asrRef.current.onTranscript(function(result) {
              if (result.isFinal) {
                setLiveTranscript(function(prev) { return prev + result.text + ' ' })
                setInterimText('')
                fullTranscript += result.text + ' '
                saveTranscriptToHost(result.text)
              } else {
                setInterimText(result.text)
              }
            })
            recordingStatus = 'running'
            setStatus('running')
            startTimer()
          }
        }

        function handleStop() {
          asrRef.current.stop()
          recordingStatus = 'stopped'
          setStatus('stopped')
          stopTimer()
          // Trigger final summarization
          if (fullTranscript.trim().length > 10) {
            saveTranscriptToHost(fullTranscript, true)
          }
        }

        async function saveTranscriptToHost(text, isFinal) {
          try {
            var host = typeof host !== 'undefined' ? host : null
            if (host && typeof host.call === 'function') {
              await host.call('settings.update', {
                ns: 'meeting-notes',
                data: { _transcript: text, _isFinal: isFinal || false, _timestamp: Date.now() }
              })
            }
          } catch (e) {
            // Settings service may not be available - that's OK for demo mode
          }
        }

        // Settings page for API key
        function MeetingNotesSettings(props) {
          var _a = React.useState(''), inputKey = _a[0], setInputKey = _a[1]
          var _b = React.useState(''), savedMsg = _b[0], setSavedMsg = _b[1]

          async function handleSave() {
            if (!inputKey.trim()) return
            try {
              var host = typeof host !== 'undefined' ? host : null
              if (host && typeof host.call === 'function') {
                await host.call('settings.update', {
                  ns: 'meeting-notes',
                  data: { _command: 'save-config', apiKey: inputKey.trim() }
                })
              }
              setSavedMsg('已保存')
              setTimeout(function() { setSavedMsg('') }, 3000)
            } catch (e) {
              setSavedMsg('保存失败: ' + e.message)
            }
          }

          return React.createElement('div', { style:{ padding:'16px' } },
            React.createElement('h3', { style:{ margin:'0 0 16px 0', fontSize:'18px', color:C.text } }, '会议听记设置'),
            React.createElement('label', { style:{ display:'block', marginBottom:'8px', fontSize:'14px', color:C.textSecondary } }, 'DeepSeek API Key'),
            React.createElement('input', {
              type:'password', value:inputKey,
              onChange:function(e) { setInputKey(e.target.value) },
              placeholder:'sk-...',
              style:{ width:'100%', padding:'8px 12px', border:'1px solid ' + C.border, borderRadius:'6px', fontSize:'14px', boxSizing:'border-box' }
            }),
            React.createElement('button', {
              onClick:handleSave,
              style:{ marginTop:'12px', padding:'8px 20px', backgroundColor:C.primary, color:'#fff', border:'none', borderRadius:'6px', cursor:'pointer', fontSize:'14px' }
            }, savedMsg || '保存'),
            savedMsg ? React.createElement('span', { style:{ marginLeft:'8px', fontSize:'13px', color:C.success } }, savedMsg) : null,
            React.createElement('div', { style:{ marginTop:'24px', padding:'16px', backgroundColor:C.bg, borderRadius:'8px', fontSize:'13px', color:C.textSecondary, lineHeight:'1.6' } },
              React.createElement('div', { style:{ fontWeight:'600', marginBottom:'8px', color:C.text } }, '配置说明'),
              React.createElement('div', null, '会议听记插件支持三种方式配置 API Key（优先级从高到低）：'),
              React.createElement('ol', { style:{ paddingLeft:'20px', marginTop:'6px' } },
                React.createElement('li', null, '在此页面输入并保存'),
                React.createElement('li', null, '在 cordis.yml 中配置 config.apiKey'),
                React.createElement('li', null, '设置环境变量 DEEPSEEK_API_KEY')
              ),
              React.createElement('div', { style:{ marginTop:'8px', color:C.warning } }, '注意：通过此页面保存的 API Key 仅在当前会话有效，重启后需重新设置。')
            )
          )
        }

        var statusColors = { idle: C.textSecondary, running: C.success, paused: C.warning, stopped: C.textSecondary }
        var statusLabels = { idle: '就绪', running: '录音中', paused: '已暂停', stopped: '已停止' }
        var btnStyle = { padding:'8px 16px', border:'none', borderRadius:'6px', cursor:'pointer', fontSize:'14px', fontWeight:'500', margin:'0 4px' }

        return React.createElement('div', { style:{ padding:'16px', backgroundColor:C.card, borderRadius:'12px', boxShadow:'0 1px 3px ' + C.shadow, marginBottom:'12px', animation:'fadeIn 0.3s ease' } },
          // Header
          React.createElement('div', { style:{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'12px' } },
            React.createElement('div', { style:{ display:'flex', alignItems:'center', gap:'8px' } },
              React.createElement('span', { style:{ fontSize:'16px' } }, '🎙'),
              React.createElement('span', { style:{ fontSize:'16px', fontWeight:'600', color:C.text } }, '会议听记')
            ),
            React.createElement('div', { style:{ display:'flex', alignItems:'center', gap:'8px' } },
              React.createElement('span', { style:{ fontSize:'14px', fontWeight:'500', color:statusColors[status] } }, statusLabels[status]),
              status === 'running' || status === 'paused'
                ? React.createElement('span', { style:{ fontSize:'14px', fontWeight:'600', color:C.text } }, formatTime(elapsed))
                : null
            )
          ),
          // Control buttons
          React.createElement('div', { style:{ display:'flex', gap:'8px', marginBottom:'12px' } },
            status === 'idle' || status === 'stopped'
              ? React.createElement('button', { onClick:handleStart, style:Object.assign({}, btnStyle, { backgroundColor:C.success, color:'#fff' }) }, '开始听记')
              : null,
            status === 'running'
              ? React.createElement('button', { onClick:handlePause, style:Object.assign({}, btnStyle, { backgroundColor:C.warning, color:'#fff' }) }, '暂停')
              : null,
            status === 'paused'
              ? React.createElement('button', { onClick:handlePause, style:Object.assign({}, btnStyle, { backgroundColor:C.success, color:'#fff' }) }, '继续')
              : null,
            (status === 'running' || status === 'paused')
              ? React.createElement('button', { onClick:handleStop, style:Object.assign({}, btnStyle, { backgroundColor:C.danger, color:'#fff' }) }, '停止')
              : null
          ),
          // Live transcript
          (liveTranscript || interimText)
            ? React.createElement('div', { style:{ padding:'12px', backgroundColor:C.transcriptBg, borderRadius:'8px', fontSize:'14px', lineHeight:'1.6', maxHeight:'200px', overflowY:'auto' } },
              React.createElement('div', { style:{ fontWeight:'600', marginBottom:'6px', fontSize:'13px', color:C.textSecondary } }, '实时转写'),
              React.createElement('div', { style:{ color:C.text } }, liveTranscript),
              interimText ? React.createElement('span', { style:{ color:C.textSecondary } }, interimText) : null
            )
            : null,
          // Settings button
          React.createElement('div', { style:{ marginTop:'12px', textAlign:'right' } },
            React.createElement('button', {
              onClick:function() {
                // Open settings dialog
                var dialog = document.createElement('div')
                dialog.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000'
                dialog.onclick = function(e) { if (e.target === dialog) { document.body.removeChild(dialog) } }
                var content = document.createElement('div')
                content.style.cssText = 'background:#fff;border-radius:12px;width:480px;max-width:90vw;max-height:80vh;overflow-y:auto'
                var close = document.createElement('div')
                close.style.cssText = 'text-align:right;padding:12px 16px 0'
                close.innerHTML = '<button style="border:none;background:none;font-size:20px;cursor:pointer;color:#666">&times;</button>'
                close.onclick = function() { document.body.removeChild(dialog) }
                content.appendChild(close)
                var root = document.createElement('div')
                content.appendChild(root)
                dialog.appendChild(content)
                document.body.appendChild(dialog)
                // Render settings component into root
                React.createElement(MeetingNotesSettings, { close: function() { document.body.removeChild(dialog) } })
              },
              style:Object.assign({}, btnStyle, { backgroundColor:'transparent', color:C.primary, border:'1px solid ' + C.primary })
            }, '设置 API Key')
          )
        )
      }

      // Register in conversation.view slot
      slots.inject('conversation.view', function() { return slots.register({ name:'conversation.view', id:'meeting-notes', order:60 }, function() { return React.createElement(MeetingNotesApp) }) })
      console.log('[meeting-notes-client] UI registered in conversation.view')
    }

    return exports
  }
})