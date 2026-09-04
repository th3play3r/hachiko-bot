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

const http = require("http");

// Render требует открытый порт
const PORT = process.env.PORT || 10000;

http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("Hachiko is alive");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 Web-сервер запущен на порту ${PORT}`);
  });

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

// Данные участников
// userId → { xp, voiceSeconds, joinedAt }
const users = new Map();

// Защита от слишком частого получения XP за сообщения
const messageCooldowns = new Map();

// ================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ================================

function getUser(userId) {
  if (!users.has(userId)) {
    users.set(userId, {
      xp: 0,
      voiceSeconds: 0,
      joinedAt: null,
    });
  }

  return users.get(userId);
}

function getRequiredXp(level) {
  return level * 100;
}

function getLevel(xp) {
  let level = 1;
  let required = getRequiredXp(level);

  while (xp >= required) {
    xp -= required;
    level++;
    required = getRequiredXp(level);
  }

  return {
    level,
    currentXp: xp,
    requiredXp: required,
  };
}

function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}ч ${minutes}м`;
  }

  return `${minutes}м`;
}

function addXp(member, amount) {
  const user = getUser(member.id);
  const oldLevel = getLevel(user.xp).level;

  user.xp += amount;

  const newLevel = getLevel(user.xp).level;

  if (newLevel > oldLevel) {
    const channel = member.guild.systemChannel;

    if (channel) {
      channel.send(
        `🎉 Поздравляем, ${member}! Ты достиг **${newLevel} уровня**!`
      );
    }
  }
}

// ================================
// BOT READY
// ================================

client.once("clientReady", () => {
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
// СООБЩЕНИЯ И КОМАНДЫ
// ================================

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const command = message.content.toLowerCase().trim();
  const member = message.member;

  // XP за сообщение, но не чаще одного раза в минуту
  const lastMessage = messageCooldowns.get(member.id) || 0;

  if (Date.now() - lastMessage >= 60000) {
    addXp(member, 10);
    messageCooldowns.set(member.id, Date.now());
  }

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
        "",
        "📊 **Статистика**",
        "`!rank` — твой уровень и опыт",
        "`!voicetime` — твоё время в голосовом",
        "`!topvoice` — топ участников по войсу",
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

  // !stay
  if (command === "!stay") {
    const channel = member?.voice?.channel;

    if (!channel) {
      return message.reply("❌ Сначала зайди в голосовой канал.");
    }

    const permissions = channel.permissionsFor(message.guild.members.me);

    if (!permissions?.has(PermissionsBitField.Flags.Connect)) {
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

      return message.reply(`🎧 Залетел в **${channel.name}**`);
    } catch (error) {
      console.error(error);
      return message.reply("❌ Не получилось подключиться.");
    }
  }

  // !leave
  if (command === "!leave") {
    const connection = getVoiceConnection(message.guild.id);

    if (!connection) {
      return message.reply("🐕 Я и так нигде не нахожусь.");
    }

    connection.destroy();

    return message.reply("👋 Вышел из голосового.");
  }

  // !rank
  if (command === "!rank") {
    const user = getUser(member.id);
    const level = getLevel(user.xp);

    return message.reply(
      [
        `🐕 **Профиль ${member.displayName}**`,
        "",
        `⭐ Уровень: **${level.level}**`,
        `✨ Опыт: **${level.currentXp} / ${level.requiredXp} XP**`,
        `🎤 Время в голосовом: **${formatTime(user.voiceSeconds)}**`,
      ].join("\n")
    );
  }

  // !voicetime
  if (command === "!voicetime") {
    const user = getUser(member.id);
    let seconds = user.voiceSeconds;

    // Если человек сейчас в войсе, учитываем текущее время
    if (user.joinedAt) {
      seconds += Math.floor((Date.now() - user.joinedAt) / 1000);
    }

    return message.reply(
      `🎤 ${member.displayName} провёл в голосовом **${formatTime(seconds)}**`
    );
  }

  // !topvoice
  if (command === "!topvoice") {
    const ranking = [...users.entries()]
      .map(([userId, data]) => {
        let seconds = data.voiceSeconds;

        if (data.joinedAt) {
          seconds += Math.floor((Date.now() - data.joinedAt) / 1000);
        }

        return {
          userId,
          seconds,
        };
      })
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 10);

    if (ranking.length === 0) {
      return message.reply("📊 Пока никто не набрал голосовое время.");
    }

    const lines = [];

    for (let i = 0; i < ranking.length; i++) {
      const item = ranking[i];
      const guildMember = await message.guild.members
        .fetch(item.userId)
        .catch(() => null);

      const name = guildMember?.displayName || "Неизвестный участник";

      lines.push(
        `${i + 1}. **${name}** — ${formatTime(item.seconds)}`
      );
    }

    return message.reply(
      `🏆 **Топ голосового времени**\n\n${lines.join("\n")}`
    );
  }
});

// ================================
// ВХОД И ВЫХОД ИЗ ГОЛОСОВОГО
// ================================

client.on("voiceStateUpdate", (oldState, newState) => {
  const member = newState.member;

  if (!member || member.user.bot) return;

  const user = getUser(member.id);

  // Участник впервые зашёл в голосовой
  if (!oldState.channel && newState.channel) {
    user.joinedAt = Date.now();

    console.log(
      `🎤 ${member.user.tag} зашёл в ${newState.channel.name}`
    );
  }

  // Участник вышел из голосового
  if (oldState.channel && !newState.channel) {
    if (user.joinedAt) {
      const seconds = Math.floor(
        (Date.now() - user.joinedAt) / 1000
      );

      user.voiceSeconds += seconds;
      user.joinedAt = null;

      // 1 XP за каждую минуту в голосовом
      addXp(member, Math.floor(seconds / 60));

      console.log(
        `🚪 ${member.user.tag} вышел из ${oldState.channel.name}. Время: ${formatTime(seconds)}`
      );
    }
  }

  // Участник перешёл в другой канал
  if (
    oldState.channel &&
    newState.channel &&
    oldState.channel.id !== newState.channel.id
  ) {
    if (user.joinedAt) {
      const seconds = Math.floor(
        (Date.now() - user.joinedAt) / 1000
      );

      user.voiceSeconds += seconds;
      addXp(member, Math.floor(seconds / 60));
    }

    user.joinedAt = Date.now();

    console.log(
      `🔄 ${member.user.tag}: ${oldState.channel.name} → ${newState.channel.name}`
    );
  }
});

// ================================
// СОХРАНЕНИЕ ВРЕМЕНИ КАЖДУЮ МИНУТУ
// ================================

// Чтобы время начислялось даже если человек долго сидит в войсе
setInterval(() => {
  for (const [userId, user] of users.entries()) {
    if (!user.joinedAt) continue;

    const seconds = Math.floor(
      (Date.now() - user.joinedAt) / 1000
    );

    if (seconds >= 60) {
      const member = client.guilds.cache
        .map((guild) => guild.members.cache.get(userId))
        .find(Boolean);

      user.voiceSeconds += seconds;
      user.joinedAt = Date.now();

      if (member) {
        addXp(member, Math.floor(seconds / 60));
      }
    }
  }
}, 60000);

// ================================
// ЗАПУСК
// ================================

client.login(process.env.TOKEN);
