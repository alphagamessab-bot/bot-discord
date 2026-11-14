const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  Partials, 
  REST, 
  Routes, 
  ChannelType, 
  UserSelectMenuBuilder 
} = require('discord.js');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const LOGO_URL = process.env.LOGO_URL || '';
const EMBED_COLOR = 0xf26522;

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const TICKET_CHANNEL_ID = process.env.TICKET_CHANNEL_ID;
const TICKET_CAT_KIEROWNICTWO = process.env.TICKET_CAT_KIEROWNICTWO;
const TICKET_CAT_SKARGA = process.env.TICKET_CAT_SKARGA;
const TICKET_CAT_INNE = process.env.TICKET_CAT_INNE;
const TICKET_LOG_CHANNEL = process.env.TICKET_LOG_CHANNEL;
const TICKET_STAFF_ROLE_1 = process.env.TICKET_STAFF_ROLE_1;
const TICKET_STAFF_ROLE_2 = process.env.TICKET_STAFF_ROLE_2;

const DB_PATH = process.env.DB_PATH || './data/tickets.db';

if (!TOKEN || !GUILD_ID || !TICKET_CHANNEL_ID) {
  console.error('❌ BŁĄD KRYTYCZNY: Brak wymaganych zmiennych w .env!');
  process.exit(1);
}

const dbDir = path.dirname(DB_PATH);
if (dbDir && dbDir !== '.' && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS active_tickets (
    channelId TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL,
    type TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  )
`);

const deleteTicketStmt = db.prepare('DELETE FROM active_tickets WHERE channelId = ?');
const saveTicketStmt = db.prepare(`
  INSERT INTO active_tickets (channelId, ownerId, type, createdAt)
  VALUES (@channelId, @ownerId, @type, @createdAt)
  ON CONFLICT(channelId) DO UPDATE SET
    ownerId = excluded.ownerId,
    type = excluded.type,
    createdAt = excluded.createdAt
`);

const activeTickets = new Map();

function dbLoadAll() {
  try {
    const ticketRows = db.prepare('SELECT * FROM active_tickets').all();
    for (const row of ticketRows) {
      activeTickets.set(row.channelId, {
        ownerId: row.ownerId,
        type: row.type,
        createdAt: row.createdAt
      });
    }
    console.log(`📁 Wczytano aktywne tickety: ${activeTickets.size}`);
  } catch (err) {
    console.error('❌ Błąd ładowania bazy:', err);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

function hasStaffRole(member) {
  if (!TICKET_STAFF_ROLE_1 && !TICKET_STAFF_ROLE_2) return false;
  return (TICKET_STAFF_ROLE_1 && member.roles.cache.has(TICKET_STAFF_ROLE_1)) || 
         (TICKET_STAFF_ROLE_2 && member.roles.cache.has(TICKET_STAFF_ROLE_2));
}

async function sendTicketPanel() {
  if (!TICKET_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(TICKET_CHANNEL_ID);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle('🎫 BIURO OBSŁUGI KLIENTA')
      .setDescription('Potrzebujesz kontaktu z kierownictwem lub chcesz zgłosić sprawę?\nWybierz jedną z opcji poniżej, aby otworzyć prywatne zgłoszenie.')
      .setFooter({ text: 'System zgłoszeń' });

    if (LOGO_URL) embed.setThumbnail(LOGO_URL);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_open_kierownictwo').setLabel('Kierownictwo').setStyle(ButtonStyle.Primary).setEmoji('📝'),
      new ButtonBuilder().setCustomId('ticket_open_skarga').setLabel('Skarga').setStyle(ButtonStyle.Danger).setEmoji('⚠️'),
      new ButtonBuilder().setCustomId('ticket_open_inne').setLabel('Inny powód').setStyle(ButtonStyle.Secondary).setEmoji('❓')
    );

    await channel.send({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error('Błąd wysyłania panelu ticketów:', err);
  }
}

async function createTicket(interaction, type) {
  const guild = interaction.guild;
  const user = interaction.user;

  for (const [chId, ticket] of activeTickets) {
    if (ticket.ownerId === user.id && ticket.type === type) {
      return interaction.reply({ content: `❌ Posiadasz już otwarte zgłoszenie na kanale: <#${chId}>`, ephemeral: true });
    }
  }

  let categoryId = TICKET_CAT_INNE;
  let chName = `ticket-${user.username}`;
  if (type === 'kierownictwo') { categoryId = TICKET_CAT_KIEROWNICTWO; chName = `zarzad-${user.username}`; }
  else if (type === 'skarga') { categoryId = TICKET_CAT_SKARGA; chName = `skarga-${user.username}`; }

  try {
    const overrides = [
      { id: guild.id, deny: ['ViewChannel'] },
      { id: user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles'] },
      { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels'] }
    ];
    if (TICKET_STAFF_ROLE_1) overrides.push({ id: TICKET_STAFF_ROLE_1, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] });
    if (TICKET_STAFF_ROLE_2) overrides.push({ id: TICKET_STAFF_ROLE_2, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] });

    const ticketChannel = await guild.channels.create({
      name: chName.slice(0, 90).toLowerCase().replace(/[^a-z0-9\-]/g, ''),
      type: ChannelType.GuildText,
      parent: categoryId || undefined,
      permissionOverwrites: overrides
    });

    const ticketData = { ownerId: user.id, type, createdAt: Date.now() };
    activeTickets.set(ticketChannel.id, ticketData);
    saveTicketStmt.run({ channelId: ticketChannel.id, ownerId: ticketData.ownerId, type: ticketData.type, createdAt: ticketData.createdAt });

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle('🎫 OTWARTE ZGŁOSZENIE')
      .setDescription(`Witaj <@${user.id}>! Opisz szczegółowo swój problem, a personel odpowie najszybciej jak to możliwe.`);

    if (LOGO_URL) embed.setThumbnail(LOGO_URL);

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ticket_add_${ticketChannel.id}`).setLabel('Dodaj osobę').setStyle(ButtonStyle.Primary).setEmoji('➕'),
      new ButtonBuilder().setCustomId(`ticket_close_${ticketChannel.id}`).setLabel('Zamknij bilet').setStyle(ButtonStyle.Danger).setEmoji('🔒')
    );

    await ticketChannel.send({ content: `<@${user.id}>`, embeds: [embed], components: [buttons] });
    await interaction.reply({ content: `✅ Zgłoszenie utworzone pomyślnie: <#${ticketChannel.id}>`, ephemeral: true });
  } catch (err) {
    console.error('Błąd tworzenia zgłoszenia:', err);
    await interaction.reply({ content: '❌ Nie udało się utworzyć zgłoszenia.', ephemeral: true });
  }
}

