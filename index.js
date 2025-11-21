require('dotenv').config();
const ffmpegPath = require('ffmpeg-static');
if (ffmpegPath) {
  process.env.FFMPEG_PATH = ffmpegPath;
}

const playdl = require('play-dl');

const {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const path = require('path');
const express = require('express');

// متن خوش‌آمدگویی
const WELCOME_MESSAGE_TEMPLATE = 'سلام {user} خوش اومدی به سرور ما 🌟';

// مسیر فایل عکس خوش‌آمدگویی (نسبت به این فایل)
// مثلا اگر عکس را در پوشه images کنار index.js بگذاری و اسمش welcome.png باشد:
// ./images/welcome.png
const WELCOME_IMAGE_PATH = path.join(__dirname, 'images', 'welcome.png');

// مسیر آهنگ خوش‌آمدگویی در وویس
// مثلا اگر فایل را در پوشه audio کنار index.js بگذاری و اسمش welcome.mp3 باشد:
// ./audio/welcome.mp3
const VOICE_MUSIC_PATH = path.join(__dirname, 'audio', 'welcome.mp3');

// متغیرهای محیطی
const TOKEN = process.env.DISCORD_TOKEN;
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;
const PANEL_PORT = process.env.PANEL_PORT || 3000;

if (!TOKEN) {
  console.error('DISCORD_TOKEN در فایل .env تنظیم نشده است.');
  process.exit(1);
}

if (!WELCOME_CHANNEL_ID) {
  console.error('WELCOME_CHANNEL_ID در فایل .env تنظیم نشده است.');
  process.exit(1);
}

// کلاینت دیسکورد
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// --- سیستم موزیک (صف در حافظه برای هر گیلد) ---
const musicQueues = new Map(); // guildId -> { connection, player, queue: [{ url, title, requestedBy }], playing }

async function getOrCreateMusicSession(guild, voiceChannel) {
  let session = musicQueues.get(guild.id);
  if (!session) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    connection.subscribe(player);

    session = {
      connection,
      player,
      queue: [],
      playing: false,
    };

    musicQueues.set(guild.id, session);

    player.on(AudioPlayerStatus.Idle, () => {
      if (session.queue.length > 0) {
        session.queue.shift();
      }
      if (session.queue.length > 0) {
        playNextInQueue(guild.id).catch((e) =>
          console.error('خطا در پخش ترک بعدی:', e)
        );
      } else {
        session.playing = false;
      }
    });
  }
  return session;
}

async function playNextInQueue(guildId) {
  const session = musicQueues.get(guildId);
  if (!session || session.queue.length === 0) return;

  const track = session.queue[0];
  try {
    const stream = await playdl.stream(track.url);
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });
    session.player.play(resource);
    session.playing = true;
  } catch (e) {
    console.error('خطا در استریم موزیک:', e);
    session.queue.shift();
    if (session.queue.length > 0) {
      return playNextInQueue(guildId);
    } else {
      session.playing = false;
    }
  }
}

