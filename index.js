import express from 'express';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActivityType } from 'discord.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const PORT = process.env.PORT || 3000;

const emojis = {
  seeds: { Carrot: '🥕', Daffodil: '🌼', Strawberry: '🍓', Tomato: '🍅', Blueberry: '🫐' },
  eggs: { Common: '🥚', Rare: '🐣', Epic: '🐤', Legendary: '🐥' },
  gear: { WateringCan: '💧', Shovel: '🪣', Hoe: '🪓', Gloves: '🧤' },
  weather: { Sunny: '☀️', Rainy: '🌧️', Cloudy: '☁️', Stormy: '⛈️', Snowy: '❄️', Windy: '🌬️', Foggy: '🌫️' },
};

// Express-Server (Healthcheck)
const app = express();
app.get('/', (req, res) => res.send('Bot läuft'));
app.listen(PORT, () => console.log(`Express Server läuft auf Port ${PORT}`));

// Discord-Client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Slash Command Setup
const commands = [
  new SlashCommandBuilder()
    .setName('stock')
    .setDescription('Zeigt aktuellen Grow a Garden Stock und Wetter an')
    .toJSON()
];
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    console.log('Slash commands werden registriert...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Slash commands registriert!');
  } catch (e) {
    console.error('Fehler beim Registrieren der Commands:', e);
  }
})();

// Status halten
let lastStock = null;
let lastWeather = null;

client.once('ready', async () => {
  console.log(`Bot ist online als ${client.user.tag}`);

  client.user.setPresence({
    status: 'online',
    activities: [{ name: 'Grow a Garden 🌱', type: ActivityType.Playing }],
  });

  await fetchAndSetInitialData();

  scheduleStockUpdate();
  setInterval(weatherUpdateLoop, 30_000);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'stock') {
    await interaction.deferReply();
    try {
      const [stockData, weatherData] = await Promise.all([fetchStockData(), fetchWeatherData()]);
      await interaction.editReply({
        embeds: [
          buildStockEmbed(stockData),
          buildWeatherEmbed(extractActiveWeather(weatherData.weather))
        ],
      });
    } catch (e) {
      console.error('Fehler bei /stock:', e);
      await interaction.editReply('Fehler beim Abrufen der Daten.');
    }
  }
});

// --- Funktionen ---

async function fetchStockData() {
  const res = await fetch('https://growagarden.gg/api/stock');
  if (!res.ok) throw new Error('Fehler beim Abrufen der Stocks');
  return res.json();
}

async function fetchWeatherData() {
  const res = await fetch('https://growagarden.gg/api/weather');
  if (!res.ok) throw new Error('Fehler beim Abrufen des Wetters');
  return res.json();
}

async function fetchAndSetInitialData() {
  try {
    lastStock = await fetchStockData();
    const weatherData = await fetchWeatherData();
    lastWeather = extractActiveWeather(weatherData.weather);
    console.log('Initiale Daten geladen');
  } catch (e) {
    console.error('Fehler beim initialen Laden der Daten:', e);
  }
}

function extractActiveWeather(weatherObj) {
  if (!weatherObj || typeof weatherObj !== 'object') return [];
  return Object.entries(weatherObj)
    .filter(([, active]) => active === true)
    .map(([name]) => name);
}

async function scheduleStockUpdate() {
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(30);
  next.setMilliseconds(0);
  if (next <= now) next.setMinutes(next.getMinutes() + 5);

  const delay = next - now;
  console.log(`Nächste Stock-Überprüfung in ${Math.round(delay / 1000)} Sekunden um ${next.toLocaleTimeString()}`);

  setTimeout(async () => {
    await checkStockChange();
    scheduleStockUpdate();
  }, delay);
}

async function checkStockChange() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) throw new Error('Channel nicht gefunden');

    const newStock = await fetchStockData();

    if (JSON.stringify(newStock) !== JSON.stringify(lastStock)) {
      await channel.send({ embeds: [buildStockEmbed(newStock)] });
      lastStock = newStock;
      console.log('Stock hat sich geändert, Nachricht gesendet');
    } else {
      console.log('Keine Änderung beim Stock');
    }
  } catch (e) {
    console.error('Fehler beim Prüfen des Stocks:', e);
  }
}

async function weatherUpdateLoop() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) throw new Error('Channel nicht gefunden');

    const weatherData = await fetchWeatherData();
    const activeWeather = extractActiveWeather(weatherData.weather);

    if (JSON.stringify(activeWeather) !== JSON.stringify(lastWeather)) {
      lastWeather = activeWeather;
      await channel.send({ embeds: [buildWeatherEmbed(activeWeather)] });
      console.log('Wetter hat sich geändert, Nachricht gesendet');
    } else {
      console.log('Wetter unverändert');
    }
  } catch (e) {
    console.error('Fehler bei Wetter-Update:', e);
  }
}

function buildStockEmbed(stock) {
  const embed = new EmbedBuilder()
    .setTitle('🌾 Grow a Garden - Aktueller Stock')
    .setColor('#2ecc71')
    .setTimestamp()
    .setFooter({ text: 'Updates alle 5 Minuten + 30 Sekunden' });

  if (Array.isArray(stock.seedsStock)) {
    embed.addFields({
      name: '🌱 Seeds',
      value: stock.seedsStock.map(s => `${emojis.seeds[s.name] || '🌱'} **${s.name}**: \`${s.value.toLocaleString()}\``).join('\n'),
      inline: true,
    });
  }
  if (Array.isArray(stock.eggStock)) {
    embed.addFields({
      name: '🥚 Eggs',
      value: stock.eggStock.map(e => `${emojis.eggs[e.name] || '🥚'} **${e.name}**: \`${e.value.toLocaleString()}\``).join('\n'),
      inline: true,
    });
  }
  if (Array.isArray(stock.gearStock)) {
    embed.addFields({
      name: '🛠️ Gear',
      value: stock.gearStock.map(g => `${emojis.gear[g.name] || '🛠️'} **${g.name}**: \`${g.value.toLocaleString()}\``).join('\n'),
      inline: true,
    });
  }

  // Zusätzliche Infos zum Restock (optional)
  if (stock.restockTimers) {
    embed.addFields({
      name: '⏳ Restock Timer (Sekunden)',
      value: Object.entries(stock.restockTimers).map(([cat, sec]) => `**${cat}**: \`${(sec / 1000).toFixed(1)}s\``).join('\n'),
      inline: true,
    });
  }

  if (stock.categoryRefreshStatus) {
    embed.addFields({
      name: '🔄 Kategorie Refresh Status',
      value: Object.entries(stock.categoryRefreshStatus)
        .map(([cat, info]) => `**${cat}**: ${info.wasRefreshed ? '✔️' : '❌'} (vor ${Math.floor(info.timeSinceRefresh/1000)}s)`).join('\n'),
      inline: true,
    });
  }

  return embed;
}

function buildWeatherEmbed(weatherArray) {
  if (!Array.isArray(weatherArray) || weatherArray.length === 0) {
    return new EmbedBuilder()
      .setTitle('🌦️ Aktuelles Wetter')
      .setDescription('Kein aktives Wetter gerade.')
      .setColor('#87CEEB')
      .setTimestamp();
  }

  const desc = weatherArray.map(w => `${emojis.weather[w] || '🌤️'} **${w}**`).join('\n');
  return new EmbedBuilder()
    .setTitle('🌦️ Aktuelles Wetter')
    .setDescription(desc)
    .setColor('#87CEEB')
    .setTimestamp();
}

client.login(TOKEN);
