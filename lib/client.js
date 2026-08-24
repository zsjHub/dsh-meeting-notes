window.__ModuleLoader__.load({
  id: 'dsh-meeting-notes',
  factory: function(require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')

    exports.name = 'dsh-meeting-notes-client'
    exports.inject = ['slots']

    exports.apply = function(ctx) {
      var slots = ctx.slots
      if (!slots) { console.warn('[meeting-notes] Slots not available'); return }

      // ── Color palette ──
      var C = {
        primary: '#1a73e8', primaryLight: '#e8f0fe',
        success: '#34a853', successLight: '#e6f4ea',
        warning: '#fbbc04', warningLight: '#fef7e0',
        danger: '#ea4335', dangerLight: '#fce8e6',
        orange: '#ff6d01', orangeLight: '#fef3e8',
        bg: '#f8f9fa', card: '#ffffff',
        text: '#202124', textSecondary: '#5f6368',
        border: '#e0e0e0', shadow: 'rgba(0,0,0,0.08)',
        sidebarBg: '#f0f4f8', sidebarHover: '#e8edf4',
        activeBg: '#d3e3fd',
      }

      try { styles.insert('@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}') } catch (e) {}
      try { styles.insert('@keyframes slideIn{from{opacity:0;transform:translateX(-20px)}to{opacity:1;transform:translateX(0)}}') } catch (e) {}
      try { styles.insert('@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}') } catch (e) {}

      // ── Global state ──
      var notesList = []
      var activeNoteId = null
      var activeNoteData = null
      var recordingStatus = 'idle'
      var timerSeconds = 0
      var timerInterval = null
      var fullTranscript = ''
      var speakingTurns = 0
      var asr = null
      var isListVisible = false
      var updateFn = null

      // ── Helper functions ──
      function formatTime(seconds) {
        var h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60)
        if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
        return m + ':' + String(s).padStart(2, '0')
      }

      function formatDate(iso) {
        if (!iso) return ''
        var d = new Date(iso)
        var month = String(d.getMonth() + 1).padStart(2, '0')
        var day = String(d.getDate()).padStart(2, '0')
        var h = String(d.getHours()).padStart(2, '0')
        var m = String(d.getMinutes()).padStart(2, '0')
        return month + '-' + day + ' ' + h + ':' + m
      }

      function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }

      function statusLabel(status) {
        return { recording: '录音中', paused: '已暂停', completed: '已总结', summarizing: '生成中', idle: '就绪' }[status] || status
      }

      function statusIcon(status) {
        return { recording: '🔴', paused: '⏸', completed: '✅', summarizing: '⏳', idle: '⚪' }[status] || '⚪'
      }

      // ── Host communication ──
      function hostCall(action, data) {
        try {
          return host.call('meeting-notes', Object.assign({ action: action }, data || {}))
        } catch (e) {
          console.error('[meeting-notes] host.call error:', e.message)
          return Promise.resolve({ error: e.message })
        }
      }

      async function loadNotes() {
        var result = await hostCall('list')
        if (result && result.success) {
          notesList = result.data || []
          if (updateFn) updateFn()
        }
      }

      async function loadNote(id) {
        var result = await hostCall('get', { id: id })
        if (result && result.success) {
          activeNoteData = result.data
          if (updateFn) updateFn()
        }
      }

      async function createNote() {
        var result = await hostCall('create', { title: '新听记 ' + new Date().toLocaleDateString('zh-CN') })
        if (result && result.success) {
          activeNoteId = result.data.id
          activeNoteData = result.data
          await loadNotes()
          if (updateFn) updateFn()
          return result.data
        }
        return null
      }

      async function saveNote(id, data) {
        return await hostCall('save', { id: id, data: data })
      }

      async function deleteNote(id) {
        var result = await hostCall('delete', { id: id })
        if (result && result.success) {
          if (activeNoteId === id) {
            activeNoteId = null
            activeNoteData = null
          }
          await loadNotes()
          if (updateFn) updateFn()
        }
      }

      async function triggerSummarize(id) {
        var result = await hostCall('summarize', { id: id })
        if (result && result.success) {
          activeNoteData = result.data
          await loadNotes()
          if (updateFn) updateFn()
        }
        return result
      }

      // ── ASR (Web Speech API) ──
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

      // ── Sidebar component: "听记" button + settings gear ──
      function SidebarEntry(props) {
        var _a = React.useState(isListVisible), visible = _a[0], setVisible = _a[1]
        var wide = props && props.wide

        React.useEffect(function() {
          // Sync global state
          isListVisible = visible
        }, [visible])

        function handleClick() {
          if (!visible) {
            // Open meeting notes UI
            loadNotes()
            if (!activeNoteData && notesList.length > 0) {
              activeNoteId = notesList[0].id
              loadNote(activeNoteId)
            }
          }
          setVisible(!visible)
          isListVisible = !visible
          if (updateFn) updateFn()
        }

        function handleSettings(e) {
          e.stopPropagation()
          try {
            ctx.emit('settings/open')
          } catch (err) {
            console.warn('[meeting-notes] Cannot open settings:', err.message)
          }
        }

        var btnStyle = {
          display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
          padding: wide ? '10px 16px' : '10px 0',
          border: 'none', borderRadius: '0', cursor: 'pointer',
          fontSize: '14px', fontWeight: visible ? '600' : '400',
          color: visible ? C.primary : C.text,
          backgroundColor: visible ? C.activeBg : 'transparent',
          transition: 'all 0.15s ease',
          justifyContent: wide ? 'flex-start' : 'center',
        }

        return React.createElement('div', { style: { borderBottom: '1px solid ' + C.border } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'stretch' } },
            React.createElement('button', {
              onClick: handleClick,
              style: Object.assign({}, btnStyle, { flex: 1 }),
              title: '会议听记',
            },
              React.createElement('span', { style: { fontSize: '16px' } }, '🎙'),
              wide ? React.createElement('span', null, '听记') : null
            ),
            React.createElement('button', {
              onClick: handleSettings,
              style: {
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '10px 8px', border: 'none', borderLeft: '1px solid ' + C.border,
                cursor: 'pointer', background: 'transparent', color: C.textSecondary,
                fontSize: '16px',
              },
              title: '设置',
            },
              React.createElement('span', null, '⚙️')
            )
          )
        )
      }

      // ── Main Meeting Notes App ──
      function MeetingNotesApp() {
        var _a = React.useState(notesList), notes = _a[0], setNotes = _a[1]
        var _b = React.useState(activeNoteId), selectedId = _b[0], setSelectedId = _b[1]
        var _c = React.useState(activeNoteData), selectedNote = _c[0], setSelectedNote = _c[1]
        var _d = React.useState(recordingStatus), recStatus = _d[0], setRecStatus = _d[1]
        var _e = React.useState(timerSeconds), elapsed = _e[0], setElapsed = _e[1]
        var _f = React.useState(''), liveTranscript = _f[0], setLiveTranscript = _f[1]
        var _g = React.useState(''), interimText = _g[0], setInterimText = _g[1]
        var _h = React.useState(speakingTurns), turns = _h[0], setTurns = _h[1]
        var _i = React.useState(false), isNewRecording = _i[0], setIsNewRecording = _i[1]

        // Update function for global state changes
        React.useEffect(function() {
          updateFn = function() {
            setNotes(notesList.slice())
            setSelectedId(activeNoteId)
            setSelectedNote(activeNoteData ? Object.assign({}, activeNoteData) : null)
            setRecStatus(recordingStatus)
            setElapsed(timerSeconds)
            setTurns(speakingTurns)
          }
          return function() { updateFn = null }
        }, [])

        async function handleNewRecording() {
          setIsNewRecording(true)
          setSelectedId(null)
          setSelectedNote(null)
          setRecStatus('idle')
          setLiveTranscript('')
          setInterimText('')
          fullTranscript = ''
          speakingTurns = 0
          timerSeconds = 0
          setTurns(0)
          setElapsed(0)
        }

        function selectNote(id) {
          setIsNewRecording(false)
          setSelectedId(id)
          activeNoteId = id
          loadNote(id)
        }

        function startTimer() {
          timerSeconds = 0; setElapsed(0)
          if (timerInterval) clearInterval(timerInterval)
          timerInterval = setInterval(function() { timerSeconds++; setElapsed(timerSeconds) }, 1000)
        }

        function stopTimer() {
          if (timerInterval) { clearInterval(timerInterval); timerInterval = null }
        }

        async function handleStart() {
          try {
            asr = createASR()
            var asrStarted = await asr.start('zh-CN')
            if (!asrStarted) console.log('[meeting-notes] ASR not available, demo mode')

            var currentNote = null
            if (isNewRecording || !selectedId) {
              var note = await createNote()
              if (note) {
                currentNote = note
                setSelectedId(note.id)
                activeNoteId = note.id
                activeNoteData = note
                setIsNewRecording(false)
              }
            } else {
              currentNote = activeNoteData
            }

            if (!currentNote) return

            asr.onTranscript(function(result) {
              if (result.isFinal) {
                setLiveTranscript(function(prev) { return prev + result.text + ' ' })
                setInterimText('')
                fullTranscript += result.text + ' '
                speakingTurns++
                setTurns(speakingTurns)
                // Save transcript periodically
                saveNote(activeNoteId, { transcript: fullTranscript, duration: timerSeconds })
              } else { setInterimText(result.text) }
            })

            recordingStatus = 'recording'
            setRecStatus('recording')
            startTimer()
          } catch (error) {
            console.error('[meeting-notes] Start failed:', error.message)
            if (asr) asr.stop()
          }
        }

        function handlePause() {
          if (recStatus === 'recording') {
            if (asr) asr.stop()
            recordingStatus = 'paused'; setRecStatus('paused'); stopTimer()
            // Save current state
            if (activeNoteId) {
              saveNote(activeNoteId, { transcript: fullTranscript, duration: timerSeconds, status: 'paused' })
            }
          } else if (recStatus === 'paused') {
            asr = createASR()
            asr.start('zh-CN')
            asr.onTranscript(function(result) {
              if (result.isFinal) {
                setLiveTranscript(function(prev) { return prev + result.text + ' ' })
                setInterimText('')
                fullTranscript += result.text + ' '
                speakingTurns++; setTurns(speakingTurns)
                saveNote(activeNoteId, { transcript: fullTranscript, duration: timerSeconds })
              } else { setInterimText(result.text) }
            })
            recordingStatus = 'recording'; setRecStatus('recording'); startTimer()
          }
        }

        async function handleStop() {
          if (asr) asr.stop()
          recordingStatus = 'stopped'; setRecStatus('stopped'); stopTimer()
          if (activeNoteId) {
            // Save final transcript
            await saveNote(activeNoteId, { transcript: fullTranscript, duration: timerSeconds, status: 'completed' })
            // Trigger summarization
            setRecStatus('summarizing')
            var result = await triggerSummarize(activeNoteId)
            if (result && result.success) {
              // Reload the note
              await loadNote(activeNoteId)
            }
            await loadNotes()
          }
          setIsNewRecording(false)
        }

        // Stats
        var totalNotes = notes.length
        var totalDuration = 0
        for (var i = 0; i < notes.length; i++) {
          totalDuration += notes[i].duration || 0
        }

        var statusColors = { idle: C.textSecondary, recording: C.success, paused: C.warning, stopped: C.textSecondary, summarizing: C.orange }
        var statusLabels = { idle: '就绪', recording: '录音中', paused: '已暂停', stopped: '已停止', summarizing: '生成纪要中...' }
        var btnStyle = { padding:'8px 16px', border:'none', borderRadius:'6px', cursor:'pointer', fontSize:'14px', fontWeight:'500', margin:'0 4px' }

        return React.createElement('div', { style: { display: 'flex', height: '100%', fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif' } },
          // ── Left panel: History list ──
          React.createElement('div', { style: { width: '220px', minWidth: '220px', borderRight: '1px solid ' + C.border, backgroundColor: C.sidebarBg, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
            // History header
            React.createElement('div', { style: { padding: '12px 14px', borderBottom: '1px solid ' + C.border, fontSize: '13px', fontWeight: '600', color: C.textSecondary, display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
              React.createElement('span', null, '历史记录'),
              React.createElement('span', { style: { fontSize: '11px', color: C.textSecondary } }, totalNotes + ' 次')
            ),
            // "新听记" button
            React.createElement('button', {
              onClick: handleNewRecording,
              style: {
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 14px', margin: '8px',
                border: '1px dashed ' + C.primary, borderRadius: '8px',
                cursor: 'pointer', fontSize: '13px', fontWeight: '500',
                color: C.primary, backgroundColor: 'white',
                transition: 'all 0.15s ease',
              },
            },
              React.createElement('span', { style: { fontSize: '14px' } }, '➕'),
              React.createElement('span', null, '新听记')
            ),
            // Notes list
            React.createElement('div', { style: { flex: 1, overflowY: 'auto', padding: '0 4px' } },
              notes.length === 0
                ? React.createElement('div', { style: { padding: '20px 14px', textAlign: 'center', color: C.textSecondary, fontSize: '12px', lineHeight: '1.6' } },
                    React.createElement('div', { style: { fontSize: '24px', marginBottom: '6px' } }, '🎙'),
                    React.createElement('div', null, '暂无听记记录'),
                    React.createElement('div', { style: { fontSize: '11px', marginTop: '4px' } }, '点击上方「新听记」开始')
                  )
                : notes.map(function(note) {
                    var isActive = note.id === selectedId
                    return React.createElement('div', {
                      key: note.id,
                      onClick: function() { selectNote(note.id) },
                      style: {
                        padding: '10px 12px', margin: '2px 0',
                        borderRadius: '6px', cursor: 'pointer',
                        backgroundColor: isActive ? C.activeBg : 'transparent',
                        transition: 'background-color 0.15s ease',
                      },
                    },
                      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' } },
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: '500', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                          React.createElement('span', null, '📋'),
                          React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, note.title || '无标题')
                        ),
                        React.createElement('span', { style: { fontSize: '11px', color: note.status === 'completed' ? C.success : C.textSecondary } }, statusIcon(note.status))
                      ),
                      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: C.textSecondary } },
                        React.createElement('span', null, formatDate(note.date)),
                        note.duration > 0 ? React.createElement('span', null, '⏱ ' + formatTime(note.duration)) : null,
                        React.createElement('span', { style: { color: note.status === 'completed' ? C.success : C.orange, fontSize: '11px' } }, statusLabel(note.status))
                      )
                    )
                  })
            ),
            // Footer stats
            React.createElement('div', { style: { padding: '8px 14px', borderTop: '1px solid ' + C.border, fontSize: '11px', color: C.textSecondary, textAlign: 'center' } },
              '累计 ' + totalNotes + ' 次 · 总时长 ' + formatTime(totalDuration)
            )
          ),

          // ── Right panel: Detail view ──
          React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: C.bg } },
            // Show new recording or selected note
            (isNewRecording || (recStatus !== 'idle' && recStatus !== 'stopped'))
              ? renderRecordingUI()
              : selectedNote
                ? renderNoteDetail(selectedNote)
                : renderEmptyState()
          )
        )

        // ── Recording UI (shown when recording or in new recording mode) ──
        function renderRecordingUI() {
          return React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column' } },
            // Header
            React.createElement('div', { style: { padding: '14px 20px', borderBottom: '1px solid ' + C.border, backgroundColor: C.card, display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                React.createElement('span', { style: { fontSize: '18px' } }, '🎙'),
                React.createElement('span', { style: { fontSize: '15px', fontWeight: '600', color: C.text } }, '新听记')
              ),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
                React.createElement('span', { style: { fontSize: '12px', fontWeight: '500', color: statusColors[recStatus], padding: '2px 10px', borderRadius: '10px', backgroundColor: recStatus === 'recording' ? C.successLight : recStatus === 'paused' ? C.warningLight : recStatus === 'summarizing' ? C.orangeLight : C.bg } }, statusLabels[recStatus]),
                (recStatus === 'recording' || recStatus === 'paused')
                  ? React.createElement('span', { style: { fontSize: '14px', fontWeight: '700', color: C.text, fontVariantNumeric: 'tabular-nums' } }, formatTime(elapsed))
                  : null
              )
            ),
            // Control buttons
            React.createElement('div', { style: { padding: '12px 20px', display: 'flex', gap: '8px', alignItems: 'center', borderBottom: '1px solid ' + C.border, backgroundColor: C.card } },
              recStatus === 'idle' || recStatus === 'stopped'
                ? React.createElement('button', { onClick: handleStart, style: Object.assign({}, btnStyle, { backgroundColor: C.success, color: '#fff', flex: 1, padding: '10px 20px', borderRadius: '8px' }) }, '🎤 开始听记')
                : null,
              recStatus === 'recording'
                ? React.createElement('button', { onClick: handlePause, style: Object.assign({}, btnStyle, { backgroundColor: C.warning, color: '#fff', flex: 1, padding: '10px 20px', borderRadius: '8px' }) }, '⏸ 暂停')
                : null,
              recStatus === 'paused'
                ? React.createElement('button', { onClick: handlePause, style: Object.assign({}, btnStyle, { backgroundColor: C.success, color: '#fff', padding: '10px 20px', borderRadius: '8px' }) }, '▶ 继续')
                : null,
              (recStatus === 'recording' || recStatus === 'paused')
                ? React.createElement('button', { onClick: handleStop, style: Object.assign({}, btnStyle, { backgroundColor: C.danger, color: '#fff', padding: '10px 20px', borderRadius: '8px' }) }, '⏹ 结束并生成纪要')
                : null,
              recStatus === 'summarizing'
                ? React.createElement('div', { style: { flex: 1, textAlign: 'center', padding: '10px', fontSize: '14px', color: C.orange, animation: 'pulse 1.5s infinite' } }, '⏳ 正在生成会议纪要...')
                : null
            ),
            // Live transcript
            (liveTranscript || interimText)
              ? React.createElement('div', { style: { flex: 1, padding: '14px 20px', overflowY: 'auto', backgroundColor: C.transcriptBg || '#f0f4f8' } },
                React.createElement('div', { style: { fontSize: '12px', fontWeight: '600', color: C.textSecondary, marginBottom: '8px' } }, '实时转写'),
                React.createElement('div', { style: { fontSize: '14px', lineHeight: '1.7', color: C.text, whiteSpace: 'pre-wrap' } },
                  liveTranscript,
                  interimText ? React.createElement('span', { style: { color: C.textSecondary, opacity: 0.7 } }, interimText) : null
                )
              )
              : null,
            // Empty transcript area
            !liveTranscript && !interimText
              ? React.createElement('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textSecondary, fontSize: '14px' } },
                  React.createElement('div', { style: { textAlign: 'center', lineHeight: '1.8' } },
                    React.createElement('div', { style: { fontSize: '32px', marginBottom: '8px' } }, '🎙'),
                    React.createElement('div', null, '点击「开始听记」按钮进行语音转写'),
                    React.createElement('div', { style: { fontSize: '12px', marginTop: '4px' } }, '支持实时转写 · AI 自动总结')
                  )
                )
              : null
          )
        }

        // ── Note detail view ──
        function renderNoteDetail(note) {
          if (!note) return renderEmptyState()
          var hasSummary = note.summary && note.summary.length > 0
          var hasKeyPoints = note.keyPoints && note.keyPoints.length > 0
          var hasActions = note.actionItems && note.actionItems.length > 0

          return React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
            // Header
            React.createElement('div', { style: { padding: '14px 20px', borderBottom: '1px solid ' + C.border, backgroundColor: C.card } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' } },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                  React.createElement('span', { style: { fontSize: '18px' } }, '📋'),
                  React.createElement('span', { style: { fontSize: '15px', fontWeight: '600', color: C.text } }, note.title || '无标题')
                ),
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                  React.createElement('span', { style: { fontSize: '12px', fontWeight: '500', color: note.status === 'completed' ? C.success : C.orange, padding: '2px 10px', borderRadius: '10px', backgroundColor: note.status === 'completed' ? C.successLight : C.orangeLight } }, statusLabel(note.status)),
                  React.createElement('button', {
                    onClick: function() { if (confirm('确定删除这条听记吗？')) deleteNote(note.id) },
                    style: { padding: '4px 8px', border: '1px solid ' + C.border, borderRadius: '4px', cursor: 'pointer', fontSize: '12px', color: C.danger, background: 'transparent' },
                  }, '删除')
                )
              ),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', color: C.textSecondary } },
                React.createElement('span', null, '📅 ' + formatDate(note.date)),
                note.duration > 0 ? React.createElement('span', null, '⏱ ' + formatTime(note.duration)) : null,
                note.transcript ? React.createElement('span', null, '📝 ' + (note.transcript.length || 0) + '字') : null
              )
            ),
            // Content
            React.createElement('div', { style: { flex: 1, overflowY: 'auto', padding: '16px 20px' } },
              // Summary
              hasSummary
                ? React.createElement('div', { style: { marginBottom: '16px', animation: 'fadeIn 0.3s ease' } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' } },
                      React.createElement('span', { style: { fontSize: '14px' } }, '📝'),
                      React.createElement('span', { style: { fontSize: '13px', fontWeight: '600', color: C.text } }, '会议摘要')
                    ),
                    React.createElement('div', { style: { fontSize: '14px', lineHeight: '1.6', color: C.text, padding: '12px 14px', backgroundColor: C.primaryLight, borderRadius: '8px' } },
                      note.summary
                    )
                  )
                : null,
              // Key points
              hasKeyPoints
                ? React.createElement('div', { style: { marginBottom: '16px', animation: 'fadeIn 0.3s ease 0.1s both' } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' } },
                      React.createElement('span', { style: { fontSize: '14px' } }, '📌'),
                      React.createElement('span', { style: { fontSize: '13px', fontWeight: '600', color: C.text } }, '关键要点')
                    ),
                    React.createElement('div', { style: { padding: '12px 14px', backgroundColor: C.card, borderRadius: '8px', border: '1px solid ' + C.border } },
                      note.keyPoints.map(function(p, i) {
                        return React.createElement('div', { key: i, style: { fontSize: '13px', color: C.text, padding: '4px 0', paddingLeft: '16px', position: 'relative', lineHeight: '1.5', borderBottom: i < note.keyPoints.length - 1 ? '1px solid ' + C.border : 'none' } },
                          React.createElement('span', { style: { position: 'absolute', left: 0, color: C.primary } }, '•'),
                          p
                        )
                      })
                    )
                  )
                : null,
              // Action items
              hasActions
                ? React.createElement('div', { style: { marginBottom: '16px', animation: 'fadeIn 0.3s ease 0.2s both' } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' } },
                      React.createElement('span', { style: { fontSize: '14px' } }, '✅'),
                      React.createElement('span', { style: { fontSize: '13px', fontWeight: '600', color: C.text } }, '待办事项')
                    ),
                    React.createElement('div', { style: { padding: '12px 14px', backgroundColor: C.card, borderRadius: '8px', border: '1px solid ' + C.border } },
                      note.actionItems.map(function(a, i) {
                        return React.createElement('div', { key: i, style: { fontSize: '13px', color: C.orange, padding: '4px 0', paddingLeft: '16px', position: 'relative', lineHeight: '1.5', borderBottom: i < note.actionItems.length - 1 ? '1px solid ' + C.border : 'none' } },
                          React.createElement('span', { style: { position: 'absolute', left: 0, color: C.orange } }, '☐'),
                          a
                        )
                      })
                    )
                  )
                : null,
              // Transcript (if no summary)
              !hasSummary && note.transcript
                ? React.createElement('div', { style: { marginBottom: '16px' } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' } },
                      React.createElement('span', { style: { fontSize: '14px' } }, '📝'),
                      React.createElement('span', { style: { fontSize: '13px', fontWeight: '600', color: C.text } }, '转写全文')
                    ),
                    React.createElement('div', { style: { fontSize: '13px', lineHeight: '1.7', color: C.text, padding: '12px 14px', backgroundColor: C.card, borderRadius: '8px', border: '1px solid ' + C.border, whiteSpace: 'pre-wrap' } },
                      note.transcript
                    )
                  )
                : null,
              // Recording controls for this note
              note.status === 'completed' && note.transcript
                ? React.createElement('div', { style: { marginTop: '16px', padding: '12px 14px', backgroundColor: C.card, borderRadius: '8px', border: '1px dashed ' + C.border, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' } },
                    React.createElement('button', { onClick: handleNewRecording, style: Object.assign({}, btnStyle, { backgroundColor: C.primary, color: '#fff', padding: '8px 16px', borderRadius: '6px' }) }, '🎤 开始新听记')
                  )
                : null
            )
          )
        }

        // ── Empty state ──
        function renderEmptyState() {
          return React.createElement('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg } },
            React.createElement('div', { style: { textAlign: 'center', color: C.textSecondary, lineHeight: '2' } },
              React.createElement('div', { style: { fontSize: '48px', marginBottom: '12px' } }, '🎙'),
              React.createElement('div', { style: { fontSize: '16px', fontWeight: '500', color: C.text, marginBottom: '4px' } }, '会议听记'),
              React.createElement('div', { style: { fontSize: '13px' } }, '选择左侧历史记录查看详情'),
              React.createElement('div', { style: { fontSize: '13px' } }, '或点击「新听记」开始新的会议录制'),
              React.createElement('div', { style: { marginTop: '16px' } },
                React.createElement('button', { onClick: handleNewRecording, style: Object.assign({}, btnStyle, { backgroundColor: C.primary, color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '14px' }) }, '🎤 开始新听记')
              )
            )
          )
        }
      }

      // ── Register sidebar entry ──
      // Replace the sidebar.settings slot with our custom component
      try {
        slots.inject('sidebar.settings', function() {
          return React.createElement(SidebarEntry)
        })
        console.log('[meeting-notes] Sidebar entry registered')
      } catch (e) {
        console.warn('[meeting-notes] Failed to register sidebar entry:', e.message)
      }

      // ── Register the main meeting notes UI in the conversation.view slot ──
      // When the "听记" sidebar entry is clicked, show the meeting notes UI
      try {
        slots.inject('conversation.view', function() {
          return slots.register({ name: 'conversation.view', id: '听记', order: 60 }, function() {
            // Only render when the sidebar "听记" is active
            if (!isListVisible) return null
            return React.createElement(MeetingNotesApp)
          })
        })
        console.log('[meeting-notes-client] UI registered in conversation.view')
      } catch (e) {
        console.warn('[meeting-notes] Failed to register conversation UI:', e.message)
      }
    }

    return exports
  }
})