async function closeTicket(interaction, channelId) {
  const ticket = activeTickets.get(channelId);
  if (!ticket) return interaction.reply({ content: '❌ Ten bilet nie istnieje w pamięci.', ephemeral: true });
  if (!hasStaffRole(interaction.member) && !interaction.memberPermissions.has('Administrator')) {
    return interaction.reply({ content: '❌ Brak uprawnień do zamknięcia zgłoszenia.', ephemeral: true });
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (TICKET_LOG_CHANNEL) {
      const logChannel = await client.channels.fetch(TICKET_LOG_CHANNEL).catch(() => null);
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setColor(0xdc3545)
          .setTitle('🔒 ZGŁOSZENIE ZAKOŃCZONE')
          .addFields(
            { name: 'Kanał', value: `#${channel.name}`, inline: true },
            { name: 'Zgłaszający', value: `<@${ticket.ownerId}>`, inline: true },
            { name: 'Zamknął', value: `<@${interaction.user.id}>`, inline: true }
          )
          .setTimestamp();
        await logChannel.send({ embeds: [logEmbed] });
      }
    }

    activeTickets.delete(channelId);
    deleteTicketStmt.run(channelId);

    await interaction.reply({ content: '🔒 Bilet zamknięty. Kanał zostanie usunięty za chwilę...' });
    setTimeout(() => channel.delete().catch(() => {}), 2000);
  } catch (err) {
    console.error('Błąd zamykania ticketu:', err);
  }
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'ticketsetup') {
        if (!interaction.memberPermissions.has('Administrator')) {
          return interaction.reply({ content: '❌ Brak uprawnień administracyjnych.', ephemeral: true });
        }
        await sendTicketPanel();
        return interaction.reply({ content: '✅ Panel zgłoszeniowy został wysłany.', ephemeral: true });
      }
    }

    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId.startsWith('ticket_open_')) {
        return createTicket(interaction, customId.replace('ticket_open_', ''));
      }
      if (customId.startsWith('ticket_close_')) {
        return closeTicket(interaction, customId.replace('ticket_close_', ''));
      }
      if (customId.startsWith('ticket_add_')) {
        const channelId = customId.replace('ticket_add_', '');
        if (!hasStaffRole(interaction.member) && !interaction.memberPermissions.has('Administrator')) {
          return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
        }
        const select = new UserSelectMenuBuilder()
          .setCustomId(`ticket_select_add_${channelId}`)
          .setPlaceholder('Wybierz użytkownika do dodania')
          .setMinValues(1)
          .setMaxValues(1);
        return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
      }
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('ticket_select_add_')) {
      const channelId = interaction.customId.replace('ticket_select_add_', '');
      const selectedUserId = interaction.values[0];
      const channel = await client.channels.fetch(channelId);
      await channel.permissionOverwrites.create(selectedUserId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
      return interaction.reply({ content: '✅ Użytkownik został dodany do zgłoszenia.', ephemeral: true });
    }
  } catch (err) {
    console.error('Błąd interakcji:', err);
  }
});

client.once('ready', async () => {
  console.log(`🤖 Zalogowano jako ${client.user.tag}`);
  dbLoadAll();

  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
      body: [{ name: 'ticketsetup', description: 'Wysyła panel zgłoszeniowy na dany kanał' }]
    });
    console.log('✅ Zarejestrowano komendę /ticketsetup');
  } catch (err) {
    console.error('Błąd rejestracji komend:', err);
  }
});

client.login(TOKEN);
