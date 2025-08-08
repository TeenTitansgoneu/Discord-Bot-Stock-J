const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot läuft!');
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActivityType,
} = require('discord.js');

// node-fetch als dynamischen Import
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

require('dotenv').config();

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('stock')
    .setDescription('Show current Grow a Garden stock and weather status'),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

const emojis = {
  seeds: { Carrot: '🥕', Daffodil: '🌼', Strawberry: '🍓', Tomato: '🍅', Blueberry: '🫐' },
  eggs: { Common: '🥚', Rare: '🐣', Epic: '🐤', Legendary: '🐥' },
  gear: { WateringCan: '💧', Shovel: '🪣', Hoe: '🪓', Gloves: '🧤' },
  weather: { Sunny: '☀️', Rainy: '🌧️', Cloudy: '☁️', Stormy: '⛈️', Snowy: '❄️', Windy: '🌬️', Foggy: '🌫️' },
};

let lastStockData = null;
let lastWeatherData = null;

// Slash commands registrieren
(async () => {
  try {
    console.log('📦 Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Slash commands registered!');
  } catch (error) {
    console.error('❌ Error registering commands:', error);
  }
})();

client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}!`);

  client.user.setPresence({
    status: 'dnd',
    activities: [{ name: 'Grow a Garden 🌱', type: ActivityType.Playing }],
  });

  initializeData().then(() => {
    scheduleStockCheck();           // Stock-Check mit Start-Verzögerung
    setInterval(checkWeatherLoop, 30 * 1000); // Wetter alle 30 Sekunden prüfen
  });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'stock') {
    try {
      await interaction.deferReply();
      const [stockData, weatherData] = await Promise.all([
        fetchData('stock'),
        fetchData('weather'),
      ]);
      const stockEmbed = buildStockEmbed(stockData);
      const weatherEmbed = buildWeatherEmbed(weatherData.weather);
      await interaction.editReply({ embeds: [stockEmbed, weatherEmbed] });
    } catch (error) {
      console.error('❌ Error handling /stock command:', error);
      const msg = '⚠️ Unable to fetch data right now. Please try again later.';
      interaction.replied || interaction.deferred
        ? await interaction.followUp(msg)
        : await interaction.reply(msg);
    }
  }
});

// API Daten holen
async function fetchData(type) {
  const url = `https://growagarden.gg/api/${type}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed fetching ${type} data: ${response.status}`);
  return response.json();
}

// Initiale Daten laden
async function initializeData() {
  try {
    const [stockData, weatherData] = await Promise.all([fetchData('stock'), fetchData('weather')]);
    lastStockData = stockData;
    lastWeatherData = weatherData.weather;
    console.log('✅ Initial data loaded.');
  } catch (error) {
    console.error('❌ Error during initial data fetch:', error);
  }
}

// Stock-Check: erstmal 30 Sek warten, dann alle 5 Min + 30 Sek
function scheduleStockCheck() {
  console.log('⏳ Erste Stock-Überprüfung in 30 Sekunden');
  setTimeout(async () => {
    await checkStockUpdate();
    scheduleRecurringStockCheck();
  }, 30 * 1000);
}
function scheduleRecurringStockCheck() {
  const now = new Date();
  const next = new Date(now);
  next.setMilliseconds(0);
  next.setSeconds(30);
  next.setMinutes(Math.floor(now.getMinutes() / 5) * 5 + 5);
  let delay = next.getTime() - now.getTime();
  if (delay < 0) delay += 5 * 60 * 1000;
  console.log(`⏳ Nächste Stock-Überprüfung in ${Math.round(delay/1000)} Sek (um ${next.toLocaleTimeString()})`);
  setTimeout(async () => {
    await checkStockUpdate();
    scheduleRecurringStockCheck();
  }, delay);
}
async function checkStockUpdate() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) throw new Error('Channel not found');
    const stockData = await fetchData('stock');
    if (!isEqual(lastStockData, stockData)) {
      await channel.send({ embeds: [buildStockEmbed(stockData)] });
      lastStockData = stockData;
      console.log('📢 Stock updated, message sent.');
    } else {
      console.log('No stock changes.');
    }
  } catch (error) {
    console.error('❌ Error during stock update check:', error);
  }
}

