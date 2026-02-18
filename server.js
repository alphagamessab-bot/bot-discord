const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const app = express();

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
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

// PLIK DO PRZECHOWYWANIA STANU
const STATE_FILE = path.join(__dirname, 'server-state.json');

// Domyślny stan (TYLKO PRZY PIERWSZYM URUCHOMIENIU)
const DEFAULT_STATE = {
    accessCode: 'CHILLRP',  // ZMIENIONY DOMYŚLNY KOD
    codeVersion: 0,
    activeMessageId: null,
    activeCodeType: null,
    lastChanged: Date.now(),
    changedBy: 'system'
};

// Wczytaj stan z pliku lub utwórz domyślny
async function loadState() {
    try {
        const data = await fs.readFile(STATE_FILE, 'utf8');
        const state = JSON.parse(data);
        console.log('✅ Stan wczytany z pliku:', state.accessCode);
        return state;
    } catch (e) {
        console.log('📝 Tworzę nowy plik stanu z kodem:', DEFAULT_STATE.accessCode);
        await saveState(DEFAULT_STATE);
        return DEFAULT_STATE;
    }
}

// Zapisz stan do pliku
async function saveState(state) {
    try {
        await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
        console.error('❌ Błąd zapisu stanu:', e);
    }
}

// Globalny stan (wczytywany przy starcie)
let serverState = DEFAULT_STATE;

// Inicjalizacja przy starcie
loadState().then(state => { serverState = state; });

// ============================================================
// ENDPOINTY DLA KODU DOSTĘPOWEGO
// ============================================================

app.get('/api/code', (req, res) => {
    res.json({
        accessCode: serverState.accessCode,
        version: serverState.codeVersion,
        lastChanged: serverState.lastChanged,
        changedBy: serverState.changedBy
    });
});

app.post('/api/code', async (req, res) => {
    const { newCode, adminCode, changedBy } = req.body;
    const ADMIN_CODE = 'OuO#()De@!VE';
    
    if (adminCode !== ADMIN_CODE) {
        return res.status(403).json({ success: false, error: 'Nieprawidłowy kod admina' });
    }
    
    if (!newCode || newCode.length < 4) {
        return res.status(400).json({ success: false, error: 'Kod musi mieć min. 4 znaki' });
    }
    
    // Aktualizuj stan
    serverState.accessCode = newCode.toUpperCase();
    serverState.codeVersion++;
    serverState.lastChanged = Date.now();
    serverState.changedBy = changedBy || 'admin';
    
    // ZAPISZ DO PLIKU!
    await saveState(serverState);
    
    console.log('[API] Zmieniono kod na:', serverState.accessCode, 'v' + serverState.codeVersion);
    
    res.json({
        success: true,
        accessCode: serverState.accessCode,
        version: serverState.codeVersion
    });
});

// ============================================================
// ENDPOINTY DLA KODÓW ZAGROŻENIA
// ============================================================

app.get('/api/threat', (req, res) => {
    res.json({
        codeType: serverState.activeCodeType,
        messageId: serverState.activeMessageId,
        since: serverState.lastChanged,
        changedBy: serverState.changedBy
    });
});

// ============================================================
// DISCORD - KODY ZAGROŻENIA
// ============================================================

async function discordFetch(url, options) {
    const fetch = globalThis.fetch || require('node-fetch');
    return fetch(url, options);
}

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
        
        // Sprawdź czy mamy zapisaną wiadomość i czy nadal istnieje
        if (serverState.activeMessageId) {
            console.log('[POST] Próba edycji:', serverState.activeMessageId);
            response = await discordFetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages/${serverState.activeMessageId}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ embeds: [embed] })
            });
            
            // Jeśli 404 (wiadomość usunięta), wyślij nową
            if (response.status === 404) {
                console.log('[POST] Stara wiadomość nie istnieje, wysyłam nową');
                serverState.activeMessageId = null;
                response = await discordFetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ embeds: [embed] })
                });
                isEdit = false;
            } else {
                isEdit = true;
            }
        } else {
            // Nowa wiadomość
            console.log('[POST] Wysyłam nową wiadomość');
            response = await discordFetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
                method: 'POST',
                headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ embeds: [embed] })
            });
        }
        
        if (!response.ok) {
            const err = await response.text();
            console.error('[POST] Błąd Discord:', response.status, err);
            return res.status(response.status).json({ success: false, error: err });
        }
        
        const data = await response.json();
        
        // ZAPISZ STAN DO PLIKU!
        serverState.activeMessageId = data.id;
        serverState.activeCodeType = codeType;
        serverState.lastChanged = Date.now();
        serverState.changedBy = officer || 'system';
        await saveState(serverState);
        
        console.log('[POST] Sukces! ID:', data.id, 'Typ:', codeType, 'Edycja:', isEdit);
        res.json({ 
            success: true, 
            messageId: data.id, 
            isEdit: isEdit, 
            codeType: codeType,
            timestamp: serverState.lastChanged
        });
        
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
        const fetch = globalThis.fetch || require('node-fetch');
        const response = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages/${serverState.activeMessageId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }
        });
        
        serverState.activeMessageId = null;
        serverState.activeCodeType = null;
        serverState.lastChanged = Date.now();
        await saveState(serverState);
        
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
    console.log('💾 Zapis stanu: PLIK (trwały)');
    console.log('========================================');
});
