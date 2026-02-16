const express = require('express');
const app = express();
app.use(express.json());

// CORS - pozwala na połączenia z przeglądarki
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

app.get('/', (req, res) => {
    res.send('Bot dziala');
});

app.post('/send-threat', async (req, res) => {
    const { codeType, officer } = req.body;
    
    const codes = {
        green: { name: 'KOD ZIELONY', color: 0x22c55e, desc: 'Sytuacja stabilna' },
        orange: { name: 'KOD POMARANCZOWY', color: 0xf97316, desc: 'Zwiekszone ryzyko' },
        red: { name: 'KOD CZERWONY', color: 0xef4444, desc: 'Wysokie zagrozenie' },
        black: { name: 'KOD CZARNY', color: 0x1f2937, desc: 'Ekstremalne zagrozenie' }
    };
    
    const code = codes[codeType];
    
    try {
        const response = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                embeds: [{
                    title: `🚨 ${code.name}`,
                    description: code.desc,
                    color: code.color,
                    fields: [
                        { name: 'Autor', value: officer, inline: true },
                        { name: 'Czas', value: new Date().toLocaleString('pl-PL'), inline: true }
                    ]
                }]
            })
        });
        
        const data = await response.json();
        res.json({ messageId: data.id });
        
    } catch (e) {
        res.status(500).send('Blad');
    }
});

app.delete('/delete-message/:id', async (req, res) => {
    try {
        await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages/${req.params.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}` }
        });
        res.send('OK');
    } catch (e) {
        res.status(500).send('Blad');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Bot dziala na porcie ' + PORT));