// Wetter-Loop mit Debug-Logs
async function checkWeatherLoop() {
  console.log('🔄 Running weather check loop...');
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    console.log('🌐 Channel fetched:', channel?.id ?? 'null');
    const weatherData = await fetchData('weather');
    console.log('🌦️ Fetched weather data:', weatherData.weather);
    console.log('🌤️ Last weather data:', lastWeatherData);

    if (!isEqual(lastWeatherData, weatherData.weather)) {
      lastWeatherData = weatherData.weather;
      console.log('🌦️ Weather changed – sending message...');
      await sendSingleWeatherEmbed(channel, weatherData.weather);
      console.log('🌦️ New weather detected & message sent.');
    } else {
      console.log('🌤️ Weather unchanged, no message sent.');
    }
  } catch (error) {
    console.error('❌ Weather check error:', error);
  }
}

// Embeds & Vergleich wie gehabt:

function buildWeatherEmbed(weather) {
  const desc = [];
  if (Array.isArray(weather)) {
    for (const w of weather) if (typeof w === 'string') desc.push(`${emojis.weather[w] ?? '🌤️'} **${w}**`);
  } else if (weather && typeof weather === 'object') {
    for (const key in weather) if (weather[key]) desc.push(`${emojis.weather[key] ?? '🌤️'} **${key}**`);
  } else if (typeof weather === 'string') {
    desc.push(`${emojis.weather[weather] ?? '🌤️'} **${weather}**`);
  } else {
    desc.push('🌤️ **No Weather Data**');
  }
  
  return new EmbedBuilder()
    .setTitle('☁️ Weather Status')
    .setDescription(desc.length ? desc.join('\n') : '🌤️ **No Weather Data**')
    .setColor('#87CEEB')
    .setTimestamp();
}

async function sendSingleWeatherEmbed(channel, weather) {
  console.log('🌦️ Sending weather embed for:', weather);
  let active = '';
  if (Array.isArray(weather) && weather.length) active = weather[0];
  else if (weather && typeof weather === 'object') active = Object.keys(weather).find(k => weather[k]) || '';
  else if (typeof weather === 'string') active = weather;

  const emoji = emojis.weather[active] ?? '🌤️';
  const embed = new EmbedBuilder()
    .setTitle('🌦️ Current Weather')
    .setDescription(`${emoji} **${active}** is now active in Grow a Garden!`)
    .setColor('#87CEEB')
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

function buildStockEmbed(stockData) {
  const embed = new EmbedBuilder()
    .setTitle('🌾 Grow a Garden — Current Stock')
    .setColor('#2ecc71')
    .setFooter({ text: 'Updated every 5 minutes' })
    .setTimestamp();

  if (Array.isArray(stockData.seedsStock)) {
    embed.addFields({
      name: '🌱 Seeds',
      value: stockData.seedsStock.map(i => `${emojis.seeds[i.name] || '🌱'} **${i.name}**: \`${i.value.toLocaleString()}\``).join('\n'),
      inline: true,
    });
  }
  if (Array.isArray(stockData.eggStock)) {
    embed.addFields({
      name: '🥚 Eggs',
      value: stockData.eggStock.map(i => `${emojis.eggs[i.name] || '🥚'} **${i.name}**: \`${i.value.toLocaleString()}\``).join('\n'),
      inline: true,
    });
  }
  if (Array.isArray(stockData.gearStock)) {
    embed.addFields({
      name: '🛠️ Gear',
      value: stockData.gearStock.map(i => `${emojis.gear[i.name] || '🛠️'} **${i.name}**: \`${i.value.toLocaleString()}\``).join('\n'),
      inline: true,
    });
  }
  return embed;
}

function isEqual(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch { return false; }
}

client.login(TOKEN);