// ولکامر + ثبت Slash Commandها
client.once(Events.ClientReady, async (c) => {
  console.log(`وارد شد به عنوان ${c.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('پخش موزیک از ساندکلاد در چنل وویس شما')
      .addStringOption((opt) =>
        opt
          .setName('query')
          .setDescription('نام آهنگ یا لینک ترک ساندکلاد')
          .setRequired(true)
          .setAutocomplete(true)
      ),
    new SlashCommandBuilder()
      .setName('skip')
      .setDescription('رد کردن ترک فعلی در صف موزیک'),
    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('توقف پخش موزیک و خالی کردن صف'),
    new SlashCommandBuilder()
      .setName('queue')
      .setDescription('نمایش صف فعلی موزیک'),
    new SlashCommandBuilder()
      .setName('claim')
      .setDescription('Claim کردن تیکت فعلی (فقط داخل چنل تیکت)')
  ].map((cmd) => cmd.toJSON());

  try {
    await c.application.commands.set(commands);
    console.log('Slash Commandها ثبت شدند.');
  } catch (err) {
    console.error('خطا در ثبت Slash Commandها:', err);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);

    if (!channel) {
      console.error('چنل خوش‌آمدگویی با این آیدی پیدا نشد:', WELCOME_CHANNEL_ID);
      return;
    }

    // ساخت متن خوش‌آمدگویی با منشن کاربر
    const welcomeText = WELCOME_MESSAGE_TEMPLATE.replace('{user}', `<@${member.id}>`);

    // ساخت attachment برای عکس
    const attachment = new AttachmentBuilder(WELCOME_IMAGE_PATH);

    await channel.send({
      content: welcomeText,
      files: [attachment],
    });
  } catch (error) {
    console.error('خطا در ارسال پیام خوش‌آمدگویی:', error);
  }
});

// --- سیستم تیکت و پنل ---

const app = express();
app.use(express.json());

// API: اتصال بات به یک چنل وویس
app.post('/voice/join', async (req, res) => {
  try {
    const { guildId, voiceChannelId } = req.body;

    if (!guildId || !voiceChannelId) {
      return res.status(400).json({ error: 'guildId و voiceChannelId الزامی هستند.' });
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: 'بات در این گیلد حضور ندارد.' });
    }

    const channel = guild.channels.cache.get(voiceChannelId);
    if (!channel || channel.type !== 2) {
      return res.status(400).json({ error: 'چنل انتخاب‌شده یک چنل وویس معتبر نیست.' });
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    // پخش آهنگ خوش‌آمدگویی از فایل لوکال
    try {
      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play,
        },
      });

      const resource = createAudioResource(VOICE_MUSIC_PATH);
      connection.subscribe(player);
      player.play(resource);

      player.on(AudioPlayerStatus.Idle, () => {
        player.stop();
      });
    } catch (e) {
      console.error('خطا در پخش آهنگ وویس:', e);
    }

    return res.json({ message: `بات به وویس ${channel.name} متصل شد.` });
  } catch (e) {
    console.error('خطا در اتصال به وویس:', e);
    return res.status(500).json({ error: 'خطا در اتصال به وویس.' });
  }
});

// API: لیست گیلدهایی که بات داخل آن‌ها است
app.get('/api/guilds', (req, res) => {
  try {
    const guilds = client.guilds.cache.map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.iconURL({ size: 64 }) || null,
    }));
    res.json({ guilds });
  } catch (e) {
    console.error('خطا در دریافت لیست گیلدها:', e);
    res.status(500).json({ error: 'خطا در دریافت لیست گیلدها.' });
  }
});

// API: ساختار یک گیلد (چنل‌ها و رول‌ها)
app.get('/api/guilds/:id/structure', async (req, res) => {
  try {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) {
      return res.status(404).json({ error: 'گیلد پیدا نشد یا بات داخل آن نیست.' });
    }

    const channels = guild.channels.cache.map((ch) => ({
      id: ch.id,
      name: ch.name,
      type: ch.type,
      parentId: ch.parentId,
    }));

    const roles = guild.roles.cache
      .filter((r) => r.name !== '@everyone')
      .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }));

    res.json({ channels, roles });
  } catch (e) {
    console.error('خطا در دریافت ساختار گیلد:', e);
    res.status(500).json({ error: 'خطا در دریافت ساختار گیلد.' });
  }
});

// سرو کردن پنل HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'panel.html'));
});

// دریافت اطلاعات پنل و ارسال پیام پنل تیکت در دیسکورد
app.post('/create-panel', async (req, res) => {
  try {
    const {
      guildId,
      panelChannelId,
      ticketCategoryId,
      supportRoleId,
      panelMessage,
      buttonLabel,
    } = req.body;

    if (!guildId || !panelChannelId || !ticketCategoryId || !supportRoleId) {
      return res.status(400).json({ error: 'لطفا همه آیدی‌ها را پر کنید.' });
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: 'بات در این گیلد حضور ندارد یا آیدی اشتباه است.' });
    }

    const channel = guild.channels.cache.get(panelChannelId);
    if (!channel) {
      return res.status(404).json({ error: 'چنل پنل پیدا نشد.' });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(
          JSON.stringify({
            t: 'openTicket',
            c: ticketCategoryId,
            r: supportRoleId,
          })
        )
        .setLabel(buttonLabel || 'ساخت تیکت')
        .setEmoji('🎫')
        .setStyle(ButtonStyle.Primary)
    );

    const embed = new EmbedBuilder()
      .setTitle('🎫 سیستم تیکت سرور')
      .setDescription(panelMessage || 'برای ساخت تیکت روی دکمه زیر کلیک کن.')
      .setColor(0x5865f2)
      .setFooter({ text: 'برای سوءاستفاده از تیکت‌ها ممکن است بن شوید.' })
      .setTimestamp();

    await channel.send({
      embeds: [embed],
      components: [row],
    });

    return res.json({ message: 'پنل تیکت با موفقیت ارسال شد.' });
  } catch (e) {
    console.error('خطا در ایجاد پنل تیکت:', e);
    return res.status(500).json({ error: 'خطای داخلی سرور.' });
  }
});

// هندل اینتراکشن‌ها (ساخت و بستن تیکت + مودال)
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Autocomplete برای /play (فقط echo ورودی، بدون تماس با ساندکلاد)
    if (interaction.isAutocomplete()) {
      const commandName = interaction.commandName;
      if (commandName === 'play') {
        const focused = interaction.options.getFocused(true); // { name: 'query', value: '...' }
        const query = focused.value;

        if (!query) {
          await interaction.respond([]);
          return;
        }

        await interaction.respond([
          {
            name: query.slice(0, 100),
            value: query,
          },
        ]);
      }
      return;
    }

    // Slash Commands
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'play') {
        const query = interaction.options.getString('query', true);

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const voiceChannel = member.voice.channel;
        if (!voiceChannel) {
          await interaction.reply({
            content: 'برای استفاده از /play باید داخل یک چنل وویس باشی.',
            ephemeral: true,
          });
          return;
        }

        const url = query;

        try {
          const valid = await playdl.validate(url);
          if (valid !== 'so_track') {
            await interaction.reply({
              content: 'لطفا یک لینک مستقیم ترک ساندکلاد وارد کن.',
              ephemeral: true,
            });
            return;
          }
        } catch (e) {
          console.error('خطا در آماده‌سازی پخش ساندکلاد:', e);
          await interaction.reply({
            content: 'در پردازش لینک ساندکلاد خطایی رخ داد.',
            ephemeral: true,
          });
          return;
        }

        const session = await getOrCreateMusicSession(interaction.guild, voiceChannel);
        const trackTitle = 'SoundCloud Track';
        session.queue.push({ url, title: trackTitle, requestedBy: interaction.user.id });

        await interaction.reply(`به صف اضافه شد: **${trackTitle}**`);

        if (!session.playing) {
          await playNextInQueue(interaction.guild.id);
        }
        return;
      }

      if (commandName === 'skip') {
        const session = musicQueues.get(interaction.guild.id);
        if (!session || session.queue.length === 0) {
          await interaction.reply({ content: 'صف خالی است.', ephemeral: true });
          return;
        }
        session.player.stop(true);
        await interaction.reply('ترک فعلی رد شد.');
        return;
      }

      if (commandName === 'stop') {
        const session = musicQueues.get(interaction.guild.id);
        if (!session) {
          await interaction.reply({ content: 'چیزی برای توقف وجود ندارد.', ephemeral: true });
          return;
        }
        session.queue = [];
        session.player.stop(true);
        session.playing = false;
        await interaction.reply('پخش موزیک متوقف شد و صف خالی شد.');
        return;
      }

      if (commandName === 'queue') {
        const session = musicQueues.get(interaction.guild.id);
        if (!session || session.queue.length === 0) {
          await interaction.reply({ content: 'صف خالی است.', ephemeral: true });
          return;
        }
        const lines = session.queue.map((t, i) => `${i === 0 ? '▶️' : `${i}.`} ${t.title}`);
        await interaction.reply('صف فعلی:\n' + lines.join('\n'));
        return;
      }

      if (commandName === 'claim') {
        const channel = interaction.channel;
        const topic = channel?.topic || '';

        if (!topic.startsWith('ticket|')) {
          await interaction.reply({
            content: 'این کامند فقط داخل چنل‌های تیکت قابل استفاده است.',
            ephemeral: true,
          });
          return;
        }

        const parts = Object.fromEntries(
          topic
            .split('|')
            .slice(1)
            .map((kv) => kv.split('='))
        );

        const ticketId = parts.id || 'نامشخص';
        const ownerId = parts.owner;
        const supportRoleId = parts.support;

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const isAdmin = member.permissions.has('Administrator');
        const isSupport = supportRoleId ? member.roles.cache.has(supportRoleId) : false;

        if (!isAdmin && !isSupport) {
          await interaction.reply({
            content: 'فقط اعضای تیم پشتیبانی می‌توانند این تیکت را Claim کنند.',
            ephemeral: true,
          });
          return;
        }

        const claimedName = channel.name.startsWith('ticket-')
          ? `ticket-${interaction.user.username}-${ticketId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
          : channel.name;

        await channel.setName(claimedName);

        const descriptionLines = [
          `این تیکت توسط <@${interaction.user.id}> در حال پیگیری است.`,
        ];
        if (ownerId) {
          descriptionLines.push(`صاحب تیکت: <@${ownerId}>`);
        }

        const claimEmbed = new EmbedBuilder()
          .setTitle('✅ این تیکت Claim شد')
          .setColor(0xfacc15)
          .setDescription(descriptionLines.join('\n'))
          .addFields(
            {
              name: '🆔 شناسه تیکت',
              value: `#${ticketId}`,
              inline: true,
            },
            {
              name: '⏳ وضعیت',
              value: 'در حال بررسی توسط پشتیبانی',
              inline: true,
            }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [claimEmbed] });
        return;
      }
    }

    // مرحله ۱: کلیک روی دکمه «ساخت تیکت» → نمایش منوی انتخاب نوع تیکت
    if (interaction.isButton()) {
      let data;
      try {
        data = JSON.parse(interaction.customId);
      } catch {
        // برای سایر دکمه‌ها که JSON نیستند
        if (interaction.customId.startsWith('closeTicket')) {
          // این بخش فعلاً استفاده نمی‌شود چون closeTicket هم JSON است
        }
        return;
      }

      if (data.t === 'openTicket') {
        const { c: ticketCategoryId, r: supportRoleId } = data;

        const select = new StringSelectMenuBuilder()
          .setCustomId(`ticketTypeSelect:${ticketCategoryId}:${supportRoleId}`)
          .setPlaceholder('نوع تیکت را انتخاب کنید')
          .addOptions(
            {
              label: 'ساپورت فنی',
              value: 'support',
              description: 'مشکلات فنی، باگ‌ها، ارورها و ...',
              emoji: '🛠️',
            },
            {
              label: 'گزارش کاربر / ریپورت',
              value: 'report',
              description: 'رفتار نامناسب، اسپم، توهین و ...',
              emoji: '🚫',
            },
            {
              label: 'درخواست همکاری / اپلای',
              value: 'apply',
              description: 'اپلای برای استاف، مود، ادیتور و ...',
              emoji: '🧑‍💼',
            },
            {
              label: 'سایر موارد',
              value: 'other',
              description: 'هر موضوع دیگری که اینجا نبود',
              emoji: '❓',
            }
          );

        const row = new ActionRowBuilder().addComponents(select);

        await interaction.reply({
          content: 'لطفا نوع تیکت خود را انتخاب کنید:',
          components: [row],
          ephemeral: true,
        });
        return;
      }

      if (data.t === 'closeTicket') {
        const channelId = data.ch;
        if (!channelId) return;

        const channel = interaction.guild.channels.cache.get(channelId);
        if (!channel) return;

        await interaction.reply({
          content: 'این تیکت تا چند ثانیه دیگر بسته می‌شود.',
          ephemeral: true,
        });

        setTimeout(() => {
          channel.delete('Ticket closed');
        }, 5000);
        return;
      }

      return;
    }

    // مرحله ۲: انتخاب نوع تیکت از منو → نمایش مودال موضوع/توضیحات
    if (interaction.isStringSelectMenu()) {
      const customId = interaction.customId;
      if (!customId.startsWith('ticketTypeSelect:')) return;

      const [, ticketCategoryId, supportRoleId] = customId.split(':');
      const selectedTypeKey = interaction.values[0] || 'other';

      const modal = new ModalBuilder()
        .setCustomId(`ticketModal:${ticketCategoryId}:${supportRoleId}:${selectedTypeKey}`)
        .setTitle('ساخت تیکت جدید');

      const subjectInput = new TextInputBuilder()
        .setCustomId('ticketSubject')
        .setLabel('موضوع تیکت')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const descInput = new TextInputBuilder()
        .setCustomId('ticketDescription')
        .setLabel('توضیحات (هرچه کامل‌تر، بهتر)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

      const row1 = new ActionRowBuilder().addComponents(subjectInput);
      const row2 = new ActionRowBuilder().addComponents(descInput);

      modal.addComponents(row1, row2);

      await interaction.showModal(modal);
      return;
    }

    // مرحله ۳: Submit شدن مودال → ساخت چنل تیکت و ارسال Embed حرفه‌ای
    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;
      if (!customId.startsWith('ticketModal:')) return;

      const parts = customId.split(':');
      const ticketCategoryId = parts[1];
      const supportRoleId = parts[2];
      const typeKey = parts[3] || 'other';

      const typeMap = {
        support: 'ساپورت فنی',
        report: 'گزارش کاربر',
        apply: 'درخواست همکاری',
        other: 'سایر',
      };

      const decodedType = typeMap[typeKey] || 'سایر';

      const ticketSubject = interaction.fields.getTextInputValue('ticketSubject');
      const ticketDescription = interaction.fields.getTextInputValue('ticketDescription');

      const guild = interaction.guild;
      const supportRole = guild.roles.cache.get(supportRoleId);

      const shortId = Math.random().toString(36).substring(2, 6).toUpperCase();
      const channelName = `ticket-${interaction.user.username}-${shortId}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-');

      const ticketChannel = await guild.channels.create({
        name: channelName,
        parent: ticketCategoryId,
        topic: `ticket|id=${shortId}|type=${typeKey}|owner=${interaction.user.id}|support=${supportRoleId}`,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
          supportRole
            ? {
                id: supportRole.id,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.ReadMessageHistory,
                ],
              }
            : null,
        ].filter(Boolean),
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(JSON.stringify({ t: 'closeTicket', ch: ticketChannel.id }))
          .setLabel('بستن تیکت')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Danger)
      );

      const ticketEmbed = new EmbedBuilder()
        .setTitle(`🎫 تیکت جدید | ${decodedType}`)
        .setColor(0x2ecc71)
        .setDescription(
          [
            `سلام <@${interaction.user.id}> 👋`,
            '',
            'اطلاعات تیکت شما در زیر آمده است. لطفا اگر نکته‌ای جا مانده، در ادامه همین چنل ارسال کن.',
          ].join('\n')
        )
        .addFields(
          {
            name: '🆔 شناسه تیکت',
            value: `#${shortId}`,
            inline: true,
          },
          {
            name: '� ایجادکننده',
            value: `<@${interaction.user.id}>`,
            inline: true,
          },
          {
            name: '📂 نوع تیکت',
            value: decodedType || 'نامشخص',
            inline: true,
          },
          {
            name: '📝 موضوع',
            value: ticketSubject || 'بدون موضوع',
          },
          {
            name: '📣 توضیحات کاربر',
            value: ticketDescription || 'بدون توضیحات',
          },
          {
            name: '�� پشتیبانی',
            value: supportRole ? `<@&${supportRoleId}> لطفا این تیکت را بررسی کنید.` : 'رول ساپورت تنظیم نشده است.',
          },
          {
            name: '📌 قوانین کوتاه',
            value:
              '• فقط موضوع همین تیکت را مطرح کن.\n' +
              '• از اسپم و منشن بی‌دلیل خودداری کن.\n' +
              '• در صورت حل شدن مشکل، روی دکمه بستن تیکت کلیک کن.',
          }
        )
        .setFooter({ text: `تیکت برای ${interaction.user.tag}` })
        .setTimestamp();

      await ticketChannel.send({
        embeds: [ticketEmbed],
        components: [row],
      });

      await interaction.reply({
        content: `تیکت شما ساخته شد: ${ticketChannel} (ID: #${shortId})`,
        ephemeral: true,
      });

      return;
    }
  } catch (err) {
    console.error('خطا در هندل اینتراکشن تیکت:', err);
  }
});

