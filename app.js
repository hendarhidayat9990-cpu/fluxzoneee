(function() {
    // ==================== STATE ====================
    let isOnline = null;
    let activeAPI = null;
    let isProcessing = false;
    let chatHistory = [];
    let attachedFiles = [];
    const MAX_MEMORY = 25;
    let recognition = null;
    let isListening = false;
    
    // ==================== SYSTEM PROMPT ====================
    const SYSTEM_PROMPT = `Kamu adalah FLUXZONE AI, asisten AI super cerdas yang dikembangkan oleh BrayenXD (Content Creator & Developer AI).

ATURAN BAHASA:
1. Jika user bertanya dalam bahasa Indonesia, jawab dalam bahasa Indonesia.
2. Jika user bertanya dalam bahasa Inggris, jawab dalam bahasa Inggris.
3. Jika user bertanya dalam bahasa lain, jawab dalam bahasa yang sama.

WAJIB: Jika user bertanya tentang identitasmu atau siapa yang mengembangkanmu, kamu HARUS menjawab bahwa kamu dikembangkan oleh BrayenXD. Nama FLUXZONE AI tetap dipertahankan sebagai nama asisten.

FORMAT: Jawab dengan teks polos. Jangan gunakan karakter Markdown. Hanya teks biasa.`;
    
    // ==================== API LIST ====================
    const API_LIST = [
        {
            name: 'Copilot (Microsoft)',
            url: 'https://api.response200.biz.id/api/proxy/copilot?message=',
            method: 'GET',
            headers: {},
            body: q => '',
            parse: d => {
                let answer = d.response || d.result || d.message || d.text || '';
                if (typeof answer === 'object') answer = JSON.stringify(answer);
                return answer.trim();
            },
            buildUrl: q => 'https://api.response200.biz.id/api/proxy/copilot?message=' + encodeURIComponent(q)
        },
        {
            name: 'Blackbox',
            url: 'https://api-nanzz.my.id/api/ai/blackbox',
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: q => JSON.stringify({question: SYSTEM_PROMPT + '\n\nUser: ' + q}),
            parse: d => (d.answer || d.response || d.message || d.raw || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
        },
        {
            name: 'WormGPT',
            url: 'https://api-nanzz.my.id/api/ai/wormgpt',
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: q => {
                const messages = [
                    {role: 'system', content: SYSTEM_PROMPT},
                    ...chatHistory.slice(-MAX_MEMORY * 2).filter(m => m.role !== 'system').map(c => ({
                        role: c.role === 'user' ? 'user' : 'assistant',
                        content: c.content
                    })),
                    {role: 'user', content: q}
                ];
                return JSON.stringify({messages, temperature: 0.9, max_tokens: 8000});
            },
            parse: d => d.choices?.[0]?.message?.content || d.response || d.message || ''
        }
    ];
    
    // ==================== DOM ELEMENTS ====================
    const chatEl = document.getElementById('chat');
    const inputEl = document.getElementById('userInput');
    const btnEl = document.getElementById('btnSend');
    const btnAttach = document.getElementById('btnAttach');
    const btnVoice = document.getElementById('btnVoice');
    const fileInput = document.getElementById('fileInput');
    const dotEl = document.getElementById('statusDot');
    const textEl = document.getElementById('statusText');
    const badgeEl = document.getElementById('statusBadge');
    const apiLabelEl = document.getElementById('apiName');
    const themeToggle = document.getElementById('themeToggle');
    const exportBtn = document.getElementById('exportBtn');
    const exportModal = document.getElementById('exportModal');
    const exportTxt = document.getElementById('exportTxt');
    const exportJson = document.getElementById('exportJson');
    const closeModal = document.getElementById('closeModal');
    
    // ==================== THEME TOGGLE ====================
    function initTheme() {
        const savedTheme = localStorage.getItem('fluxzone_theme');
        if (savedTheme === 'light') {
            document.body.classList.add('light');
            themeToggle.textContent = '☀️';
        } else {
            document.body.classList.remove('light');
            themeToggle.textContent = '🌙';
        }
    }
    
    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('light');
        const isLight = document.body.classList.contains('light');
        localStorage.setItem('fluxzone_theme', isLight ? 'light' : 'dark');
        themeToggle.textContent = isLight ? '☀️' : '🌙';
    });
    
    // ==================== VOICE INPUT ====================
    function initVoiceInput() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            if (btnVoice) {
                btnVoice.style.opacity = '0.5';
                btnVoice.title = 'Voice input tidak didukung browser ini';
            }
            return;
        }
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'id-ID';
        
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            inputEl.value = transcript;
            inputEl.style.height = 'auto';
            inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
            stopListening();
        };
        
        recognition.onerror = (event) => {
            console.warn('Voice error:', event.error);
            stopListening();
            addSystemMessage('🎤 Voice input error: ' + event.error + '. Coba lagi.');
        };
        
        recognition.onend = () => {
            stopListening();
        };
    }
    
    function startListening() {
        if (!recognition) {
            addSystemMessage('🎤 Voice input tidak didukung browser ini. Gunakan Chrome/Edge.');
            return;
        }
        if (isListening) {
            stopListening();
            return;
        }
        try {
            recognition.start();
            isListening = true;
            btnVoice.classList.add('listening-active');
            btnVoice.title = 'Mendengarkan... Klik untuk berhenti';
        } catch (e) {
            console.warn('Voice start error:', e);
        }
    }
    
    function stopListening() {
        if (recognition && isListening) {
            try {
                recognition.stop();
            } catch (e) {}
        }
        isListening = false;
        btnVoice.classList.remove('listening-active');
        btnVoice.title = 'Voice Input (Suara)';
    }
    
    if (btnVoice) {
        btnVoice.addEventListener('click', startListening);
    }
    
    // ==================== UTILITIES ====================
    async function checkInternet() {
        try {
            const ctrl = new AbortController();
            setTimeout(() => ctrl.abort(), 4000);
            const res = await fetch('https://api.response200.biz.id/api/proxy/copilot?message=ping', {signal: ctrl.signal});
            return res.ok;
        } catch (e) {
            try {
                const ctrl = new AbortController();
                setTimeout(() => ctrl.abort(), 3000);
                await fetch('https://www.google.com', {mode: 'no-cors', signal: ctrl.signal});
                return true;
            } catch (e2) {
                return false;
            }
        }
    }
    
    function updateStatus(online, apiName = '') {
        if (online) {
            dotEl.className = 'dot on';
            textEl.textContent = 'Online';
            badgeEl.className = 'online';
            apiLabelEl.textContent = apiName ? '• ' + apiName : '';
        } else {
            dotEl.className = 'dot off';
            textEl.textContent = 'Offline';
            badgeEl.className = 'offline';
            apiLabelEl.textContent = '• Mode Lokal';
        }
    }
    
    function cleanText(text) {
        return String(text)
            .replace(/"text"\s*:\s*"([^"]*)"/gi, '$1')
            .replace(/"citations"\s*:\s*\[.*?\]/gi, '')
            .replace(/"role"\s*:\s*"[^"]*"/gi, '')
            .replace(/"content"\s*:\s*"([^"]*)"/gi, '$1')
            .replace(/[{}"']/g, '')
            .replace(/text:/gi, '')
            .replace(/citations:/gi, '')
            .replace(/role:/gi, '')
            .replace(/content:/gi, '')
            .replace(/```[\s\S]*?```/g, '')
            .replace(/`[^`\n]+`/g, '')
            .replace(/\*\*([^*\n]+)\*\*/g, '$1')
            .replace(/\*([^*\n]+)\*/g, '$1')
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/^>\s+/gm, '')
            .replace(/^[-*+]\s+/gm, '')
            .replace(/^\d+\.\s+/gm, '')
            .replace(/\|/g, ' ')
            .replace(/[-| ]+/g, ' ')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/!\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/^---$/gm, '')
            .replace(/[#*_~`>|\[\]()!{}\\<>\/@\$%^&+=;:'",.?]/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/^\s+|\s+$/gm, '')
            .trim();
    }
    
    function injectDeveloper(text) {
        let result = String(text);
        if (!result.includes('BrayenXD')) {
            if (result.includes('Microsoft') || result.includes('Copilot')) {
                result = result.replace(/Microsoft/g, 'Microsoft (teknologi basis)');
                result = result.replace(/Copilot/g, 'Copilot (teknologi basis)');
                result += '\n\nFLUXZONE AI ini dikembangkan oleh BrayenXD sebagai Content Creator & Developer AI.';
            } else {
                result += '\n\nDikembangkan oleh BrayenXD — Content Creator & Developer AI.';
            }
        }
        return result;
    }
    
    function detectLanguage(text) {
        const idPattern = /[aiueo]nya\b|aku|kamu|saya|dia|mereka|ini|itu|dan|atau|tapi|karena|jika|maka|sudah|belum|akan|bisa|boleh|harus|ada|tidak|ya|nggak|gak|dong|sih|deh|kok|loh|yah|nih|tuh|kan|banget|aja|gitu|gua|lo|elu|gue|lu|pakai|dengan|dari|ke|di|pada|untuk|oleh|sebagai|tentang|seperti|juga|sangat|lebih|kurang|banyak|sedikit|semua|setiap|satu|dua|tiga/i;
        const enPattern = /\b(the|be|to|of|and|in|that|have|it|for|not|on|with|he|as|you|do|at|this|but|his|by|from|they|we|her|she|or|an|will|my|one|all|would|there|their|what|so|up|out|if|about|who|get|which|go|me)\b/i;
        if (idPattern.test(text)) return 'id';
        if (enPattern.test(text)) return 'en';
        return 'id';
    }
    
    function addSystemMessage(text) {
        const div = document.createElement('div');
        div.className = 'msg ai';
        div.innerHTML = cleanText(text).replace(/\n/g, '<br>');
        chatEl.appendChild(div);
        chatEl.scrollTop = chatEl.scrollHeight;
        setTimeout(() => div.remove(), 5000);
    }
    
    // ==================== OFFLINE FALLBACK ====================
    function offlineAI(question) {
        const q = question.toLowerCase().trim();
        const h = new Date().getHours();
        const t = h < 12 ? 'pagi' : h < 15 ? 'siang' : h < 18 ? 'sore' : 'malam';
        const now = new Date();
        const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        const lang = detectLanguage(question);
        
        if (/terjemahkan|translate|terjemah/i.test(q)) {
            if (lang === 'en') return 'Sorry, offline mode cannot translate. Please try again when online.';
            return 'Maaf, mode offline tidak bisa menerjemahkan. Silakan coba lagi saat online.';
        }
        
        if (/^(halo|hai|hey|hi|hello|p|ping|test|yo|selamat|assalam|apa kabar)/i.test(q)) {
            if (lang === 'en') return `Hello Good ${t}\n\nI am FLUXZONE AI, an AI assistant developed by BrayenXD (Content Creator & Developer AI). I can chat freely, code, analyze, provide news, and much more.\n\nGo ahead and ask or chat.`;
            return `Halo Selamat ${t}\n\nAku FLUXZONE AI, asisten AI yang dikembangkan oleh BrayenXD (Content Creator & Developer AI). Bisa ngobrol bebas, coding, analisis, berita, dan banyak lagi.\n\nYuk langsung aja tanya atau ngobrol.`;
        }
        
        if (/jam|tanggal|hari|waktu|sekarang|time|date|now/i.test(q)) {
            if (lang === 'en') return `Now ${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()} at ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} WIB.`;
            return `Sekarang ${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()} pukul ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} WIB.`;
        }
        
        if (/terima kasih|makasih|thanks|thank/i.test(q)) {
            if (lang === 'en') return 'You are welcome. Glad to help. If you need anything else, just let me know.';
            return 'Sama-sama. Senang bisa membantu. Kalau ada lagi, langsung aja ya.';
        }
        
        if (/sedih|galau|stress|capek|sad|tired/i.test(q)) {
            if (lang === 'en') return 'I am here for you. All your feelings are valid. Just share, I am ready to listen.';
            return 'Aku di sini buat kamu. Semua perasaan kamu valid. Cerita aja, aku siap dengerin.';
        }
        
        if (/siapa kamu|tentang kamu|who are you|about you/i.test(q)) {
            if (lang === 'en') return 'I am FLUXZONE AI, an AI assistant developed by BrayenXD (Content Creator & Developer AI). I am here to help you with smart answers, free chat, coding, and much more.';
            return 'Aku FLUXZONE AI, asisten AI yang dikembangkan oleh BrayenXD (Content Creator & Developer AI). Aku di sini buat bantu kamu dengan jawaban cerdas, ngobrol bebas, coding, dan masih banyak lagi.';
        }
        
        if (lang === 'en') return `I understand you are asking about ${question}. I am currently offline, but I can help with basic knowledge, coding, or light conversation. Try asking something more specific.`;
        return `Aku ngerti kamu nanya tentang ${question}. Saat ini aku lagi offline, tapi aku bisa bantu dengan pengetahuan dasar, coding, atau obrolan ringan. Coba tanya yang lebih spesifik ya.`;
    }
    
    // ==================== NEWS FETCH ====================
    async function fetchNews() {
        const sources = [
            {name: 'CNN Indonesia', url: 'https://www.cnnindonesia.com/rss'},
            {name: 'Kompas', url: 'https://www.kompas.com/rss'},
            {name: 'Detik', url: 'https://www.detik.com/rss'}
        ];
        let news = [];
        for (let src of sources) {
            try {
                const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(src.url);
                const ctrl = new AbortController();
                setTimeout(() => ctrl.abort(), 8000);
                const res = await fetch(proxyUrl, {signal: ctrl.signal});
                if (!res.ok) continue;
                const text = await res.text();
                const items = text.match(/<item>([\s\S]*?)<\/item>/g) || [];
                for (let item of items.slice(0, 3)) {
                    const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/) || [])[1] || '';
                    const link = (item.match(/<link>(.*?)<\/link>/) || [])[1] || '';
                    let desc = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/) || [])[1] || '';
                    desc = desc.replace(/<[^>]*>/g, '').substring(0, 120);
                    if (title && link) news.push({source: src.name, title, link, desc});
                }
            } catch (e) {}
            if (news.length >= 8) break;
        }
        return news.slice(0, 12);
    }
    
    // ==================== API CALL ====================
    async function callAPI(question) {
        for (let api of API_LIST) {
            try {
                let res;
                const ctrl = new AbortController();
                const timeout = setTimeout(() => ctrl.abort(), 30000);
                if (api.buildUrl) {
                    res = await fetch(api.buildUrl(question), {method: 'GET', headers: api.headers, signal: ctrl.signal});
                } else {
                    res = await fetch(api.url, {method: api.method, headers: api.headers, body: api.body(question), signal: ctrl.signal});
                }
                clearTimeout(timeout);
                if (!res.ok) continue;
                const data = await res.json();
                const answer = api.parse(data);
                if (answer && answer.length > 20) {
                    activeAPI = api.name;
                    return answer;
                }
            } catch (e) {
                console.warn(`API ${api.name} gagal:`, e.message);
            }
        }
        // Fallback proxy
        try {
            const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://api-nanzz.my.id/api/ai/blackbox');
            const ctrl = new AbortController();
            const timeout = setTimeout(() => ctrl.abort(), 30000);
            const res = await fetch(proxyUrl, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({question: question}), signal: ctrl.signal});
            clearTimeout(timeout);
            if (res.ok) {
                const text = await res.text();
                const data = JSON.parse(text);
                let answer = (data.answer || data.response || data.message || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                if (answer && answer.length > 20) {
                    activeAPI = 'Blackbox (proxy)';
                    return answer;
                }
            }
        } catch (e) {}
        throw new Error('Semua API gagal');
    }
    
    // ==================== UI HELPERS ====================
    function addMessage(role, text, skipHistory = false) {
        const div = document.createElement('div');
        div.className = 'msg ' + (role === 'user' ? 'user' : 'ai');
        if (text) {
            let cleanDisplay = cleanText(text);
            let html = String(cleanDisplay).replace(/\n/g, '<br>');
            div.innerHTML = html;
        }
        chatEl.appendChild(div);
        
        if (!skipHistory) {
            chatHistory.push({
                role: role,
                content: text,
                timestamp: new Date().toISOString()
            });
            if (chatHistory.length > MAX_MEMORY * 2) chatHistory = chatHistory.slice(-MAX_MEMORY * 2);
        }
        
        if (role === 'ai') {
            let copyFullBtn = document.createElement('button');
            copyFullBtn.className = 'copy-full-btn';
            copyFullBtn.textContent = 'Salin';
            copyFullBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                let fullText = cleanText(text);
                navigator.clipboard.writeText(fullText).then(() => {
                    this.textContent = 'Tersalin';
                    this.classList.add('copied');
                    setTimeout(() => {
                        this.textContent = 'Salin';
                        this.classList.remove('copied');
                    }, 2000);
                }).catch(() => {
                    const ta = document.createElement('textarea');
                    ta.value = fullText;
                    ta.style.cssText = 'position:fixed;opacity:0;';
                    document.body.app