require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
} = require("discord.js");

const {
  joinVoiceChannel,
  getVoiceConnection,
} = require("@discordjs/voice");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

// Время запуска
const startedAt = Date.now();

// Время участников в голосовых каналах
const voiceTimes = new Map();

// ================================
// BOT READY
// ================================

client.once("ready", () => {
  console.log(`🐕 Hachiko запущен: ${client.user.tag}`);

  client.user.setPresence({
    activities: [
      {
        name: "за сервером 🐕",
        type: 3,
      },
    ],
    status: "online",
  });
});

// ================================
// СООБЩЕНИЯ
// ================================

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const command = message.content.toLowerCase().trim();

  // !woof
  if (command === "!woof") {
    return message.reply("Гав! 🐕");
  }

  // !ping
  if (command === "!ping") {
    return message.reply(`🏓 Pong! ${client.ws.ping}ms`);
  }

  // !help
  if (command === "!help") {
    return message.reply(
      [
        "🐕 **Hachiko — команды**",
        "",
        "`!woof` — гав",
        "`!ping` — проверка бота",
        "`!where` — где находится бот",
        "`!uptime` — сколько работает",
        "`!server` — информация о сервере",
        "`!stay` — зайти в твой голосовой канал",
        "`!leave` — выйти из голосового",
      ].join("\n")
    );
  }

  // !uptime
  if (command === "!uptime") {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    return message.reply(
      `⏱️ Я работаю **${hours}ч ${minutes}м ${secs}с**`
    );
  }

  // !server
  if (command === "!server") {
    const guild = message.guild;

    const members = guild.memberCount;
    const channels = guild.channels.cache.size;
    const voice = guild.channels.cache.filter(
      (channel) => channel.isVoiceBased()
    ).size;

    return message.reply(
      [
        `🐕 **${guild.name}**`,
        "",
        `👥 Участников: **${members}**`,
        `📁 Каналов: **${channels}**`,
        `🎤 Голосовых: **${voice}**`,
      ].join("\n")
    );
  }

  // !where
  if (command === "!where") {
    const connection = getVoiceConnection(message.guild.id);

    if (!connection) {
      return message.reply("🐕 Я сейчас нигде не сижу.");
    }

    const channelId = connection.joinConfig.channelId;
    const channel = message.guild.channels.cache.get(channelId);

    return message.reply(
      `🎧 Я сейчас нахожусь в **${channel?.name ?? "неизвестном канале"}**`
    );
  }

  // ================================
  // !stay
  // ================================

  if (command === "!stay") {
    const channel = message.member?.voice?.channel;

    if (!channel) {
      return message.reply("❌ Сначала зайди в голосовой канал.");
    }

    const permissions = channel.permissionsFor(message.guild.members.me);

    if (
      !permissions?.has(PermissionsBitField.Flags.Connect)
    ) {
      return message.reply(
        "❌ У меня нет права подключаться к этому каналу."
      );
    }

    try {
      joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: true,
      });

      return message.reply(
        `🎧 Залетел в **${channel.name}**`
      );
    } catch (error) {
      console.error(error);
      return message.reply("❌ Не получилось подключиться.");
    }
  }

  // ================================
  // !leave
  // ================================

  if (command === "!leave") {
    const connection = getVoiceConnection(message.guild.id);

    if (!connection) {
      return message.reply("🐕 Я и так нигде не нахожусь.");
    }

    connection.destroy();

    return message.reply("👋 Вышел из голосового.");
  }
});

// ================================
// ВХОД / ВЫХОД ИЗ ВОЙСА
// ================================

client.on("voiceStateUpdate", (oldState, newState) => {
  const member = newState.member;

  if (!member || member.user.bot) return;

  // Зашёл в голосовой
  if (!oldState.channel && newState.channel) {
    voiceTimes.set(member.id, {
      channel: newState.channel.id,
      joinedAt: Date.now(),
    });

    console.log(
      `🎤 ${member.user.tag} зашёл в ${newState.channel.name}`
    );
  }

  // Вышел из голосового
  if (oldState.channel && !newState.channel) {
    const data = voiceTimes.get(member.id);

    if (data) {
      const duration = Date.now() - data.joinedAt;

      const minutes = Math.floor(duration / 60000);

      console.log(
        `🚪 ${member.user.tag} вышел из ${oldState.channel.name}. Время: ${minutes} мин.`
      );

      voiceTimes.delete(member.id);
    }
  }

  // Перешёл из одного войса в другой
  if (
    oldState.channel &&
    newState.channel &&
    oldState.channel.id !== newState.channel.id
  ) {
    voiceTimes.set(member.id, {
      channel: newState.channel.id,
      joinedAt: Date.now(),
    });

    console.log(
      `🔄 ${member.user.tag}: ${oldState.channel.name} → ${newState.channel.name}`
    );
  }
});

// ================================
// ЗАПУСК
// ================================

client.login(process.env.TOKEN);