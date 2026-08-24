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

      var settings = ctx.get('settings')

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

      // Global state
      var timerInterval = null
      var timerSeconds = 0
      var recordingStatus = 'idle'
      var fullTranscript = ''
      var speakingTurns = 0
      var notesCache = []
      var pollingInterval = null

      function createASR() {
        var recognition = null
        var isActive = false
        var transcriptHandler = null
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
                  if (isActive) { try { recognition.start() } catch (e) { isActive = false } }
                }
                recognition.start()
                isActive = true
                resolve(true)
              } catch (error) {
                console.error('[meeting-notes] ASR start failed:', error.message)
                isActive = false; resolve(false)
              }
            })
          },
          stop: function() {
            if (recognition) { try { recognition.stop() } catch {} try { recognition.abort() } catch {} recognition = null }
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

      function loadNotesFromSettings() {
        if (!settings || typeof settings.get !== 'function') return
        try {
          var data = settings.get('meeting-notes')
          if (data && Array.isArray(data._notes)) {
            notesCache = data._notes
          }
        } catch (e) {}
      }

      function saveTranscriptToHost(text) {
        if (!settings || typeof settings.update !== 'function') return
        try {
          settings.update('meeting-notes', { _transcript: text, _timestamp: Date.now() })
        } catch (e) {}
      }

      function triggerFinalSummary(fullText) {
        if (!settings || typeof settings.update !== 'function') return
        try {
          settings.update('meeting-notes', { _finalTranscript: fullText, _timestamp: Date.now() })
        } catch (e) {}
      }

      function startPolling() {
        if (pollingInterval) clearInterval(pollingInterval)
        pollingInterval = setInterval(function() {
          loadNotesFromSettings()
          if (updateComponent) updateComponent()
        }, 3000)
      }

      function stopPolling() {
        if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null }
      }

      var updateComponent = null

      function MeetingNotesApp() {
        var _a = React.useState('idle'), status = _a[0], setStatus = _a[1]
        var _b = React.useState(0), elapsed = _b[0], setElapsed = _b[1]
        var _c = React.useState(''), liveTranscript = _c[0], setLiveTranscript = _c[1]
        var _d = React.useState(''), interimText = _d[0], setInterimText = _d[1]
        var _e = React.useState([]), notes = _e[0], setNotes = _e[1]
        var _f = React.useState(0), turns = _f[0], setTurns = _f[1]

        var asrRef = React.useRef(null)

        React.useEffect(function() {
          asrRef.current = createASR()
          loadNotesFromSettings()
          setNotes(notesCache.slice())
          updateComponent = function() {
            loadNotesFromSettings()
            setNotes(notesCache.slice())
          }
          return function() {
            if (asrRef.current) asrRef.current.stop()
            if (timerInterval) { clearInterval(timerInterval); timerInterval = null }
            if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null }
            updateComponent = null
          }
        }, [])

        function startTimer() {
          timerSeconds = 0; setElapsed(0)
          if (timerInterval) clearInterval(timerInterval)
          timerInterval = setInterval(function() { timerSeconds++; setElapsed(timerSeconds) }, 1000)
        }
        function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null } }

        async function handleStart() {
          try {
            var asr = asrRef.current
            var asrStarted = await asr.start('zh-CN')
            if (!asrStarted) console.log('[meeting-notes] ASR not available, demo mode')

            asr.onTranscript(function(result) {
              if (result.isFinal) {
                setLiveTranscript(function(prev) { return prev + result.text + ' ' })
                setInterimText('')
                fullTranscript += result.text + ' '
                speakingTurns++
                setTurns(speakingTurns)
                saveTranscriptToHost(result.text)
              } else { setInterimText(result.text) }
            })

            recordingStatus = 'running'
            setStatus('running')
            startTimer()
            startPolling()
          } catch (error) {
            console.error('[meeting-notes] Start failed:', error.message)
            if (asrRef.current) asrRef.current.stop()
          }
        }

        function handlePause() {
          if (status === 'running') {
            asrRef.current.stop()
            recordingStatus = 'paused'; setStatus('paused'); stopTimer()
          } else if (status === 'paused') {
            asrRef.current.start('zh-CN')
            asrRef.current.onTranscript(function(result) {
              if (result.isFinal) {
                setLiveTranscript(function(prev) { return prev + result.text + ' ' })
                setInterimText('')
                fullTranscript += result.text + ' '
                speakingTurns++; setTurns(speakingTurns)
                saveTranscriptToHost(result.text)
              } else { setInterimText(result.text) }
            })
            recordingStatus = 'running'; setStatus('running'); startTimer()
          }
        }

        function handleStop() {
          asrRef.current.stop()
          recordingStatus = 'stopped'; setStatus('stopped'); stopTimer(); stopPolling()
          if (fullTranscript.trim().length > 10) {
            triggerFinalSummary(fullTranscript)
          }
        }

        // Stats
        var totalNotes = notes.length
        var totalActionItems = 0
        var totalKeyPoints = 0
        for (var i = 0; i < notes.length; i++) {
          if (notes[i].key_points) totalKeyPoints += notes[i].key_points.length
          if (notes[i].action_items) totalActionItems += notes[i].action_items.length
        }

        var statusColors = { idle: C.textSecondary, running: C.success, paused: C.warning, stopped: C.textSecondary }
        var statusLabels = { idle: '就绪', running: '录音中', paused: '已暂停', stopped: '已停止' }
        var btnStyle = { padding:'8px 16px', border:'none', borderRadius:'6px', cursor:'pointer', fontSize:'14px', fontWeight:'500', margin:'0 4px' }

        return React.createElement('div', { style:{ padding:'16px', fontFamily:'-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif' } },

          // === Main Panel ===
          React.createElement('div', { style:{ backgroundColor:C.card, borderRadius:'12px', boxShadow:'0 1px 4px ' + C.shadow, overflow:'hidden', animation:'fadeIn 0.3s ease' } },

            // === Header ===
            React.createElement('div', { style:{ padding:'16px 20px', borderBottom:'1px solid ' + C.border, display:'flex', alignItems:'center', justifyContent:'space-between' } },
              React.createElement('div', { style:{ display:'flex', alignItems:'center', gap:'10px' } },
                React.createElement('span', { style:{ fontSize:'20px' } }, '🎙'),
                React.createElement('span', { style:{ fontSize:'17px', fontWeight:'600', color:C.text } }, '会议听记')
              ),
              React.createElement('div', { style:{ display:'flex', alignItems:'center', gap:'12px' } },
                React.createElement('span', { style:{ fontSize:'13px', fontWeight:'500', color:statusColors[status], padding:'3px 10px', borderRadius:'12px', backgroundColor:status === 'running' ? C.successLight : status === 'paused' ? C.warningLight : C.bg } }, statusLabels[status]),
                (status === 'running' || status === 'paused')
                  ? React.createElement('span', { style:{ fontSize:'16px', fontWeight:'700', color:C.text, fontVariantNumeric:'tabular-nums' } }, formatTime(elapsed))
                  : null
              )
            ),

            // === Stats Cards ===
            React.createElement('div', { style:{ display:'flex', gap:'1px', backgroundColor:C.border, padding:'0 1px' } },
              React.createElement(StatCard, { label:'总时长', value:formatTime(elapsed), color:C.primary, icon:'⏱' }),
              React.createElement(StatCard, { label:'发言轮次', value:String(turns), color:C.success, icon:'💬' }),
              React.createElement(StatCard, { label:'要点', value:String(totalKeyPoints), color:C.orange, icon:'📌' }),
              React.createElement(StatCard, { label:'待办', value:String(totalActionItems), color:C.danger, icon:'✅' })
            ),

            // === Control Buttons ===
            React.createElement('div', { style:{ padding:'14px 20px', display:'flex', gap:'8px', alignItems:'center', borderBottom:'1px solid ' + C.border } },
              status === 'idle' || status === 'stopped'
                ? React.createElement('button', { onClick:handleStart, style:Object.assign({}, btnStyle, { backgroundColor:C.success, color:'#fff', flex:1, padding:'10px 20px' }) }, '🎤 开始听记')
                : null,
              status === 'running'
                ? React.createElement('button', { onClick:handlePause, style:Object.assign({}, btnStyle, { backgroundColor:C.warning, color:'#fff', flex:1, padding:'10px 20px' }) }, '⏸ 暂停')
                : null,
              status === 'paused'
                ? React.createElement('button', { onClick:handlePause, style:Object.assign({}, btnStyle, { backgroundColor:C.success, color:'#fff', padding:'10px 20px' }) }, '▶ 继续')
                : null,
              (status === 'running' || status === 'paused')
                ? React.createElement('button', { onClick:handleStop, style:Object.assign({}, btnStyle, { backgroundColor:C.danger, color:'#fff', padding:'10px 20px' }) }, '⏹ 结束并生成纪要')
                : null
            ),

            // === Final Summary Card (if any) ===
            (function() {
              var finalNote = null
              for (var i = 0; i < notes.length; i++) {
                if (notes[i].isFinal) { finalNote = notes[i]; break }
              }
              if (!finalNote) return null
              return React.createElement('div', { style:{ padding:'16px 20px', borderBottom:'1px solid ' + C.border, background:'linear-gradient(135deg,' + C.primaryLight + ', #f0f4ff)' } },
                React.createElement('div', { style:{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'10px' } },
                  React.createElement('span', { style:{ fontSize:'16px' } }, '📋'),
                  React.createElement('span', { style:{ fontSize:'15px', fontWeight:'600', color:C.primary } }, '完整会议纪要')
                ),
                React.createElement('div', { style:{ fontSize:'14px', lineHeight:'1.6', color:C.text, marginBottom:'10px' } }, finalNote.summary || ''),
                finalNote.key_points && finalNote.key_points.length > 0
                  ? React.createElement('div', { style:{ marginBottom:'8px' } },
                    React.createElement('div', { style:{ fontSize:'12px', fontWeight:'600', color:C.textSecondary, marginBottom:'4px' } }, '关键要点'),
                    finalNote.key_points.map(function(p, i) {
                      return React.createElement('div', { key:i, style:{ fontSize:'13px', color:C.text, padding:'3px 0', paddingLeft:'16px', position:'relative' } },
                        React.createElement('span', { style:{ position:'absolute', left:0, color:C.primary } }, '•'),
                        p
                      )
                    })
                  )
                  : null,
                finalNote.action_items && finalNote.action_items.length > 0
                  ? React.createElement('div', null,
                    React.createElement('div', { style:{ fontSize:'12px', fontWeight:'600', color:C.textSecondary, marginBottom:'4px' } }, '待办事项'),
                    finalNote.action_items.map(function(a, i) {
                      return React.createElement('div', { key:i, style:{ fontSize:'13px', color:C.orange, padding:'3px 0', paddingLeft:'16px', position:'relative' } },
                        React.createElement('span', { style:{ position:'absolute', left:0, color:C.orange } }, '☐'),
                        a
                      )
                    })
                  )
                  : null
              )
            })(),

            // === Summary Cards Timeline ===
            notes.length > 0
              ? React.createElement('div', { style:{ padding:'12px 20px', borderBottom:'1px solid ' + C.border } },
                React.createElement('div', { style:{ fontSize:'13px', fontWeight:'600', color:C.textSecondary, marginBottom:'10px' } }, '纪要时间线'),
                React.createElement('div', { style:{ display:'flex', flexDirection:'column', gap:'10px' } },
                  (function() {
                    var cards = []
                    for (var i = 0; i < notes.length; i++) {
                      if (notes[i].isFinal) continue // Final summary is shown above
                      cards.push(createNoteCard(notes[i], i))
                    }
                    return cards
                  })()
                )
              )
              : null,

            // === Live Transcript ===
            (liveTranscript || interimText)
              ? React.createElement('div', { style:{ padding:'14px 20px', maxHeight:'220px', overflowY:'auto', backgroundColor:C.transcriptBg } },
                React.createElement('div', { style:{ fontSize:'12px', fontWeight:'600', color:C.textSecondary, marginBottom:'8px' } }, '实时转写'),
                React.createElement('div', { style:{ fontSize:'14px', lineHeight:'1.7', color:C.text, whiteSpace:'pre-wrap' } },
                  liveTranscript,
                  interimText ? React.createElement('span', { style:{ color:C.textSecondary, opacity:0.7 } }, interimText) : null
                )
              )
              : null,

            // === Empty state ===
            status === 'idle' && !liveTranscript
              ? React.createElement('div', { style:{ padding:'32px 20px', textAlign:'center', color:C.textSecondary, fontSize:'14px', lineHeight:'1.8' } },
                React.createElement('div', { style:{ fontSize:'40px', marginBottom:'12px' } }, '🎙'),
                React.createElement('div', { style:{ fontWeight:'500', color:C.text, marginBottom:'4px' } }, '会议听记助手'),
                React.createElement('div', null, '点击「开始听记」按钮，实时录制并生成会议纪要'),
                React.createElement('div', { style:{ marginTop:'12px', fontSize:'12px', color:C.textSecondary } }, '支持麦克风转写 · AI 自动总结 · 纪要卡片时间线')
              )
              : null
          )
        )

        function createNoteCard(note, index) {
          var ts = new Date(note.timestamp || Date.now())
          var timeStr = String(ts.getHours()).padStart(2, '0') + ':' + String(ts.getMinutes()).padStart(2, '0')
          var isFinal = note.isFinal
          var cardBg = isFinal ? C.primaryLight : C.card
          var borderColor = isFinal ? C.primary : C.border

          return React.createElement('div', { key:index, style:{ padding:'14px', backgroundColor:cardBg, borderRadius:'8px', border:'1px solid ' + borderColor, animation:'fadeIn 0.3s ease ' + (index * 0.1) + 's both' } },
            // Header
            React.createElement('div', { style:{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'8px' } },
              React.createElement('div', { style:{ display:'flex', alignItems:'center', gap:'6px' } },
                React.createElement('span', { style:{ fontSize:'14px' } }, isFinal ? '📋' : '📝'),
                React.createElement('span', { style:{ fontSize:'13px', fontWeight:'600', color:C.text } }, isFinal ? '完整会议纪要' : '纪要 #' + (index + 1))
              ),
              React.createElement('span', { style:{ fontSize:'12px', color:C.textSecondary } }, timeStr)
            ),
            // Summary
            note.summary
              ? React.createElement('div', { style:{ fontSize:'14px', fontWeight:'500', color:C.primary, marginBottom:'8px', lineHeight:'1.5' } }, note.summary)
              : null,
            // Key points
            note.key_points && note.key_points.length > 0
              ? React.createElement('div', { style:{ marginBottom:'6px' } },
                note.key_points.map(function(p, i) {
                  return React.createElement('div', { key:i, style:{ fontSize:'13px', color:C.text, padding:'2px 0', paddingLeft:'14px', position:'relative', lineHeight:'1.5' } },
                    React.createElement('span', { style:{ position:'absolute', left:0, color:C.primary } }, '•'),
                    p
                  )
                })
              )
              : null,
            // Action items
            note.action_items && note.action_items.length > 0
              ? React.createElement('div', { style:{ marginTop:'6px', paddingTop:'6px', borderTop:'1px dashed ' + C.border } },
                note.action_items.map(function(a, i) {
                  return React.createElement('div', { key:i, style:{ fontSize:'13px', color:C.orange, padding:'2px 0', paddingLeft:'14px', position:'relative', lineHeight:'1.5' } },
                    React.createElement('span', { style:{ position:'absolute', left:0, color:C.orange } }, '☐'),
                    a
                  )
                })
              )
              : null
          )
        }
      }

      function StatCard(props) {
        return React.createElement('div', { style:{ flex:1, padding:'12px 8px', textAlign:'center', backgroundColor:C.card } },
          React.createElement('div', { style:{ fontSize:'20px', marginBottom:'2px' } }, props.icon),
          React.createElement('div', { style:{ fontSize:'18px', fontWeight:'700', color:props.color, fontVariantNumeric:'tabular-nums' } }, props.value),
          React.createElement('div', { style:{ fontSize:'11px', color:C.textSecondary, marginTop:'2px' } }, props.label)
        )
      }

      // Register in conversation.view slot
      slots.inject('conversation.view', function() { return slots.register({ name:'conversation.view', id:'听记', order:60 }, function() { return React.createElement(MeetingNotesApp) }) })
      console.log('[meeting-notes-client] UI registered in conversation.view')
    }

    return exports
  }
})