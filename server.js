const express = require('express');
const app = express();

// ============================================
// CORS
// ============================================
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

// ============================================
// KONFIGURACJA
// ============================================

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

if (!DISCORD_BOT_TOKEN) {
    console.error('❌ Brak DISCORD_BOT_TOKEN');
    process.exit(1);
}

if (!DISCORD_CHANNEL_ID) {
    console.error('❌ Brak DISCORD_CHANNEL_ID');
    process.exit(1);
}

// ============================================
// PRZECHOWYWANIE AKTYWNEJ WIADOMOŚCI
// ============================================

let activeMessageId = null;
let activeCodeType = null;

// ============================================
// ROUTES
// ============================================

app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        activeMessageId: activeMessageId,
        activeCodeType: activeCodeType
    });
});

// Główny endpoint - wysyła NOWĄ lub EDYTUJE istniejącą
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
        return res.status(400).json({ 
            success: false, 
            error: 'Nieprawidłowy kod: ' + codeType 
        });
    }
    
    try {
        // Przygotuj embed
        const embed = {
            title: `${code.emoji} ${code.name}`,
            description: code.desc,
            color: code.color,
            fields: [
                { 
                    name: 'Autor zmiany', 
                    value: officer || 'Nieznany', 
                    inline: true 
                },
                { 
                    name: 'Czas', 
                    value: new Date().toLocaleString('pl-PL'), 
                    inline: true 
                }
            ],
            footer: {
                text: 'System Kodów Zagrożenia - LASD'
            },
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
        
        let response;
        let isEdit = false;
        
        // Jeśli mamy aktywną wiadomość - EDYTUJEMY ją
        if (activeMessageId) {
            console.log('[POST] Edytuję istniejącą wiadomość:', activeMessageId);
            
            const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages/${activeMessageId}`;
            
            response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ embeds: [embed] })
            });
            
            isEdit = true;
            
        } else {
            // Brak aktywnej - WYSYŁAMY nową
            console.log('[POST] Wysyłam nową wiadomość');
            
            const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`;
            
            response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ embeds: [embed] })
            });
        }
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[POST] Błąd Discord:', response.status, errorText);
            
            // Jeśli edycja się nie udała (np. wiadomość została usunięta), wyślij nową
            if (isEdit && response.status === 404) {
                console.log('[POST] Edycja nieudana, wysyłam nową...');
                activeMessageId = null;
                
                const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`;
                
                response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ embeds: [embed] })
                });
                
                if (!response.ok) {
                    const errorText2 = await response.text();
                    return res.status(response.status).json({ 
                        success: false, 
                        error: 'Discord API: ' + errorText2 
                    });
                }
            } else {
                return res.status(response.status).json({ 
                    success: false, 
                    error: 'Discord API: ' + errorText 
                });
            }
        }
        
        const data = await response.json();
        
        // Zapisz ID wiadomości i typ kodu
        activeMessageId = data.id;
        activeCodeType = codeType;
        
        console.log('[POST] Sukces! ID:', data.id, 'Typ:', codeType, 'Edycja:', isEdit);
        
        res.json({ 
            success: true,
            messageId: data.id,
            isEdit: isEdit,
            codeType: codeType
        });
        
    } catch (e) {
        console.error('[POST] Wyjątek:', e);
        res.status(500).json({ 
            success: false, 
            error: e.message 
        });
    }
});

// Usuń aktywną wiadomość (reset)
app.delete('/delete-active', async (req, res) => {
    console.log('[DELETE] Usuwanie aktywnej wiadomości:', activeMessageId);
    
    if (!activeMessageId) {
        return res.json({ 
            success: true, 
            message: 'Brak aktywnej wiadomości' 
        });
    }
    
    try {
        const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages/${activeMessageId}`;
        
        const response = await fetch(url, {
            method: 'DELETE',
            headers: { 
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('[DELETE] Status:', response.status);
        
        // Wyczyść zmienną niezależnie od wyniku
        activeMessageId = null;
        activeCodeType = null;
        
        if (response.status === 204 || response.status === 404) {
            return res.json({ 
                success: true, 
                message: 'Usunięto lub nie istniała'
            });
        }
        
        const errorText = await response.text();
        res.status(response.status).json({ 
            success: false, 
            error: errorText 
        });
        
    } catch (e) {
        console.error('[DELETE] Wyjątek:', e);
        activeMessageId = null;
        activeCodeType = null;
        res.status(500).json({ 
            success: false, 
            error: e.message 
        });
    }
});

// Sprawdź status
app.get('/status', (req, res) => {
    res.json({
        activeMessageId: activeMessageId,
        activeCodeType: activeCodeType,
        hasActiveMessage: !!activeMessageId
    });
});

// ============================================
// START
// ============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('========================================');
    console.log('✅ Bot działa na porcie ' + PORT);
    console.log('📺 Kanał Discord ID:', DISCORD_CHANNEL_ID);
    console.log('🔑 Token ustawiony:', DISCORD_BOT_TOKEN ? 'TAK' : 'NIE');
    console.log('🌐 CORS: WŁĄCZONY');
    console.log('📝 Tryb: EDYCJA wiadomości (jedna wiadomość)');
    console.log('========================================');
});
