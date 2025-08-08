const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActivityType } = require('discord.js');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
require('dotenv').config();

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('stock')
    .setDescription('Zeigt aktuellen Grow a Garden Stock und Wetter an')
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

const emojis = {
  seeds: { Carrot: '🥕', Daffodil: '🌼', Strawberry: '🍓', Tomato: '🍅', Blueberry: '🫐' },
  eggs: { Common: '🥚', Rare: '🐣', Epic: '🐤', Legendary: '🐥' },
  gear: { WateringCan: '💧', Shovel: '🪣', Hoe: '🪓', Gloves: '🧤' },
  weather: { Sunny: '☀️', Rainy: '🌧️', Cloudy: '☁️', Stormy: '⛈️', Snowy: '❄️', Windy: '🌬️', Foggy: '🌫️' },
};

let lastStock = null;
let lastWeather = null;

(async () => {
  try {
    console.log('Slash commands werden registriert...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Slash commands registriert!');
  } catch (e) {
    console.error('Fehler beim Registrieren der Commands:', e);
  }
})();

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
      const [stockData, weatherData] = await Promise.all([
        fetchStockData(),
        fetchWeatherData()
      ]);
      await interaction.editReply({
        embeds: [buildStockEmbed(stockData), buildWeatherEmbed(weatherData.weather)]
      });
    } catch (e) {
      console.error('Fehler bei /stock:', e);
      await interaction.editReply('Fehler beim Abrufen der Daten.');
    }
  }
});

async function fetchStockData() {
  const res = await fetch('https://growagarden.gg/stocks');
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
  return Object.entries(weatherObj)
    .filter(([, active]) => active)
    .map(([name]) => name);
}

async function scheduleStockUpdate() {
  const now = new Date();
  const next5min = new Date(now);
  next5min.setSeconds(0);
  next5min.setMilliseconds(0);
  next5min.setMinutes(Math.floor(now.getMinutes() / 5) * 5 + 5);
  const delay = next5min - now;

  console.log(`Nächste Stock-Überprüfung in ${Math.round(delay / 1000)} Sekunden um ${next5min.toLocaleTimeString()}`);

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
    .setFooter({ text: 'Updates alle 5 Minuten' });

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