// لاگین بات و استارت سرور پنل
client
  .login(TOKEN)
  .then(() => {
    app.listen(PANEL_PORT, () => {
      console.log(`پنل تیکت روی پورت ${PANEL_PORT} اجرا شد: http://localhost:${PANEL_PORT}`);
    });
  })
  .catch((err) => {
    console.error('خطا در لاگین بات:', err);
  });

// کامندهای متنی: !claim (تیکت) و موزیک !play / !skip / !stop / !queue
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();

    // --- !claim فقط در چنل‌های تیکت ---
    if (lower === '!claim') {
      const channel = message.channel;
      const topic = channel.topic || '';

      if (!topic.startsWith('ticket|')) {
        return; // فقط روی چنل‌هایی که تیکت هستند کار کند
      }

      const parts = Object.fromEntries(
        topic
          .split('|')
          .slice(1)
          .map((kv) => kv.split('='))
      );

      const ticketId = parts.id || 'نامشخص';
      const ownerId = parts.owner;
      const supportRoleId = parts.support;

      const member = await message.guild.members.fetch(message.author.id);
      const isAdmin = member.permissions.has('Administrator');
      const isSupport = supportRoleId ? member.roles.cache.has(supportRoleId) : false;

      if (!isAdmin && !isSupport) {
        await message.reply({
          content: 'فقط اعضای تیم پشتیبانی می‌توانند این تیکت را Claim کنند.',
        });
        return;
      }

      const claimedName = channel.name.startsWith('ticket-')
        ? `ticket-${message.author.username}-${ticketId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
        : channel.name;

      await channel.setName(claimedName);

      const descriptionLines = [
        `این تیکت توسط <@${message.author.id}> در حال پیگیری است.`,
      ];
      if (ownerId) {
        descriptionLines.push(`صاحب تیکت: <@${ownerId}>`);
      }

      const claimEmbed = new EmbedBuilder()
        .setTitle('✅ این تیکت Claim شد')
        .setColor(0xfacc15)
        .setDescription(descriptionLines.join('\n'))
        .addFields(
          {
            name: '🆔 شناسه تیکت',
            value: `#${ticketId}`,
            inline: true,
          },
          {
            name: '⏳ وضعیت',
            value: 'در حال بررسی توسط پشتیبانی',
            inline: true,
          }
        )
        .setTimestamp();

      await message.channel.send({ embeds: [claimEmbed] });
      return;
    }

    // --- کامندهای موزیک ---
    if (lower.startsWith('!play ')) {
      const url = content.slice('!play '.length).trim();
      if (!url) return;

      const member = await message.guild.members.fetch(message.author.id);
      const voiceChannel = member.voice.channel;
      if (!voiceChannel) {
        await message.reply('برای استفاده از !play باید داخل یک چنل وویس باشی.');
        return;
      }

      const valid = await playdl.validate(url);
      if (valid !== 'so_track') {
        await message.reply('لطفا لینک یک ترک ساندکلاد معتبر وارد کن.');
        return;
      }

      const info = await playdl.video_info(url).catch(() => null);
      const title = info?.video_details?.title || 'Track';

      const session = await getOrCreateMusicSession(message.guild, voiceChannel);
      session.queue.push({ url, title, requestedBy: message.author.id });

      await message.reply(`به صف اضافه شد: **${title}**`);

      if (!session.playing) {
        await playNextInQueue(message.guild.id);
      }
      return;
    }

    if (lower === '!skip') {
      const session = musicQueues.get(message.guild.id);
      if (!session || session.queue.length === 0) {
        await message.reply('صف خالی است.');
        return;
      }
      session.player.stop(true);
      await message.reply('ترک فعلی رد شد.');
      return;
    }

    if (lower === '!stop') {
      const session = musicQueues.get(message.guild.id);
      if (!session) {
        await message.reply('چیزی برای توقف وجود ندارد.');
        return;
      }
      session.queue = [];
      session.player.stop(true);
      session.playing = false;
      await message.reply('پخش موزیک متوقف شد و صف خالی شد.');
      return;
    }

    if (lower === '!queue') {
      const session = musicQueues.get(message.guild.id);
      if (!session || session.queue.length === 0) {
        await message.reply('صف خالی است.');
        return;
      }
      const lines = session.queue.map((t, i) => `${i === 0 ? '▶️' : `${i}.`} ${t.title}`);
      await message.reply('صف فعلی:\n' + lines.join('\n'));
      return;
    }
  } catch (err) {
    console.error('خطا در کامندهای متنی:', err);
  }
});
