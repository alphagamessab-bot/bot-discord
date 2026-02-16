const express = require('express');
const app = express();
app.use(express.json());

// ============================================
// KONFIGURACJA - ZMIENNE ŚRODOWISKOWE
// ============================================
// Ustaw te zmienne w panelu Render (Environment Variables):
// DISCORD_BOT_TOKEN = twój_token_bota
// DISCORD_CHANNEL_ID = id_kanału_discord

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

// Sprawdź czy zmienne są ustawione
if (!DISCORD_BOT_TOKEN) {
    console.error('❌ BŁĄD: Brak zmiennej środowiskowej DISCORD_BOT_TOKEN');
    console.error('Ustaw ją w panelu Render lub w pliku .env');
    process.exit(1);
}

if (!DISCORD_CHANNEL_ID) {
    console.error('❌ BŁĄD: Brak zmiennej środowiskowej DISCORD_CHANNEL_ID');
    console.error('Ustaw ją w panelu Render lub w pliku .env');
    process.exit(1);
}

// ============================================
// ROUTES
// ============================================

app.get('/', (req, res) => {
    res.send('Bot działa poprawnie');
});

// Wysyłanie kodu zagrożenia do Discord
app.post('/send-threat', async (req, res) => {
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
        return res.status(400).json({ 
            success: false, 
            error: 'Nieprawidłowy kod' 
        });
    }
    
    try {
        // Przygotuj embed
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
        
        // Dodaj dopisek dla kodów czerwonego i czarnego
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
        
        // Wyślij do Discord
        const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`;
        
        console.log('[SEND] Wysyłam wiadomość...');
        
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
            console.error('[SEND] Błąd Discord API:', response.status, errorText);
            return res.status(response.status).json({ 
                success: false, 
                error: 'Błąd Discord: ' + errorText 
            });
        }
        
        const data = await response.json();
        console.log('[SEND] Wysłano, ID:', data.id);
        
        res.json({ 
            success: true,
            messageId: data.id 
        });
        
    } catch (e) {
        console.error('[SEND] Błąd:', e);
        res.status(500).json({ 
            success: false, 
            error: e.message 
        });
    }
});

// Usuwanie wiadomości z Discord
app.delete('/delete-message/:id', async (req, res) => {
    const messageId = req.params.id;
    
    console.log('[DELETE] Prośba o usunięcie wiadomości ID:', messageId);
    
    if (!messageId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Brak ID wiadomości' 
        });
    }
    
    try {
        const url = `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages/${messageId}`;
        
        console.log('[DELETE] URL:', url);
        
        const response = await fetch(url, {
            method: 'DELETE',
            headers: { 
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('[DELETE] Odpowiedź Discord API:', response.status);
        
        // 204 = sukces (no content), 404 = już usunięta (też OK)
        if (response.status === 204) {
            console.log('[DELETE] Usunięto pomyślnie');
            return res.json({ 
                success: true, 
                status: 204,
                message: 'Usunięto'
            });
        }
        
        if (response.status === 404) {
            console.log('[DELETE] Nie znaleziono (już usunięta?)');
            return res.json({ 
                success: true, 
                status: 404,
                message: 'Nie znaleziono (już usunięta?)'
            });
        }
        
        // Inny błąd
        const errorText = await response.text();
        console.error('[DELETE] Błąd:', response.status, errorText);
        res.status(response.status).json({ 
            success: false, 
            error: errorText 
        });
        
    } catch (e) {
        console.error('[DELETE] Wyjątek:', e);
        res.status(500).json({ 
            success: false, 
            error: e.message 
        });
    }
});

// ============================================
// START SERWERA
// ============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('========================================');
    console.log('✅ Bot działa na porcie ' + PORT);
    console.log('📺 Kanał Discord ID:', DISCORD_CHANNEL_ID);
    console.log('🔑 Token ustawiony:', DISCORD_BOT_TOKEN ? 'TAK' : 'NIE');
    console.log('========================================');
});
