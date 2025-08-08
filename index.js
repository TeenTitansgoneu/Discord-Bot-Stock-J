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

(async () => {
  try {
    console.log('📦 Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Slash commands registered!');
  } catch (error) {
    console.error('❌ Error registering commands:', error);
  }
})();

client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}!`);

  client.user.setPresence({
    status: 'dnd',
    activities: [{ name: 'Grow a Garden 🌱', type: ActivityType.Playing }],
  });

  await initializeData();

  scheduleStockCheck();
  setInterval(checkWeatherLoop, 30 * 1000);
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
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp('⚠️ Unable to fetch data right now. Please try again later.');
        } else {
          await interaction.reply('⚠️ Unable to fetch data right now. Please try again later.');
        }
      } catch (replyError) {
        console.error('❌ Failed to send error message:', replyError);
      }
    }
  }
});

async function fetchData(type) {
  const url = `https://growagarden.gg/api/${type}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed fetching ${type} data: ${response.status}`);
  const data = await response.json();
  return data;
}

async function initializeData() {
  try {
    const [stockData, weatherData] = await Promise.all([fetchData('stock'), fetchData('weather')]);
    lastStockData = stockData;
    lastWeatherData = extractWeather(weatherData);
    console.log('✅ Initial data loaded.');
  } catch (error) {
    console.error('❌ Error during initial data fetch:', error);
  }
}

function scheduleStockCheck() {
  const now = new Date();
  const nextFiveMin = new Date(now);

  nextFiveMin.setMilliseconds(0);
  nextFiveMin.setSeconds(30);
  nextFiveMin.setMinutes(Math.floor(now.getMinutes() / 5) * 5 + 5);

  const delay = nextFiveMin.getTime() - now.getTime();

  console.log(`⏳ Next stock check in ${Math.round(delay / 1000)} seconds at ${nextFiveMin.toLocaleTimeString()}`);

  setTimeout(async () => {
    await checkStockUpdate();
    scheduleStockCheck();
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

async function checkWeatherLoop() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) throw new Error('Channel not found');

    const weatherData = await fetchData('weather');
    const currentWeather = extractWeather(weatherData);

    console.log('🌦️ Fetched weather data:', currentWeather);
    console.log('🌤️ Last weather data:', lastWeatherData);

    if (!isEqual(lastWeatherData, currentWeather)) {
      lastWeatherData = currentWeather;
      await sendSingleWeatherEmbed(channel, currentWeather);
      console.log('🌦️ New weather detected & message sent.');
    } else {
      console.log('🌤️ Weather unchanged, no message sent.');
    }
  } catch (error) {
    console.error('❌ Weather check error:', error);
  }
}

function extractWeather(weatherData) {
  // Die API liefert Wetter als Array oder Objekt mit true/false Werten
  if (!weatherData || typeof weatherData !== 'object') return [];

  if (Array.isArray(weatherData.weather)) {
    return weatherData.weather;
  }

  if (typeof weatherData.weather === 'object' && weatherData.weather !== null) {
    return Object.entries(weatherData.weather)
      .filter(([, value]) => value)
      .map(([key]) => key);
  }

  if (typeof weatherData.weather === 'string') {
    return [weatherData.weather];
  }

  // Fallback leer
  return [];
}

function buildWeatherEmbed(weatherArr) {
  let weatherDescriptions = [];

  if (Array.isArray(weatherArr) && weatherArr.length > 0) {
    for (const w of weatherArr) {
      const emoji = emojis.weather[w] ?? '🌤️';
      weatherDescriptions.push(`${emoji} **${w}**`);
    }
  } else {
    weatherDescriptions.push('🌤️ **No Weather Data**');
  }

  return new EmbedBuilder()
    .setTitle('☁️ Weather Status')
    .setDescription(weatherDescriptions.join('\n'))
    .setColor('#87CEEB')
    .setTimestamp();
}

async function sendSingleWeatherEmbed(channel, weatherArr) {
  if (!Array.isArray(weatherArr) || weatherArr.length === 0) {
    await channel.send({ embeds: [new EmbedBuilder()
      .setTitle('🌦️ Current Weather')
      .setDescription('🌤️ **No active weather in Grow a Garden right now!**')
      .setColor('#87CEEB')
      .setTimestamp()] });
    return;
  }

  // Wir nehmen das erste Wetter-Element als Hauptwetter
  const mainWeather = weatherArr[0];
  const emoji = emojis.weather[mainWeather] ?? '🌤️';

  const embed = new EmbedBuilder()
    .setTitle('🌦️ Current Weather')
    .setDescription(`${emoji} **${mainWeather}** is now active in Grow a Garden!`)
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
    const seedsText = stockData.seedsStock
      .map(item => `${emojis.seeds[item.name] || '🌱'} **${item.name}**: \`${item.value.toLocaleString()}\``)
      .join('\n');
    embed.addFields({ name: '🌱 Seeds', value: seedsText, inline: true });
  }

  if (Array.isArray(stockData.eggStock)) {
    const eggsText = stockData.eggStock
      .map(item => `${emojis.eggs[item.name] || '🥚'} **${item.name}**: \`${item.value.toLocaleString()}\``)
      .join('\n');
    embed.addFields({ name: '🥚 Eggs', value: eggsText, inline: true });
  }

  if (Array.isArray(stockData.gearStock)) {
    const gearText = stockData.gearStock
      .map(item => `${emojis.gear[item.name] || '🛠️'} **${item.name}**: \`${item.value.toLocaleString()}\``)
      .join('\n');
    embed.addFields({ name: '🛠️ Gear', value: gearText, inline: true });
  }

  return embed;
}

function isEqual(obj1, obj2) {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
}

client.login(TOKEN);
