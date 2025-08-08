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
    // Stock alle 5 Minuten + 30 Sek
    scheduleStockCheck();

    // Wetter alle 30 Sekunden prüfen
    setInterval(checkWeatherLoop, 30 * 1000);
  });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'stock') {
    await interaction.deferReply();

    try {
      const [stockData, weatherData] = await Promise.all([
        fetchData('stock'),
        fetchData('weather'),
      ]);

      const stockEmbed = buildStockEmbed(stockData);
      const weatherEmbed = buildWeatherEmbed(weatherData.weather);

      await interaction.editReply({ embeds: [stockEmbed, weatherEmbed] });
    } catch (error) {
      console.error('❌ Error handling /stock command:', error);
      await interaction.editReply('⚠️ Unable to fetch data right now. Please try again later.');
    }
  }
});

// API Daten holen
async function fetchData(type) {
  const url = `https://growagarden.gg/api/${type}`;
  const response = await fetch(url);
  return response.json();
}

// Initiale Daten laden, damit keine unnötigen Nachrichten gesendet werden
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

// Stock alle 5 Minuten + 30 Sekunden prüfen (zeitgesteuert)
function scheduleStockCheck() {
  const now = new Date();
  const nextFiveMin = new Date(now);

  nextFiveMin.setMilliseconds(0);
  nextFiveMin.setSeconds(0);
  nextFiveMin.setMinutes(Math.floor(now.getMinutes() / 5) * 5 + 5);
  nextFiveMin.setSeconds(nextFiveMin.getSeconds() + 30);

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

// Wetter Loop alle 30 Sekunden
async function checkWeatherLoop() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) throw new Error('Channel not found');

    const weatherData = await fetchData('weather');

    if (!isEqual(lastWeatherData, weatherData.weather)) {
      lastWeatherData = weatherData.weather;
      await sendSingleWeatherEmbed(channel, weatherData.weather);
      console.log('🌦️ New weather detected & message sent.');
    } else {
      //console.log('No weather changes.');
    }
  } catch (error) {
    console.error('❌ Weather check error:', error);
  }
}

// Wetter-Embed für Slash Command
function buildWeatherEmbed(weather) {
  let weatherDescriptions = [];

  if (Array.isArray(weather)) {
    for (const w of weather) {
      const emoji = emojis.weather[w] || '🌤️';
      weatherDescriptions.push(`${emoji} **${w}**`);
    }
  } else if (typeof weather === 'object') {
    for (const key in weather) {
      if (weather[key]) {
        const emoji = emojis.weather[key] || '🌤️';
        weatherDescriptions.push(`${emoji} **${key}**`);
      }
    }
  } else {
    const emoji = emojis.weather[weather] || '🌤️';
    weatherDescriptions.push(`${emoji} **${weather}**`);
  }

  return new EmbedBuilder()
    .setTitle('☁️ Weather Status')
    .setDescription(weatherDescriptions.join('\n'))
    .setColor('#87CEEB')
    .setTimestamp();
}

// Einzelnen Wetter-Embed senden (bei Änderung)
async function sendSingleWeatherEmbed(channel, weather) {
  let activeWeather = '';

  if (Array.isArray(weather) && weather.length > 0) {
    activeWeather = weather[0];
  } else if (typeof weather === 'object') {
    activeWeather = Object.keys(weather).find(k => weather[k]) || '';
  } else if (typeof weather === 'string') {
    activeWeather = weather;
  }

  const emoji = emojis.weather[activeWeather] || '🌤️';

  const embed = new EmbedBuilder()
    .setTitle('🌦️ Current Weather')
    .setDescription(`${emoji} **${activeWeather}** is now active in Grow a Garden!`)
    .setColor('#87CEEB')
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

// Stock Embed bauen
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

// Einfacher Objektvergleich
function isEqual(obj1, obj2) {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
}

client.login(TOKEN);
