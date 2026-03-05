const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
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

// WYMAGANE dla połączenia z botem Python
const BOT_API_KEY = process.env.BOT_API_KEY || 'tajny-klucz-dla-bota';

if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
    console.error('❌ Brak zmiennych środowiskowych!');
    process.exit(1);
}

// SQLITE - baza danych w pliku
const db = new sqlite3.Database(path.join(__dirname, 'data.db'));

// Inicjalizacja bazy
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS server_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        accessCode TEXT DEFAULT 'CHILLRP',
        codeVersion INTEGER DEFAULT 0,
        activeMessageId TEXT,
        activeCodeType TEXT,
        lastChanged INTEGER,
        changedBy TEXT DEFAULT 'system'
    )`);
    
    db.get("SELECT COUNT(*) as count FROM server_state", (err, row) => {
        if (err) {
            console.error('Błąd sprawdzania tabeli:', err);
            return;
        }
        if (row.count === 0) {
            db.run(`INSERT INTO server_state (id, accessCode, codeVersion, lastChanged) 
                    VALUES (1, 'CHILLRP', 0, ?)`, [Date.now()], (err) => {
                if (err) console.error('Błąd wstawiania:', err);
                else console.log('📝 Utworzono domyślny stan z kodem: CHILLRP');
            });
        } else {
            db.get("SELECT accessCode, activeCodeType FROM server_state WHERE id = 1", (err, row) => {
                if (!err && row) {
                    console.log('✅ Wczytano kod dostępu:', row.accessCode);
                    console.log('✅ Aktywny kod zagrożenia:', row.activeCodeType || 'brak');
                }
            });
        }
    });
});

// Pomocnicze funkcje bazy danych
function getState() {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM server_state WHERE id = 1", (err, row) => {
            if (err) reject(err);
            else resolve(row || { 
                accessCode: 'CHILLRP', 
                codeVersion: 0, 
                activeMessageId: null, 
                activeCodeType: null, 
                lastChanged: Date.now(), 
                changedBy: 'system' 
            });
        });
    });
}

function updateState(updates) {
    return new Promise((resolve, reject) => {
        const keys = Object.keys(updates);
        const fields = keys.map(k => `${k} = ?`).join(', ');
        const values = keys.map(k => updates[k]);
        values.push(Date.now());
        
        const sql = `UPDATE server_state SET ${fields}, lastChanged = ? WHERE id = 1`;
        db.run(sql, values, function(err) {
            if (err) reject(err);
            else resolve();
        });
    });
}

// Middleware autoryzacji dla bota
function botAuth(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== BOT_API_KEY) {
        return res.status(403).json({ error: 'Brak autoryzacji' });
    }
    next();
}

// ============================================================
// ENDPOINTY PUBLICZNE (dla frontendu HTML)
// ============================================================

app.get('/api/code', async (req, res) => {
    try {
        const state = await getState();
        res.json({
            accessCode: state.accessCode,
            version: state.codeVersion,
            lastChanged: state.lastChanged,
            changedBy: state.changedBy
        });
    } catch (e) {
        console.error('Błąd /api/code:', e);
        res.status(500).json({ error: e.message });
    }
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
    
    try {
        const state = await getState();
        await updateState({
            accessCode: newCode.toUpperCase(),
            codeVersion: state.codeVersion + 1,
            changedBy: changedBy || 'admin'
        });
        
        console.log('[API] Zmieniono kod na:', newCode.toUpperCase(), 'v' + (state.codeVersion + 1));
        res.json({ 
            success: true, 
            accessCode: newCode.toUpperCase(), 
            version: state.codeVersion + 1 
        });
    } catch (e) {
        console.error('Błąd zmiany kodu:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Pobierz aktualny kod zagrożenia
app.get('/api/threat', async (req, res) => {
    try {
        const state = await getState();
        res.json({
            codeType: state.activeCodeType,
            messageId: state.activeMessageId,
            since: state.lastChanged,
            changedBy: state.changedBy
        });
    } catch (e) {
        console.error('Błąd /api/threat:', e);
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// ENDPOINTY DLA BOTA DISCORD (Python) - wymagają API key
// ============================================================

// Bot pyta o aktualny kod zagrożenia
app.get('/bot/threat', botAuth, async (req, res) => {
    try {
        const state = await getState();
        res.json({
            codeType: state.activeCodeType,
            since: state.lastChanged,
            changedBy: state.changedBy,
            messageId: state.activeMessageId
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Bot wysyła/aktualizuje kod zagrożenia
app.post('/bot/threat', botAuth, async (req, res) => {
    const { codeType, officer, messageId } = req.body;
    
    try {
        await updateState({
            activeCodeType: codeType,
            activeMessageId: messageId,
            changedBy: officer || 'bot'
        });
        
        console.log('[BOT API] Zapisano kod zagrożenia:', codeType, 'przez', officer);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Bot usuwa kod zagrożenia
app.delete('/bot/threat', botAuth, async (req, res) => {
    try {
        await updateState({
            activeCodeType: null,
            activeMessageId: null,
            changedBy: 'bot'
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// DISCORD - KODY ZAGROŻENIA (z frontendu HTML)
// ============================================================

async function discordFetch(url, options) {
    const fetch = globalThis.fetch || require('node-fetch');
    return fetch(url, options);
}

app.post('/send-threat', async (req, res) => {
    console.log('[POST] Otrzymano:', req.body);
    const { codeType, officer } = req.body;
    
    const codes = {
        green: { 
            name: 'KOD ZIELONY', 
            color: 0x22c55e, 
            emoji: '🟢', 
            desc: 'Sytuacja stabilna w mieście, standardowy pościg bez podwyższonego ryzyka lub brak zagrożenia terrorystycznego w mieście.' 
        },
        orange: { 
            name: 'KOD POMARAŃCZOWY', 
            color: 0xf97316, 
            emoji: '🟠', 
            desc: 'Zwiększone ryzyko w mieście. Podczas pościgu oznacza autoryzację do wykonywania manewrów PIT (spychani, taranowanie) poza miastem. Może oznaczać zwiększenie liczebności rabunków bądź większego zagrożenia.' 
        },
        red: { 
            name: 'KOD CZERWONY', 
            color: 0xef4444, 
            emoji: '🔴', 
            desc: 'Wysokie zagrożenie. Autoryzacja do zniszczenia opon pojazdu (strzały w opony). W mieście oznacza zwiększone zagrożenie terrorystyczne (np: Porwanie Policjanta).' 
        },
        black: { 
            name: 'KOD CZARNY', 
            color: 0x1f2937, 
            emoji: '⚫', 
            desc: 'Ekstremalne zagrożenie. Autoryzacja na użycie broni palnej w kierunku napastników. W mieście oznacza duże prawdopodobieństwo lub trwający atak terrorystyczny (np: Porwanie wielu obywateli bądź osób publicznych).' 
        }
    };
    
    const code = codes[codeType];
    if (!code) {
        return res.status(400).json({ success: false, error: 'Zły kod' });
    }
    
    try {
        const state = await getState();
        
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
        
        if (codeType === 'red') {
            embed.fields.push({ 
                name: '⚠️ Dopisek', 
                value: 'Jednostki Policji Mogą Posiadać Broń Maszynową Krótką (np: MP7).', 
                inline: false 
            });
        }
        if (codeType === 'black') {
            embed.fields.push({ 
                name: '⚠️ Dopisek', 
                value: 'Jednostki Policji Mają autoryzację strzelać z broni palnej do napastników gdy jest zagrożenie życia.', 
                inline: false 
            });
        }
        
        let isEdit = false;
        let response;
        let messageId = state.activeMessageId;
        
        // POPRAWIONY URL - bez spacji!
        const baseUrl = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}`;
        
        if (messageId) {
            console.log('[POST] Próba edycji wiadomości:', messageId);
            response = await discordFetch(`${baseUrl}/messages/${messageId}`, {
                method: 'PATCH',
                headers: { 
                    'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 
                    'Content-Type': 'application/json' 
                },
                body: JSON.stringify({ embeds: [embed] })
            });
            
            if (response.status === 404) {
                console.log('[POST] Wiadomość nie istnieje, wysyłam nową');
                response = await discordFetch(`${baseUrl}/messages`, {
                    method: 'POST',
                    headers: { 
                        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 
                        'Content-Type': 'application/json' 
                    },
                    body: JSON.stringify({ embeds: [embed] })
                });
                isEdit = false;
            } else if (!response.ok) {
                const err = await response.text();
                console.error('[POST] Błąd edycji:', response.status, err);
                return res.status(response.status).json({ success: false, error: err });
            } else {
                isEdit = true;
            }
        } else {
            console.log('[POST] Wysyłam nową wiadomość');
            response = await discordFetch(`${baseUrl}/messages`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 
                    'Content-Type': 'application/json' 
                },
                body: JSON.stringify({ embeds: [embed] })
            });
        }
        
        if (!response.ok) {
            const err = await response.text();
            console.error('[POST] Błąd Discord:', response.status, err);
            return res.status(response.status).json({ success: false, error: err });
        }
        
        const data = await response.json();
        
        // ZAPISZ DO BAZY!
        await updateState({
            activeMessageId: data.id,
            activeCodeType: codeType,
            changedBy: officer || 'system'
        });
        
        console.log('[POST] Sukces! ID:', data.id, 'Typ:', codeType, 'Edycja:', isEdit);
        res.json({ 
            success: true, 
            messageId: data.id, 
            isEdit: isEdit, 
            codeType: codeType, 
            timestamp: Date.now() 
        });
        
    } catch (e) {
        console.error('[POST] Wyjątek:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Usuń aktywny kod zagrożenia
app.delete('/delete-active', async (req, res) => {
    try {
        const state = await getState();
        if (!state.activeMessageId) {
            return res.json({ success: true, message: 'Brak aktywnego kodu' });
        }
        
        const fetch = globalThis.fetch || require('node-fetch');
        // POPRAWIONY URL
        const response = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages/${state.activeMessageId}`, {
            method: 'DELETE',
            headers: { 
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 
                'Content-Type': 'application/json' 
            }
        });
        
        await updateState({
            activeMessageId: null,
            activeCodeType: null,
            changedBy: 'system'
        });
        
        res.json({ success: true, status: response.status });
    } catch (e) {
        console.error('Błąd usuwania:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('========================================');
    console.log('✅ Serwer działa na porcie ' + PORT);
    console.log('💾 Baza danych: SQLite (trwała)');
    console.log('🔑 Domyślny kod: CHILLRP');
    console.log('🔐 Bot API Key:', BOT_API_KEY.substring(0, 10) + '...');
    console.log('========================================');
});
