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
      var llm = ctx.get('llm')

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

      // ── Inject CSS animations ──
      var styles = null
      try {
        styles = document.createElement('style')
        document.head.appendChild(styles)
      } catch (e) {}

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
      var isOverlayVisible = false
      var updateFn = null

      // ── localStorage helpers ──
      function loadFromStorage() {
        try {
          var stored = localStorage.getItem('dsh-meeting-notes')
          if (stored) {
            var data = JSON.parse(stored)
            notesList = data.notesList || []
            activeNoteId = data.activeNoteId || null
            activeNoteData = data.activeNoteData || null
            recordingStatus = data.recordingStatus || 'idle'
          }
        } catch (e) {
          console.warn('[meeting-notes] Failed to load from localStorage:', e.message)
        }
      }

      function saveToStorage() {
        try {
          localStorage.setItem('dsh-meeting-notes', JSON.stringify({
            notesList: notesList,
            activeNoteId: activeNoteId,
            activeNoteData: activeNoteData,
            recordingStatus: recordingStatus,
          }))
        } catch (e) {
          console.warn('[meeting-notes] Failed to save to localStorage:', e.message)
        }
      }

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

      function nowISO() { return new Date().toISOString() }

      // ── Data operations (localStorage-based) ──
      function loadNotes() {
        loadFromStorage()
        if (updateFn) updateFn()
      }

      function loadNote(id) {
        loadFromStorage()
        for (var i = 0; i < notesList.length; i++) {
          if (notesList[i].id === id) {
            activeNoteId = id
            activeNoteData = notesList[i]
            saveToStorage()
            if (updateFn) updateFn()
            return
          }
        }
        activeNoteId = null
        activeNoteData = null
        if (updateFn) updateFn()
      }

      function createNote() {
        var id = generateId()
        var now = nowISO()
        var note = {
          id: id,
          title: '新听记 ' + new Date().toLocaleDateString('zh-CN'),
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
        notesList.unshift({ id: id, title: note.title, date: now, duration: 0, status: 'recording' })
        activeNoteId = id
        activeNoteData = note
        saveToStorage()
        if (updateFn) updateFn()
        return note
      }

      function saveNote(id, data) {
        for (var i = 0; i < notesList.length; i++) {
          if (notesList[i].id === id) {
            for (var k in data) {
              if (data.hasOwnProperty(k)) {
                notesList[i][k] = data[k]
              }
            }
            if (activeNoteData && activeNoteData.id === id) {
              for (var k in data) {
                if (data.hasOwnProperty(k)) {
                  activeNoteData[k] = data[k]
                }
              }
            }
            break
          }
        }
        saveToStorage()
        if (updateFn) updateFn()
      }

      function deleteNote(id) {
        notesList = notesList.filter(function(n) { return n.id !== id })
        if (activeNoteId === id) {
          activeNoteId = null
          activeNoteData = null
        }
        saveToStorage()
        if (updateFn) updateFn()
      }

      async function triggerSummarize(id) {
        var note = null
        for (var i = 0; i < notesList.length; i++) {
          if (notesList[i].id === id) {
            note = notesList[i]
            break
          }
        }
        if (!note || !note.transcript || note.transcript.trim().length < 10) {
          return { success: false, error: 'Transcript too short to summarize' }
        }

        note.status = 'summarizing'
        saveToStorage()
        if (updateFn) updateFn()

        try {
          // Call the LLM adapter registered by the host
          var systemPrompt = 'You are a professional meeting minutes assistant. Summarize the meeting transcript below into a structured summary.\n\nRespond with **valid JSON only**, no markdown fences, no extra text:\n{\n  "summary": "Meeting summary (2-3 sentences describing the core topic)",\n  "key_points": ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5"],\n  "action_items": ["Action 1", "Action 2", "Action 3"]\n}'

          if (llm && typeof llm.stream === 'function') {
            var messages = [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: note.transcript }
            ]
            var result = await llm.stream({ model: 'meeting-notes-summarize', messages: messages })
            var content = ''
            if (result && result.length > 0) {
              content = result[result.length - 1].content || ''
            }
            if (content) {
              var cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
              var parsed = JSON.parse(cleaned)
              note.summary = parsed.summary || ''
              note.keyPoints = Array.isArray(parsed.key_points) ? parsed.key_points : []
              note.actionItems = Array.isArray(parsed.action_items) ? parsed.action_items : []
            }
          } else {
            // Fallback: generate demo summary
            var demo = generateDemoSummary(note.transcript)
            note.summary = demo.summary || ''
            note.keyPoints = Array.isArray(demo.key_points) ? demo.key_points : []
            note.actionItems = Array.isArray(demo.action_items) ? demo.action_items : []
          }

          note.status = 'completed'
          note.endTime = nowISO()
          saveToStorage()
          if (updateFn) updateFn()
          return { success: true, data: note }
        } catch (e) {
          console.warn('[meeting-notes] Summarize error:', e.message)
          note.status = 'completed'
          note.summary = '(摘要生成失败: ' + e.message + ')'
          saveToStorage()
          if (updateFn) updateFn()
          return { success: false, error: e.message }
        }
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

      // ── Sidebar component: "听记" button in sidebar footer ──
      function SidebarEntry(props) {
        var _a = React.useState(isOverlayVisible), visible = _a[0], setVisible = _a[1]

        React.useEffect(function() {
          isOverlayVisible = visible
        }, [visible])

        function handleClick() {
          loadNotes()
          setVisible(true)
          isOverlayVisible = true
          if (updateFn) updateFn()
        }

        return React.createElement('button', {
          onClick: handleClick,
          style: {
            display: 'flex', alignItems: 'center', gap: '4px',
            padding: '6px 12px', border: 'none', borderRadius: '6px',
            cursor: 'pointer', fontSize: '13px', fontWeight: '500',
            color: visible ? C.primary : C.text,
            backgroundColor: visible ? C.activeBg : 'transparent',
            transition: 'all 0.15s ease',
          },
          title: '会议听记',
        },
          React.createElement('span', { style: { fontSize: '14px' } }, '🎙'),
          React.createElement('span', null, '听记')
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

        // Update global updateFn so data operations trigger re-render
        updateFn = function() {
          setNotes([].concat(notesList))
          setSelectedId(activeNoteId)
          setSelectedNote(activeNoteData ? Object.assign({}, activeNoteData) : null)
          setRecStatus(recordingStatus)
        }

        // Load data on mount
        React.useEffect(function() {
          loadFromStorage()
          setNotes([].concat(notesList))
          setSelectedId(activeNoteId)
          setSelectedNote(activeNoteData ? Object.assign({}, activeNoteData) : null)
          setRecStatus(recordingStatus)
          setElapsed(timerSeconds)
        }, [])

        // Timer for recording
        React.useEffect(function() {
          if (recStatus === 'recording') {
            var interval = setInterval(function() {
              setElapsed(function(prev) { return prev + 1 })
            }, 1000)
            return function() { clearInterval(interval) }
          }
        }, [recStatus])

        // ── Handlers ──
        function handleNewRecording() {
          var note = createNote()
          setSelectedId(note.id)
          setSelectedNote(note)
          setNotes([].concat(notesList))
          startRecording()
        }

        function startRecording() {
          if (!asr) asr = createASR()
          if (!asr.isSupported) { alert('您的浏览器不支持语音识别，请使用 Chrome 浏览器。'); return }
          speakingTurns = 0
          setTurns(0)
          setRecStatus('recording')
          fullTranscript = ''
          setLiveTranscript('')
          setInterimText('')
          recordingStatus = 'recording'
          timerSeconds = 0
          setElapsed(0)
          if (timerInterval) { clearInterval(timerInterval); timerInterval = null }

          asr.onTranscript(function(transcript) {
            if (transcript.isFinal) {
              fullTranscript += transcript.text
              speakingTurns++
              setTurns(speakingTurns)
              setLiveTranscript(fullTranscript)
              // Save transcript to the active note
              if (activeNoteData) {
                activeNoteData.transcript = fullTranscript
                activeNoteData.duration = timerSeconds
                saveToStorage()
              }
            } else {
              setInterimText(transcript.text)
            }
          })

          asr.start('zh-CN').then(function(success) {
            if (!success) {
              setRecStatus('idle')
              recordingStatus = 'idle'
            }
          })
        }

        function stopRecording() {
          if (asr) asr.stop()
          setRecStatus('idle')
          recordingStatus = 'idle'
          if (activeNoteData) {
            activeNoteData.status = 'idle'
            activeNoteData.duration = timerSeconds
            activeNoteData.transcript = fullTranscript
            activeNoteData.endTime = nowISO()
            saveToStorage()
          }
          if (timerInterval) { clearInterval(timerInterval); timerInterval = null }
        }

        function handleSelectNote(id) {
          loadNote(id)
          setSelectedId(activeNoteId)
          setSelectedNote(activeNoteData ? Object.assign({}, activeNoteData) : null)
          setNotes([].concat(notesList))
        }

        function handleDeleteNote(id) {
          if (!confirm('确定删除此听记？')) return
          deleteNote(id)
          setSelectedId(activeNoteId)
          setSelectedNote(activeNoteData ? Object.assign({}, activeNoteData) : null)
          setNotes([].concat(notesList))
        }

        async function handleSummarize(id) {
          var result = await triggerSummarize(id)
          if (result.success) {
            loadFromStorage()
            setSelectedNote(activeNoteData ? Object.assign({}, activeNoteData) : null)
            setNotes([].concat(notesList))
          }
        }

        function handleClose() {
          isOverlayVisible = false
          if (updateFn) updateFn()
          // Re-render the parent component to close the overlay
          setNotes([].concat(notesList))
        }

        // ── Styles ──
        var overlayStyle = {
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 9999, backgroundColor: '#fff', display: 'flex', flexDirection: 'column',
          animation: 'fadeIn 0.2s ease',
        }
        var headerStyle = {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 16px', borderBottom: '1px solid ' + C.border,
          backgroundColor: C.sidebarBg, flexShrink: 0,
        }
        var bodyStyle = {
          display: 'flex', flex: 1, overflow: 'hidden',
        }
        var sidebarStyle = {
          width: '280px', borderRight: '1px solid ' + C.border,
          display: 'flex', flexDirection: 'column', backgroundColor: C.sidebarBg,
          flexShrink: 0, overflow: 'hidden',
        }
        var mainStyle = {
          flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          backgroundColor: C.bg,
        }
        var btnStyle = {
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          padding: '6px 12px', border: 'none', borderRadius: '6px',
          cursor: 'pointer', fontSize: '12px', fontWeight: '500',
          transition: 'all 0.15s ease',
        }

        // ── Render notes list ──
        function renderNoteList() {
          var items = []
          var sorted = [].concat(notes).sort(function(a, b) { return (b.date || '') < (a.date || '') ? -1 : 1 })
          for (var i = 0; i < sorted.length; i++) {
            var n = sorted[i]
            var isActive = n.id === selectedId
            items.push(
              React.createElement('div', {
                key: n.id,
                onClick: function() { handleSelectNote(n.id) },
                style: {
                  padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid ' + C.border,
                  backgroundColor: isActive ? C.activeBg : 'transparent',
                  transition: 'background 0.15s ease',
                },
              },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' } },
                  React.createElement('span', { style: { fontSize: '12px' } }, statusIcon(n.status)),
                  React.createElement('span', { style: { fontSize: '13px', fontWeight: '500', color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, n.title || '未命名')
                ),
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: C.textSecondary } },
                  React.createElement('span', null, formatDate(n.date)),
                  n.duration ? React.createElement('span', null, formatTime(n.duration)) : null
                )
              )
            )
          }
          return items
        }

        // ── Render detail ──
        function renderDetail() {
          if (!selectedNote) return renderEmptyState()

          var note = selectedNote
          var hasSummary = note.summary && note.summary.length > 0
          var hasKeyPoints = note.keyPoints && note.keyPoints.length > 0
          var hasActions = note.actionItems && note.actionItems.length > 0

          return React.createElement('div', { style: { flex: 1, overflow: 'auto', padding: '20px' } },
            // Title
            React.createElement('div', { style: { fontSize: '18px', fontWeight: '600', color: C.text, marginBottom: '4px' } }, note.title || '未命名'),
            React.createElement('div', { style: { fontSize: '12px', color: C.textSecondary, marginBottom: '16px' } },
              formatDate(note.date) + (note.duration ? ' · ' + formatTime(note.duration) : '') + ' · ' + statusLabel(note.status)
            ),
            // Actions
            React.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' } },
              note.status === 'completed' || note.status === 'idle'
                ? React.createElement('button', {
                    onClick: function() { handleSummarize(note.id) },
                    style: Object.assign({}, btnStyle, { backgroundColor: C.primaryLight, color: C.primary }),
                  }, '🤖 生成摘要')
                : null,
              note.status === 'summarizing'
                ? React.createElement('span', { style: Object.assign({}, btnStyle, { backgroundColor: C.warningLight, color: C.warning, cursor: 'default' }) }, '⏳ 生成中...')
                : null,
              React.createElement('button', {
                onClick: function() { handleDeleteNote(note.id) },
                style: Object.assign({}, btnStyle, { backgroundColor: C.dangerLight, color: C.danger }),
              }, '🗑 删除'),
            ),
            // Summary
            hasSummary
              ? React.createElement('div', { style: { marginBottom: '16px', animation: 'fadeIn 0.3s ease' } },
                  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' } },
                    React.createElement('span', { style: { fontSize: '14px' } }, '📋'),
                    React.createElement('span', { style: { fontSize: '13px', fontWeight: '600', color: C.text } }, '摘要')
                  ),
                  React.createElement('div', { style: { fontSize: '13px', lineHeight: '1.7', color: C.text, padding: '12px 14px', backgroundColor: C.card, borderRadius: '8px', border: '1px solid ' + C.border } }, note.summary)
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

        // ── Main render ──
        if (!isOverlayVisible) return null

        return React.createElement('div', { style: overlayStyle },
          // Header
          React.createElement('div', { style: headerStyle },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              React.createElement('span', { style: { fontSize: '18px' } }, '🎙'),
              React.createElement('span', { style: { fontSize: '15px', fontWeight: '600', color: C.text } }, '会议听记'),
              recStatus === 'recording'
                ? React.createElement('span', { style: { fontSize: '11px', color: C.danger, animation: 'pulse 1.5s infinite' } }, '● 录音中')
                : null,
            ),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              recStatus === 'recording'
                ? React.createElement('span', { style: { fontSize: '12px', color: C.textSecondary, fontFamily: 'monospace' } }, formatTime(elapsed))
                : null,
              recStatus === 'recording'
                ? React.createElement('button', { onClick: stopRecording, style: Object.assign({}, btnStyle, { backgroundColor: C.danger, color: '#fff' }) }, '⏹ 停止')
                : React.createElement('button', { onClick: handleNewRecording, style: Object.assign({}, btnStyle, { backgroundColor: C.primary, color: '#fff' }) }, '🎤 新听记'),
              React.createElement('button', { onClick: handleClose, style: Object.assign({}, btnStyle, { backgroundColor: 'transparent', color: C.textSecondary, fontSize: '18px' }) }, '✕'),
            ),
          ),
          // Body
          React.createElement('div', { style: bodyStyle },
            // Sidebar
            React.createElement('div', { style: sidebarStyle },
              React.createElement('div', { style: { padding: '8px', borderBottom: '1px solid ' + C.border } },
                React.createElement('button', { onClick: handleNewRecording, style: Object.assign({}, btnStyle, { backgroundColor: C.primary, color: '#fff', width: '100%', justifyContent: 'center', padding: '8px 0' }) }, '🎤 新录音'),
              ),
              React.createElement('div', { style: { flex: 1, overflow: 'auto' } },
                notes.length === 0
                  ? React.createElement('div', { style: { padding: '20px', textAlign: 'center', color: C.textSecondary, fontSize: '13px' } }, '暂无听记记录')
                  : renderNoteList()
              ),
            ),
            // Main
            React.createElement('div', { style: mainStyle },
              renderDetail()
            ),
          ),
        )
      }

      // ── Register sidebar.footer.action entry (beside Settings gear) ──
      // The sidebar.footer.action slot is dynamically added by the sidebar component,
      // so it may not be declared yet during apply(). Use ctx.effect() to defer.
      ctx.effect(function() {
        try {
          slots.register({ name: 'sidebar.footer.action', id: '听记', order: 10, label: '听记' }, function() {
            return React.createElement(SidebarEntry)
          })
          console.log('[meeting-notes] Sidebar footer action registered')
        } catch (e) {
          console.warn('[meeting-notes] Failed to register sidebar footer action:', e.message)
        }
      })

      // ── Register overlay in shell.overlay slot ──
      // shell.overlay is a root-level slot, always declared
      try {
        slots.register({ name: 'shell.overlay', id: 'meeting-notes', order: 10, label: '听记' }, function() {
          return React.createElement(MeetingNotesApp)
        })
        console.log('[meeting-notes] Overlay registered in shell.overlay')
      } catch (e) {
        console.warn('[meeting-notes] Failed to register overlay:', e.message)
      }
    }

    return exports
  }
})