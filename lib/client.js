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

      var sharedData = { notes: [], stats: { formattedDuration: '0:00', speakingTurns: 0, totalNotes: 0, totalActionItems: 0, totalKeyPoints: 0, hasFinalSummary: false } }
      var updateComponent = null
      var pollDisposer = null

      function startPolling() {
        stopPolling()
        pollDisposer = ctx.timer.interval(function() {
          Promise.all([
            host.call('meeting-notes:get-notes', {}),
            host.call('meeting-notes:get-status', {}),
          ]).then(function(results) {
            sharedData = { notes: results[0] || [], stats: results[1] || sharedData.stats }
            if (updateComponent) updateComponent(sharedData)
          }).catch(function() {})
        }, 2000)
      }

      function stopPolling() {
        if (pollDisposer) { pollDisposer(); pollDisposer = null }
      }

      function wait(ms) { return ctx.timer.timeout(ms) }

      ctx.effect(function() { return function() { stopPolling() } }, 'meeting-notes: poll cleanup')

      function createAudioCapture() {
        var audioContext = null, micStream = null, displayStream = null
        var micSource = null, displaySource = null, dest = null, isActive = false
        return {
          get isActive() { return isActive },
          async start(options) {
            if (isActive) throw new Error('Already active')
            isActive = true
            try {
              micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
              if (options && options.includeSystemAudio) {
                try {
                  displayStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 1, height: 1 } })
                  if (displayStream.getVideoTracks) displayStream.getVideoTracks().forEach(function(t) { t.stop() })
                } catch (e) { displayStream = null }
              }
              var AudioContextClass = window.AudioContext || window.webkitAudioContext
              if (!AudioContextClass) return micStream
              audioContext = new AudioContextClass()
              var sources = []
              if (micStream) { micSource = audioContext.createMediaStreamSource(micStream); sources.push(micSource) }
              if (displayStream) { displaySource = audioContext.createMediaStreamSource(displayStream); sources.push(displaySource) }
              dest = audioContext.createMediaStreamDestination()
              sources.forEach(function(s) { s.connect(dest) })
              return dest.stream
            } catch (error) { isActive = false; throw error }
          },
          stop() {
            isActive = false
            if (micSource) { try { micSource.disconnect() } catch {} micSource = null }
            if (displaySource) { try { displaySource.disconnect() } catch {} displaySource = null }
            if (micStream) { micStream.getTracks().forEach(function(t) { t.stop() }); micStream = null }
            if (displayStream) { displayStream.getTracks().forEach(function(t) { t.stop() }); displayStream = null }
            if (audioContext) { try { audioContext.close() } catch {} audioContext = null }
            dest = null
          }
        }
      }

      function createASR() {
        var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
        var isSupported = !!SpeechRecognition
        var recognition = null, isActive = false, onTranscriptCallback = null
        return {
          get isSupported() { return isSupported },
          get isActive() { return isActive },
          onTranscript(callback) { onTranscriptCallback = callback },
          async start(language) {
            if (isActive) return true
            if (!isSupported) return false
            try {
              recognition = new SpeechRecognition()
              recognition.continuous = true
              recognition.interimResults = true
              recognition.lang = language || 'zh-CN'
              recognition.maxAlternatives = 1
              recognition.onresult = function(event) {
                if (!onTranscriptCallback) return
                for (var i = event.resultIndex; i < event.results.length; i++) {
                  var result = event.results[i]
                  var text = result[0].transcript
                  onTranscriptCallback({ text: text, isFinal: result.isFinal })
                }
              }
              recognition.onerror = function(event) {
                console.warn('[meeting-notes] ASR error:', event.error)
                if (event.error === 'not-allowed') isActive = false
              }
              recognition.onend = function() {
                if (isActive && recognition) {
                  try { recognition.start() } catch (e) {}
                }
              }
              recognition.start()
              isActive = true
              return true
            } catch (error) {
              console.error('[meeting-notes] ASR start failed:', error.message)
              isActive = false
              return false
            }
          },
          stop() {
            isActive = false
            if (recognition) {
              try { recognition.stop() } catch {}
              try { recognition.abort() } catch {}
              recognition = null
            }
          }
        }
      }

      function MeetingNotesApp() {
        var _a = React.useState(sharedData), data = _a[0], setData = _a[1]
        var _b = React.useState('idle'), status = _b[0], setStatus = _b[1]
        var _c = React.useState(''), liveTranscript = _c[0], setLiveTranscript = _c[1]
        var _d = React.useState(''), interimText = _d[0], setInterimText = _d[1]
        var audioCaptureRef = React.useRef(null), asrRef = React.useRef(null)

        React.useEffect(function() {
          updateComponent = function(newData) { setData({ notes: newData.notes, stats: newData.stats }) }
          return function() { updateComponent = null }
        }, [])
        React.useEffect(function() {
          audioCaptureRef.current = createAudioCapture(); asrRef.current = createASR()
          return function() {
            if (audioCaptureRef.current) audioCaptureRef.current.stop()
            if (asrRef.current) asrRef.current.stop()
          }
        }, [])

        async function handleStart() {
          try {
            var capture = audioCaptureRef.current; await capture.start({ includeSystemAudio: true })
            var asr = asrRef.current; var asrStarted = await asr.start('zh-CN')
            if (!asrStarted) console.log('[meeting-notes] ASR not available, demo mode')
            asr.onTranscript(function(result) {
              if (result.isFinal) {
                setLiveTranscript(function(prev) { return prev + result.text + ' ' }); setInterimText('')
                host.call('meeting-notes:add-transcript', { text: result.text, timestamp: Date.now(), isFinal: true }).catch(function() {})
              } else { setInterimText(result.text) }
            })
            var statusData = await host.call('meeting-notes:start', {})
            if (statusData) { setStatus('running'); startPolling() }
          } catch (error) {
            console.error('[meeting-notes] Start failed:', error.message)
            if (audioCaptureRef.current) audioCaptureRef.current.stop()
            if (asrRef.current) asrRef.current.stop()
          }
        }

        async function handlePause() {
          if (status === 'running') {
            asrRef.current.stop()
            var statusData = await host.call('meeting-notes:pause', {}); if (statusData) setStatus('paused')
          } else if (status === 'paused') {
            await asrRef.current.start('zh-CN')
            asrRef.current.onTranscript(function(result) {
              if (result.isFinal) {
                setLiveTranscript(function(prev) { return prev + result.text + ' ' }); setInterimText('')
                host.call('meeting-notes:add-transcript', { text: result.text, timestamp: Date.now(), isFinal: true }).catch(function() {})
              } else { setInterimText(result.text) }
            })
            var statusData2 = await host.call('meeting-notes:resume', {}); if (statusData2) setStatus('running')
          }
        }

        async function handleStop() {
          if (asrRef.current) asrRef.current.stop(); if (audioCaptureRef.current) audioCaptureRef.current.stop()
          stopPolling()
          var statusData = await host.call('meeting-notes:stop', {}); if (statusData) setStatus('stopped')
          await wait(1000)
          try {
            var notesData = await host.call('meeting-notes:get-notes', {})
            var statusData2 = await host.call('meeting-notes:get-status', {})
            if (notesData) setData(function(prev) { return { notes: notesData, stats: prev.stats } })
            if (statusData2) setData(function(prev) { return { notes: prev.notes, stats: statusData2 } })
          } catch (e) {}
        }

        function renderStatItem(v, l, c) { return React.createElement('div', { style: { display:'flex', flexDirection:'column', alignItems:'center', minWidth:'80px', padding:'8px 12px', borderRadius:'8px', backgroundColor:C.bg } }, React.createElement('div', { style: { fontSize:'20px', fontWeight:'700', color:c, lineHeight:'1.3' } }, String(v)), React.createElement('div', { style: { fontSize:'11px', color:C.textSecondary, marginTop:'2px', whiteSpace:'nowrap' } }, l)) }

        function renderNoteCard(note, isFinal) {
          var cs = isFinal ? { backgroundColor:C.primaryLight, border:'2px solid '+C.primary, borderRadius:'10px', padding:'16px 20px', boxShadow:'0 2px 8px '+C.shadow } : { backgroundColor:C.card, borderRadius:'10px', padding:'14px 16px', boxShadow:'0 1px 3px '+C.shadow, border:'1px solid '+C.border, animation:'fadeIn 0.3s ease' }
          var ts = ''; try { var d = new Date(note.timestamp); ts = d.toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }) } catch (e) {}
          var ch = []; ch.push(React.createElement('div', { key:'h', style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' } }, React.createElement('div', { style: isFinal ? { fontSize:'16px', fontWeight:'700', color:C.primary } : { fontSize:'14px', fontWeight:'700', color:C.primary } }, isFinal ? '📋 完整会议纪要' : '📝 会议片段'), React.createElement('div', { style:{ fontSize:'11px', color:C.textSecondary } }, ts)))
          ch.push(React.createElement('div', { key:'s', style:{ backgroundColor:C.primaryLight, borderRadius:'6px', padding:'10px 12px', marginBottom:'8px' } }, React.createElement('div', { style:{ fontSize:'11px', fontWeight:'600', color:C.primary, marginBottom:'4px' } }, '📌 摘要'), React.createElement('div', { style:{ fontSize:'13px', color:C.text, lineHeight:'1.5' } }, note.summary)))
          if (note.key_points && note.key_points.length > 0) { var kpc = [React.createElement('div', { key:'l', style:{ fontSize:'11px', fontWeight:'600', color:C.success, marginBottom:'4px' } }, '✅ 关键要点')]; note.key_points.forEach(function(p,i) { kpc.push(React.createElement('div', { key:i, style:{ fontSize:'13px', color:C.text, lineHeight:'1.5', padding:'2px 0 2px 16px', position:'relative' } }, React.createElement('div', { style:{ position:'absolute', left:'4px', top:'8px', width:'6px', height:'6px', borderRadius:'50%', backgroundColor:C.success } }), p)) }); ch.push(React.createElement('div', { key:'kp', style:{ marginBottom:'8px' } }, ...kpc)) }
          if (note.action_items && note.action_items.length > 0) { var aic = [React.createElement('div', { key:'l', style:{ fontSize:'11px', fontWeight:'600', color:C.orange, marginBottom:'4px' } }, '⏰ 待办事项')]; note.action_items.forEach(function(p,i) { aic.push(React.createElement('div', { key:i, style:{ fontSize:'13px', color:C.text, lineHeight:'1.5', padding:'2px 0 2px 20px', position:'relative' } }, React.createElement('div', { style:{ position:'absolute', left:'2px', top:'6px', width:'12px', height:'12px', border:'2px solid '+C.orange, borderRadius:'3px' } }), p)) }); ch.push(React.createElement('div', { key:'ai', style:{ marginBottom:0 } }, ...aic)) }
          return React.createElement('div', { key:note.id, style:cs }, ...ch)
        }

        var stats = data.stats, notes = data.notes, finalNote = null, regularNotes = []
        for (var i = 0; i < notes.length; i++) { if (notes[i].isFinal) { finalNote = notes[i]; break } }
        for (var j = 0; j < notes.length; j++) { if (!notes[j].isFinal) regularNotes.push(notes[j]) }
        var isRunning = status === 'running', isPaused = status === 'paused', isIdle = status === 'idle', isStopped = status === 'stopped'
        var tlc = []; if (finalNote) tlc.push(renderNoteCard(finalNote, true))
        if (regularNotes.length === 0 && !finalNote && isIdle && !isRunning && !isStopped) { tlc.push(React.createElement('div', { key:'e', style:{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'40px 20px', color:C.textSecondary } }, React.createElement('div', { style:{ fontSize:'48px', marginBottom:'12px', opacity:0.3 } }, '🎤'), React.createElement('div', { style:{ fontSize:'14px', textAlign:'center', lineHeight:'1.6' } }, '点击「开始听记」按钮开始会议记录', React.createElement('br'), '将自动采集麦克风音频并生成纪要'))) }
        if (regularNotes.length === 0 && isRunning) { tlc.push(React.createElement('div', { key:'r', style:{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'20px', color:C.textSecondary } }, React.createElement('div', { style:{ fontSize:'32px', marginBottom:'12px', opacity:0.5 } }, '⏳'), React.createElement('div', { style:{ fontSize:'13px', textAlign:'center', lineHeight:'1.6' } }, '正在录音中，请说话…', React.createElement('br'), '转写文本达到一定长度后将自动生成纪要'))) }
        if (isStopped && regularNotes.length === 0 && !finalNote) { tlc.push(React.createElement('div', { key:'s', style:{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'40px 20px', color:C.textSecondary } }, React.createElement('div', { style:{ fontSize:'48px', marginBottom:'12px', opacity:0.3 } }, '📋'), React.createElement('div', { style:{ fontSize:'14px', textAlign:'center', lineHeight:'1.6' } }, '会议已结束，未生成纪要内容', React.createElement('br'), '请开始新的会议记录'))) }
        for (var k = regularNotes.length - 1; k >= 0; k--) { tlc.push(renderNoteCard(regularNotes[k], false)) }

        return React.createElement('div', { style:{ display:'flex', flexDirection:'column', height:'100%', backgroundColor:C.bg, fontFamily:'-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Noto Sans SC\", sans-serif', fontSize:'14px', color:C.text, overflow:'hidden' } },
          React.createElement('div', { style:{ display:'flex', gap:'12px', padding:'12px 16px', backgroundColor:C.card, borderBottom:'1px solid '+C.border, flexWrap:'wrap' } }, renderStatItem(stats.formattedDuration,'总时长',C.primary), renderStatItem(stats.speakingTurns,'纪要轮次',C.success), renderStatItem(stats.totalKeyPoints,'要点总数',C.warning), renderStatItem(stats.totalActionItems,'待办数',C.orange)),
          React.createElement('div', { style:{ flex:'1', overflowY:'auto', padding:'12px 16px', display:'flex', flexDirection:'column', gap:'12px' } }, ...tlc),
          (isRunning || isPaused) && React.createElement('div', { style:{ backgroundColor:C.transcriptBg, borderTop:'1px solid '+C.border, padding:'10px 16px', maxHeight:'120px', overflowY:'auto', flexShrink:0 } }, React.createElement('div', { style:{ fontSize:'11px', fontWeight:'600', color:C.textSecondary, marginBottom:'4px' } }, isRunning ? '🎙️ 实时转写' : '⏸️ 已暂停'), React.createElement('div', { style:{ fontSize:'13px', color:C.textSecondary, lineHeight:'1.5', fontStyle:'italic' } }, liveTranscript || '(等待语音输入…)', interimText && React.createElement('span', { style:{ color:C.textSecondary, opacity:0.7 } }, interimText))),
          React.createElement('div', { style:{ display:'flex', gap:'8px', padding:'10px 16px', backgroundColor:C.card, borderTop:'1px solid '+C.border, flexShrink:0 } },
            (isIdle || isStopped) && React.createElement('button', { key:'s', style:{ flex:'1', padding:'8px 16px', border:'none', borderRadius:'6px', fontSize:'13px', fontWeight:'600', cursor:'pointer', outline:'none', backgroundColor:C.success, color:'#fff' }, onClick:handleStart }, '🎤 开始听记'),
            (isRunning || isPaused) && React.createElement('button', { key:'p', style:{ flex:'1', padding:'8px 16px', border:'none', borderRadius:'6px', fontSize:'13px', fontWeight:'600', cursor:'pointer', outline:'none', backgroundColor:isRunning ? C.warning : C.success, color:isRunning ? C.text : '#fff' }, onClick:handlePause }, isRunning ? '⏸️ 暂停' : '▶️ 继续'),
            (isRunning || isPaused) && React.createElement('button', { key:'t', style:{ flex:'1', padding:'8px 16px', border:'none', borderRadius:'6px', fontSize:'13px', fontWeight:'600', cursor:'pointer', outline:'none', backgroundColor:C.danger, color:'#fff' }, onClick:handleStop }, '⏹️ 结束并生成完整纪要')
          )
        )
      }

      slots.inject('conversation.view', function() { return slots.register({ name:'conversation.view', id:'meeting-notes', label:'会议听记' }, function(p) { return React.createElement(MeetingNotesApp, null) }) })

      // Settings section
      function MeetingNotesSettings(props) {
        var _a = React.useState(''), keyInput = _a[0], setKey = _a[1]
        var _b = React.useState('加载中…'), st = _b[0], setSt = _b[1]
        var _c = React.useState(false), sv = _c[0], setSv = _c[1]
        React.useEffect(function() { host.call('meeting-notes:get-status', {}).then(function(s) { setSt(s && s.apiKeyConfigured ? '✅ 已配置 DeepSeek API Key' : '⚠️ 未配置 API Key（使用 Demo 模式）') }).catch(function() {}) }, [])
        async function handleSave() { if (!keyInput.trim()) return; setSv(true); try { await host.call('meeting-notes:save-config', { apiKey: keyInput.trim() }); setSt('✅ 已保存，请重启插件生效'); setKey('') } catch (e) { setSt('❌ 保存失败: ' + e.message) }; setSv(false) }
        return React.createElement('div', { style:{ padding:'24px', maxWidth:'600px' } },
          React.createElement('h2', { style:{ fontSize:'18px', fontWeight:'700', marginBottom:'16px', color:C.text } }, '会议听记设置'),
          React.createElement('div', { style:{ marginBottom:'16px', padding:'12px 16px', backgroundColor:st.includes('已配置') ? C.successLight : C.warningLight, borderRadius:'8px', border:'1px solid ' + (st.includes('已配置') ? C.success : C.warning) } }, React.createElement('div', { style:{ fontSize:'14px', fontWeight:'600', marginBottom:'4px', color:C.text } }, '状态'), React.createElement('div', { style:{ fontSize:'13px', color:C.textSecondary } }, st)),
          React.createElement('div', { style:{ marginBottom:'16px' } }, React.createElement('label', { style:{ display:'block', fontSize:'13px', fontWeight:'600', marginBottom:'6px', color:C.text } }, 'DeepSeek API Key'), React.createElement('input', { style:{ width:'100%', padding:'8px 12px', border:'1px solid '+C.border, borderRadius:'6px', fontSize:'14px', boxSizing:'border-box', outline:'none' }, type:'password', placeholder:'输入你的 DeepSeek API Key', value:keyInput, onChange:function(e) { setKey(e.target.value) } }), React.createElement('div', { style:{ fontSize:'11px', color:C.textSecondary, marginTop:'4px' } }, '不设置则使用 DEEPSEEK_API_KEY 环境变量')),
          React.createElement('button', { style:{ padding:'8px 20px', border:'none', borderRadius:'6px', fontSize:'14px', fontWeight:'600', cursor:sv?'wait':'pointer', backgroundColor:C.primary, color:'#fff', opacity:sv?0.6:1 }, onClick:handleSave, disabled:sv }, sv ? '保存中…' : '保存 API Key'),
          React.createElement('div', { style:{ marginTop:'24px', padding:'16px', backgroundColor:C.bg, borderRadius:'8px', fontSize:'13px', color:C.textSecondary, lineHeight:'1.6' } },
            React.createElement('div', { style:{ fontWeight:'600', marginBottom:'8px', color:C.text } }, '配置说明'),
            React.createElement('div', null, '会议听记插件支持三种方式配置 API Key（优先级从高到低）：'),
            React.createElement('ol', { style:{ paddingLeft:'20px', marginTop:'6px' } }, React.createElement('li', null, '在此页面输入并保存'), React.createElement('li', null, '在 cordis.yml 中配置 config.apiKey'), React.createElement('li', null, '设置环境变量 DEEPSEEK_API_KEY')),
            React.createElement('div', { style:{ marginTop:'8px', color:C.warning } }, '注意：通过此页面保存的 API Key 仅在当前会话有效，重启后需重新设置。')
          )
        )
      }

      slots.inject('settings.section', function() { return slots.register({ name:'settings.section', id:'meeting-notes', order:50, label:'会议听记' }, function(p) { return React.createElement(MeetingNotesSettings, { close:p.close }) }) })
      console.log('[meeting-notes-client] UI registered in conversation.view and settings.section')
    }

    return exports
  }
})