const express = require('express');
const app = express();

// ============================================
// CORS - WAŻNE! Pozwól na zapytania z przeglądarki
// ============================================
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    // Obsługa preflight (OPTIONS)
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    
    next();
});

app.use(express.json());

// ============================================
// KONFIGURACJA - ZMIENNE ŚRODOWISKOWE
// ============================================

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

// Sprawdź czy zmienne są ustawione
if (!DISCORD_BOT_TOKEN) {
    console.error('❌ BŁĄD: Brak zmiennej DISCORD_BOT_TOKEN');
    process.exit(1);
}

if (!DISCORD_CHANNEL_ID) {
    console.error('❌ BŁĄD: Brak zmiennej DISCORD_CHANNEL_ID');
    process.exit(1);
}

// ============================================
// ROUTES
// ============================================

app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Bot działa',
        timestamp: new Date().toISOString()
    });
});

// Test CORS
app.get('/test', (req, res) => {
    res.json({ 
        success: true,
        message: 'CORS działa poprawnie!',
        cors: 'enabled'
    });
});

// Wysyłanie kodu zagrożenia
app.post('/send-threat', async (req, res) => {
    console.log('[POST /send-threat] Otrzymano żądanie:', req.body);
    
    const { codeType, officer } = req.body;
    
    const codes = {
        green: { 
            name: 'KOD ZIELONY', 
            color: 0x22c55e, 
            desc: 'Sytuacja stabilna w mieście, standardowy pościg bez podwyższonego ryzyka lub brak zagrożenia terrorystycznego w mieście.' 
        },
        orange: { 
            name: 'KOD POMARAŃCZOWY', 
            color: 0xf97316, 
            desc: 'Zwiększone ryzyko w mieście. Podczas pościgu oznacza autoryzację do wykonywania manewrów PIT (spychani, taranowanie) poza miastem. Może oznaczać zwiększenie liczebności rabunków bądź większego zagrożenia.' 
        },
        red: { 
            name: 'KOD CZERWONY', 
            color: 0xef4444, 
            desc: 'Wysokie zagrożenie. Autoryzacja do zniszczenia opon pojazdu (strzały w opony). W mieście oznacza zwiększone zagrożenie terrorystyczne (np: Porwanie Policjanta).' 
        },
        black: { 
            name: 'KOD CZARNY', 
            color: 0x1f2937, 
            desc: 'Ekstremalne zagrożenie. Autoryzacja na użycie broni palnej w kierunku napastników. W mieście oznacza duże prawdopodobieństwo lub trwający atak terrorystyczny (np: Porwanie wielu obywateli bądź osób publicznych).' 
        }
    };
    
    const code = codes[codeType];
    
    if (!code) {
        console.log('[POST /send-threat] Nieprawidłowy kod:', codeType);
        return res.status(400).json({ 
            success: false, 
            error: 'Nieprawidłowy kod: ' + codeType 
        });
    }
    
    try {
        const embed = {
            title: `🚨 ${code.name}`,
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
        
        const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`;
        
        console.log('[POST /send-threat] Wysyłam do Discord...');
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ embeds: [embed] })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[POST /send-threat] Błąd Discord:', response.status, errorText);
            return res.status(response.status).json({ 
                success: false, 
                error: 'Discord API: ' + errorText 
            });
        }
        
        const data = await response.json();
        console.log('[POST /send-threat] Wysłano, ID:', data.id);
        
        res.json({ 
            success: true,
            messageId: data.id 
        });
        
    } catch (e) {
        console.error('[POST /send-threat] Wyjątek:', e);
        res.status(500).json({ 
            success: false, 
            error: e.message 
        });
    }
});

// Usuwanie wiadomości
app.delete('/delete-message/:id', async (req, res) => {
    const messageId = req.params.id;
    
    console.log('[DELETE /delete-message] ID:', messageId);
    
    if (!messageId || messageId === 'null' || messageId === 'undefined') {
        console.log('[DELETE /delete-message] Brak ID lub nieprawidłowe');
        return res.status(400).json({ 
            success: false, 
            error: 'Brak lub nieprawidłowe ID wiadomości' 
        });
    }
    
    try {
        const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages/${messageId}`;
        
        console.log('[DELETE /delete-message] Usuwam...');
        
        const response = await fetch(url, {
            method: 'DELETE',
            headers: { 
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('[DELETE /delete-message] Status:', response.status);
        
        if (response.status === 204) {
            return res.json({ 
                success: true, 
                status: 204,
                message: 'Usunięto'
            });
        }
        
        if (response.status === 404) {
            return res.json({ 
                success: true, 
                status: 404,
                message: 'Już usunięta lub nie istnieje'
            });
        }
        
        const errorText = await response.text();
        res.status(response.status).json({ 
            success: false, 
            error: errorText 
        });
        
    } catch (e) {
        console.error('[DELETE /delete-message] Wyjątek:', e);
        res.status(500).json({ 
            success: false, 
            error: e.message 
        });
    }
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
    console.log('========================================');
});
