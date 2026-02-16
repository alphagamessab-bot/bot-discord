const express = require('express');
const app = express();

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    
    next();
});

app.use(express.json());

// KONFIGURACJA
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
    console.error('❌ Brak zmiennych środowiskowych!');
    process.exit(1);
}

// STAN APLIKACJI (w pamięci serwera - działa dla wszystkich)
let serverState = {
    accessCode: 'WbC84nGF',  // Domyślny kod
    codeVersion: 0,
    activeMessageId: null,
    activeCodeType: null,
    lastChanged: Date.now(),
    changedBy: 'system'
};

// ============================================================
// ENDPOINTY DLA KODU DOSTĘPOWEGO (REALTIME SYNC)
// ============================================================

// Pobierz aktualny kod
app.get('/api/code', (req, res) => {
    res.json({
        accessCode: serverState.accessCode,
        version: serverState.codeVersion,
        lastChanged: serverState.lastChanged,
        changedBy: serverState.changedBy
    });
});

// Zmień kod (tylko admin)
app.post('/api/code', (req, res) => {
    const { newCode, adminCode, changedBy } = req.body;
    
    // Weryfikacja kodu admina (taki sam jak w frontendzie)
    const ADMIN_CODE = 'OuO#()De@!VE';
    
    if (adminCode !== ADMIN_CODE) {
        return res.status(403).json({ success: false, error: 'Nieprawidłowy kod admina' });
    }
    
    if (!newCode || newCode.length < 4) {
        return res.status(400).json({ success: false, error: 'Kod musi mieć min. 4 znaki' });
    }
    
    serverState.accessCode = newCode.toUpperCase();
    serverState.codeVersion++;
    serverState.lastChanged = Date.now();
    serverState.changedBy = changedBy || 'admin';
    
    console.log('[API] Zmieniono kod na:', serverState.accessCode, 'v' + serverState.codeVersion);
    
    res.json({
        success: true,
        accessCode: serverState.accessCode,
        version: serverState.codeVersion
    });
});

// ============================================================
// ENDPOINTY DLA KODÓW ZAGROŻENIA (REALTIME SYNC)
// ============================================================

// Pobierz aktualny kod zagrożenia
app.get('/api/threat', (req, res) => {
    res.json({
        codeType: serverState.activeCodeType,
        messageId: serverState.activeMessageId,
        since: serverState.lastChanged
    });
});

// ============================================================
// DISCORD - KODY ZAGROŻENIA
// ============================================================

app.post('/send-threat', async (req, res) => {
    console.log('[POST] Otrzymano:', req.body);
    
    const { codeType, officer } = req.body;
    
    const codes = {
        green: { name: 'KOD ZIELONY', color: 0x22c55e, emoji: '🟢', desc: 'Sytuacja stabilna w mieście, standardowy pościg bez podwyższonego ryzyka lub brak zagrożenia terrorystycznego w mieście.' },
        orange: { name: 'KOD POMARAŃCZOWY', color: 0xf97316, emoji: '🟠', desc: 'Zwiększone ryzyko w mieście. Podczas pościgu oznacza autoryzację do wykonywania manewrów PIT (spychani, taranowanie) poza miastem. Może oznaczać zwiększenie liczebności rabunków bądź większego zagrożenia.' },
        red: { name: 'KOD CZERWONY', color: 0xef4444, emoji: '🔴', desc: 'Wysokie zagrożenie. Autoryzacja do zniszczenia opon pojazdu (strzały w opony). W mieście oznacza zwiększone zagrożenie terrorystyczne (np: Porwanie Policjanta).' },
        black: { name: 'KOD CZARNY', color: 0x1f2937, emoji: '⚫', desc: 'Ekstremalne zagrożenie. Autoryzacja na użycie broni palnej w kierunku napastników. W mieście oznacza duże prawdopodobieństwo lub trwający atak terrorystyczny (np: Porwanie wielu obywateli bądź osób publicznych).' }
    };
    
    const code = codes[codeType];
    if (!code) return res.status(400).json({ success: false, error: 'Zły kod' });
    
    try {
        const embed = {
            title: `${code.emoji} ${code.name}`,
            description: code.desc,
            color: code.color,
            fields: [
                { name: 'Autor zmiany', value: officer || 'Nieznany', inline: true },
                { name: 'Czas', value: new Date().toLocaleString('pl-PL'), inline: true }
            ],
            footer: { text: 'System Kodów Zagrożenia - LASD' },
            timestamp: new Date().toISOString()
        };
        
        if (codeType === 'red') embed.fields.push({ name: '⚠️ Dopisek', value: 'Jednostki Policji Mogą Posiadać Broń Maszynową Krótką (np: MP7).', inline: false });
        if (codeType === 'black') embed.fields.push({ name: '⚠️ Dopisek', value: 'Jednostki Policji Mają autoryzację strzelać z broni palnej do napastników gdy jest zagrożenie życia.', inline: false });
        
        let isEdit = false;
        let response;
        
        // Jeśli mamy aktywną wiadomość - EDYTUJEMY
        if (serverState.activeMessageId) {
            console.log('[POST] Edytuję:', serverState.activeMessageId);
            response = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages/${serverState.activeMessageId}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ embeds: [embed] })
            });
            isEdit = true;
        } else {
            // Nowa wiadomość
            console.log('[POST] Wysyłam nową');
            response = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
                method: 'POST',
                headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ embeds: [embed] })
            });
        }
        
        if (!response.ok) {
            const err = await response.text();
            console.error('[POST] Błąd:', response.status, err);
            
            // Jeśli edycja nieudana (404), wyślij nową
            if (isEdit && response.status === 404) {
                console.log('[POST] Edycja nieudana, nowa...');
                serverState.activeMessageId = null;
                response = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ embeds: [embed] })
                });
                if (!response.ok) return res.status(500).json({ success: false, error: 'Błąd Discord' });
                isEdit = false;
            } else {
                return res.status(response.status).json({ success: false, error: err });
            }
        }
        
        const data = await response.json();
        
        // ZAPISZ STAN NA SERWERZE (dla wszystkich użytkowników)
        serverState.activeMessageId = data.id;
        serverState.activeCodeType = codeType;
        serverState.lastChanged = Date.now();
        
        console.log('[POST] Sukces! ID:', data.id, 'Typ:', codeType, 'Edycja:', isEdit);
        res.json({ success: true, messageId: data.id, isEdit: isEdit, codeType: codeType });
        
    } catch (e) {
        console.error('[POST] Wyjątek:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Usuń aktywny kod zagrożenia
app.delete('/delete-active', async (req, res) => {
    if (!serverState.activeMessageId) {
        return res.json({ success: true, message: 'Brak aktywnego kodu' });
    }
    
    try {
        const response = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages/${serverState.activeMessageId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }
        });
        
        serverState.activeMessageId = null;
        serverState.activeCodeType = null;
        
        res.json({ success: true, status: response.status });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('========================================');
    console.log('✅ Serwer działa na porcie ' + PORT);
    console.log('📺 Kanał Discord:', DISCORD_CHANNEL_ID);
    console.log('🔑 Kod dostępu:', serverState.accessCode);
    console.log('🌐 CORS: WŁĄCZONY');
    console.log('========================================');
});
