require("dotenv").config();

const fs = require("fs");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  PermissionFlagsBits
} = require("discord.js");

/* =========================
   CONFIG
========================= */

const ADMIN_ID = "1458209320540966973";

const CHANNELS = {
  SCOREBOARD: "1498768466080043131",
  POINT_SYSTEM: "1498769149369778390",
  PREMATCH: "1498749992058486815",
  LIVE: "1498765512526528574",
  POINTS_FEED: "1499051381829664989"
};

const POINTS = {
  EXACT_RESULT: 10,
  NEXT_TEAM: 1,
  NEXT_SCORER: 3,
  YELLOW_CARD: 3,
  EVENT_JOIN: 1,
  NO_SHOW: -3
};

const DB_FILE = "./db.json";

/* =========================
   CLIENT
========================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

/* =========================
   LOCAL DB JSON
========================= */

function defaultDb() {
  return {
    scores: {},
    scoreboardMessageId: null,
    pointSystemMessageId: null,
    prematchPanelMessageId: null,
    livePanelMessageId: null,

    prematch: {
      active: false,
      home: null,
      away: null,
      liveScore: null,
      closesAt: null,
      predictions: {}
    },

    goal: {
      active: false,
      closesAt: null,
      predictions: {},
      awarded: {}
    },

    yellow: {
      active: false,
      closesAt: null,
      predictions: {},
      awarded: {}
    }
  };
}

function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb(), null, 2));
  }

  const raw = fs.readFileSync(DB_FILE, "utf8");
  return JSON.parse(raw);
}

function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function normalizeYellowAwarded(db) {
  if (!db.yellow.awarded) db.yellow.awarded = {};

  for (const userId of Object.keys(db.yellow.awarded)) {
    if (db.yellow.awarded[userId] === true) {
      db.yellow.awarded[userId] = {
        player1: true,
        player2: true
      };
    }

    if (db.yellow.awarded[userId] === false) {
      db.yellow.awarded[userId] = {};
    }
  }

  return db;
}

function changePoints(db, userId, amount) {
  db.scores[userId] = (db.scores[userId] || 0) + amount;
  return db.scores[userId];
}

function addPoints(userId, amount) {
  const db = loadDb();
  changePoints(db, userId, amount);
  saveDb(db);
}

function getPoints(userId) {
  const db = loadDb();
  return db.scores[userId] || 0;
}

function isAdmin(interaction) {
  return interaction.user.id === ADMIN_ID;
}

/* =========================
   EMBEDS
========================= */

function scoreboardEmbed(db) {
  const sorted = Object.entries(db.scores)
    .sort((a, b) => b[1] - a[1]);

  const lines = sorted.length
    ? sorted.map(([id, points], index) => {
        const medal =
          index === 0 ? "🥇" :
          index === 1 ? "🥈" :
          index === 2 ? "🥉" :
          "🔇";

        return `**${index + 1}.** ${medal} <@${id}> — **${points} pts**`;
      }).join("\n")
    : "Ingen points endnu.";

  return new EmbedBuilder()
    .setColor(0xffd166)
    .setTitle("🏆 ALL TIME SCOREBOARD")
    .setDescription(lines)
    .addFields({
      name: "Admin controls",
      value: "Brug knapperne under embedden eller `/addpoints` og `/removepoints`."
    })
    .setFooter({ text: "Dino Point System • Live synced" })
    .setTimestamp();
}

function scoreboardButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("admin_add_points")
      .setLabel("➕ Add Points")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("admin_remove_points")
      .setLabel("➖ Fjern Points")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("refresh_scoreboard")
      .setLabel("🔄 Refresh")
      .setStyle(ButtonStyle.Secondary)
  );
}

function pointSystemEmbed() {
  return new EmbedBuilder()
    .setColor(0x9b5cff)
    .setTitle("🦖 DINO FUCKER POINT SYSTEM")
    .setDescription(
      [
        "Sådan får og mister man points under vores football events:",
        "",
        `✅ **Korrekt gættet resultat** = **+${POINTS.EXACT_RESULT} Points**`,
        `⚽ **Gæt næste hold der scorer** = **+${POINTS.NEXT_TEAM} Point**`,
        `🥅 **Gæt næste målscorer** = **+${POINTS.NEXT_SCORER} Points**`,
        `🟨 **Gæt spiller der får gult kort** = **+${POINTS.YELLOW_CARD} Points**`,
        `👥 **Deltager i event** = **+${POINTS.EVENT_JOIN} Point**`,
        "",
        `❌ **Møder ikke op til tiden selvom du stemte Ja** = **${POINTS.NO_SHOW} Points**`
      ].join("\n")
    )
    .setFooter({ text: "Alt bliver logget automatisk i points-feed." })
    .setTimestamp();
}

function prematchPanelEmbed(db) {
  const p = db.prematch;

  if (!p.active) {
    return new EmbedBuilder()
      .setColor(0x00b4d8)
      .setTitle("📋 Før Kamp Prediction")
      .setDescription(
        [
          "Her bliver pre-match predictions oprettet.",
          "",
          "**Sådan virker det:**",
          "1. Admin klikker **Opret Ny Prediction**",
          "2. Folk klikker **Giv Prediction**",
          "3. Man skriver sit resultat, fx `2-1`",
          "4. Når kampen slutter, får korrekte guesses automatisk points",
          "",
          "Ingen aktiv kamp lige nu."
        ].join("\n")
      )
      .setFooter({ text: "Kun én prediction per person." });
  }

  return renderPrematchEmbed(db);
}

function prematchButtons(db) {
  const row = new ActionRowBuilder();

  row.addComponents(
    new ButtonBuilder()
      .setCustomId("prematch_create")
      .setLabel("🆕 Opret Ny Prediction")
      .setStyle(ButtonStyle.Primary)
  );

  if (db.prematch.active) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId("prematch_submit")
        .setLabel("✍️ Giv Prediction")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("prematch_live_score")
        .setLabel("📊 Sæt Live Score")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("prematch_end")
        .setLabel("🏁 Afslut Kamp")
        .setStyle(ButtonStyle.Danger)
    );
  }

  return row;
}

function renderPrematchEmbed(db) {
  const p = db.prematch;
  const now = Date.now();
  const closed = p.closesAt && now > p.closesAt;

  const currentScore = parseScore(p.liveScore || "0-0");

  const predictions = Object.entries(p.predictions);

  const lines = predictions.length
    ? predictions.map(([userId, pred]) => {
        const parsed = parseScore(pred.score);
        const eliminated =
          currentScore &&
          parsed &&
          (parsed.home < currentScore.home || parsed.away < currentScore.away);

        const text = `<@${userId}> → **${pred.score}**`;
        return eliminated ? `~~${text}~~ 💀` : `${text} ✅`;
      }).join("\n")
    : "Ingen predictions endnu.";

  return new EmbedBuilder()
    .setColor(closed ? 0xf77f00 : 0x00b4d8)
    .setTitle(`📋 Før Kamp: ${p.home} vs ${p.away}`)
    .setDescription(
      [
        p.liveScore ? `**Live score:** \`${p.liveScore}\`` : "**Live score:** Ikke sat endnu",
        p.closesAt ? `**Lukker:** <t:${Math.floor(p.closesAt / 1000)}:R>` : "",
        "",
        "**Predictions:**",
        lines,
        "",
        closed ? "🔒 Prediction er lukket." : "🟢 Prediction er åben."
      ].join("\n")
    )
    .setFooter({ text: "Rigtigt slutresultat giver +10 points." })
    .setTimestamp();
}

function livePanelEmbed(db) {
  return new EmbedBuilder()
    .setColor(0x06d6a0)
    .setTitle("🔴 Live Predictions")
    .setDescription(
      [
        "**Næste Scorer**",
        "Klik **Start Næste Scorer**. Folk har 2 minutter til at gætte hold + spiller.",
        "",
        "**Gult Kort**",
        "Klik **Start Gult Kort**. Folk kan gætte 2 spillere i hele kampen.",
        "",
        "Alle points går direkte i scoreboard og points-feed."
      ].join("\n")
    )
    .addFields(
      {
        name: "Næste Scorer Status",
        value: goalStatus(db)
      },
      {
        name: "Gult Kort Status",
        value: yellowStatus(db)
      }
    )
    .setTimestamp();
}

function liveButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("goal_start")
        .setLabel("▶️ Start Næste Scorer")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("goal_submit")
        .setLabel("✍️ Add Prediction")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("goal_scored")
        .setLabel("⚽ Mål Scoret")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("goal_reset")
        .setLabel("🔁 Reset")
        .setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("yellow_start")
        .setLabel("▶️ Start Gult Kort")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("yellow_submit")
        .setLabel("🟨 Gæt 2 Spillere")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("yellow_award")
        .setLabel("🎁 Giv Yellow Points")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("yellow_end")
        .setLabel("🏁 Afslut Yellow")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function goalStatus(db) {
  const g = db.goal;
  const entries = Object.entries(g.predictions);

  if (!g.active) return "Ingen aktiv runde.";

  const lines = entries.length
    ? entries.map(([id, p]) => `<@${id}> → **${p.team} / ${p.player}**`).join("\n")
    : "Ingen predictions endnu.";

  return [
    `Lukker: <t:${Math.floor(g.closesAt / 1000)}:R>`,
    lines
  ].join("\n");
}

function yellowStatus(db) {
  const y = db.yellow;
  const entries = Object.entries(y.predictions);

  if (!y.active) return "Ingen aktiv yellow-card runde.";

  const lines = entries.length
    ? entries.map(([id, p]) => {
        const awarded = y.awarded[id] || {};

        const player1 = awarded.player1
          ? `~~**${p.player1}**~~ ✅`
          : `**${p.player1}** ⏳`;

        const player2 = awarded.player2
          ? `~~**${p.player2}**~~ ✅`
          : `**${p.player2}** ⏳`;

        const done = awarded.player1 && awarded.player2
          ? "🏁 Færdig"
          : "⏳ Mangler stadig";

        return `<@${id}> → ${player1} / ${player2} — ${done}`;
      }).join("\n")
    : "Ingen predictions endnu.";

  return [
    `Lukker: <t:${Math.floor(y.closesAt / 1000)}:R>`,
    lines
  ].join("\n");
}

/* =========================
   HELPERS
========================= */

function parseScore(input) {
  if (!input) return null;
  const match = input.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!match) return null;

  return {
    home: Number(match[1]),
    away: Number(match[2])
  };
}

async function updateScoreboard() {
  const db = loadDb();
  if (!db.scoreboardMessageId) return;

  const channel = await client.channels.fetch(CHANNELS.SCOREBOARD).catch(() => null);
  if (!channel) return;

  const msg = await channel.messages.fetch(db.scoreboardMessageId).catch(() => null);
  if (!msg) return;

  await msg.edit({
    embeds: [scoreboardEmbed(db)],
    components: [scoreboardButtons()]
  });
}

async function updatePrematchPanel() {
  const db = loadDb();
  if (!db.prematchPanelMessageId) return;

  const channel = await client.channels.fetch(CHANNELS.PREMATCH).catch(() => null);
  if (!channel) return;

  const msg = await channel.messages.fetch(db.prematchPanelMessageId).catch(() => null);
  if (!msg) return;

  await msg.edit({
    embeds: [prematchPanelEmbed(db)],
    components: [prematchButtons(db)]
  });
}

async function updateLivePanel() {
  const db = loadDb();
  if (!db.livePanelMessageId) return;

  const channel = await client.channels.fetch(CHANNELS.LIVE).catch(() => null);
  if (!channel) return;

  const msg = await channel.messages.fetch(db.livePanelMessageId).catch(() => null);
  if (!msg) return;

  await msg.edit({
    embeds: [livePanelEmbed(db)],
    components: liveButtons()
  });
}

async function sendPointFeed(userId, amount, reason) {
  const channel = await client.channels.fetch(CHANNELS.POINTS_FEED).catch(() => null);
  if (!channel) return;

  const positive = amount >= 0;

  const embed = new EmbedBuilder()
    .setColor(positive ? 0x06d6a0 : 0xef476f)
    .setTitle(positive ? "➕ Points Added" : "➖ Points Removed")
    .setDescription(
      [
        `**User:** <@${userId}>`,
        `**Ændring:** ${positive ? "+" : ""}${amount} points`,
        `**Reason:** ${reason}`,
        `**Ny total:** ${getPoints(userId)} points`
      ].join("\n")
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

function adminOnlyReply(interaction) {
  return interaction.reply({
    content: "❌ Kun Marcus kan bruge den her.",
    ephemeral: true
  });
}

/* =========================
   SLASH COMMANDS
========================= */

const commands = [
  new SlashCommandBuilder()
    .setName("setupscoreboard")
    .setDescription("Poster scoreboard embed"),

  new SlashCommandBuilder()
    .setName("setuppoints")
    .setDescription("Poster point system embed"),

  new SlashCommandBuilder()
    .setName("setupprematch")
    .setDescription("Poster før-kamp prediction panel"),

  new SlashCommandBuilder()
    .setName("setuplive")
    .setDescription("Poster live prediction panel"),

  new SlashCommandBuilder()
    .setName("addpoints")
    .setDescription("Tilføj points")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Hvem skal have points?")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("Hvor mange points?")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Hvorfor?")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("removepoints")
    .setDescription("Fjern points")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Hvem skal miste points?")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("Hvor mange points?")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Hvorfor?")
        .setRequired(false)
    )
].map(cmd => cmd.toJSON());

async function deployCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );

  console.log("✅ Slash commands deployed");
}

/* =========================
   MODALS
========================= */

function pointsModal(type) {
  return new ModalBuilder()
    .setCustomId(type)
    .setTitle(type === "modal_add_points" ? "Add Points" : "Fjern Points")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("userId")
          .setLabel("Discord User ID")
          .setPlaceholder("Fx 1458209320540966973")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("Amount")
          .setPlaceholder("Fx 3")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Reason")
          .setPlaceholder("Fx No show / korrekt guess")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      )
    );
}

function prematchCreateModal() {
  return new ModalBuilder()
    .setCustomId("modal_prematch_create")
    .setTitle("Opret Før Kamp Prediction")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("home")
          .setLabel("Hjemmehold")
          .setPlaceholder("Fx Chelsea")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("away")
          .setLabel("Udehold")
          .setPlaceholder("Fx Arsenal")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("minutes")
          .setLabel("Hvor mange minutter må folk svare?")
          .setPlaceholder("Fx 10")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function prematchSubmitModal() {
  return new ModalBuilder()
    .setCustomId("modal_prematch_submit")
    .setTitle("Giv Prediction")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("score")
          .setLabel("Dit resultat")
          .setPlaceholder("Fx 2-1")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function liveScoreModal() {
  return new ModalBuilder()
    .setCustomId("modal_prematch_live_score")
    .setTitle("Sæt Live Score")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("score")
          .setLabel("Live score")
          .setPlaceholder("Fx 2-0")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function goalSubmitModal() {
  return new ModalBuilder()
    .setCustomId("modal_goal_submit")
    .setTitle("Næste Scorer Prediction")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("team")
          .setLabel("Hvilket hold scorer?")
          .setPlaceholder("Fx Chelsea")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("player")
          .setLabel("Hvilken spiller scorer?")
          .setPlaceholder("Fx Palmer")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function yellowSubmitModal() {
  return new ModalBuilder()
    .setCustomId("modal_yellow_submit")
    .setTitle("Gult Kort Prediction")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("player1")
          .setLabel("Spiller 1")
          .setPlaceholder("Fx Caicedo")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("player2")
          .setLabel("Spiller 2")
          .setPlaceholder("Fx Enzo")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

/* =========================
   INTERACTIONS
========================= */

client.on("interactionCreate", async interaction => {
  try {     let db = loadDb();
    db = normalizeYellowAwarded(db);
    saveDb(db);
    if (interaction.isChatInputCommand()) {
      db = loadDb();
db = normalizeYellowAwarded(db);

      if (
        ["setupscoreboard", "setuppoints", "setupprematch", "setuplive", "addpoints", "removepoints"]
          .includes(interaction.commandName)
        && !isAdmin(interaction)
      ) {
        return adminOnlyReply(interaction);
      }

      if (interaction.commandName === "setupscoreboard") {
        const channel = await client.channels.fetch(CHANNELS.SCOREBOARD);
        const msg = await channel.send({
          embeds: [scoreboardEmbed(db)],
          components: [scoreboardButtons()]
        });

        db.scoreboardMessageId = msg.id;
        saveDb(db);

        return interaction.reply({ content: "✅ Scoreboard posted.", ephemeral: true });
      }

      if (interaction.commandName === "setuppoints") {
        const channel = await client.channels.fetch(CHANNELS.POINT_SYSTEM);
        const msg = await channel.send({ embeds: [pointSystemEmbed()] });

        db.pointSystemMessageId = msg.id;
        saveDb(db);

        return interaction.reply({ content: "✅ Point system posted.", ephemeral: true });
      }

      if (interaction.commandName === "setupprematch") {
        const channel = await client.channels.fetch(CHANNELS.PREMATCH);
        const msg = await channel.send({
          embeds: [prematchPanelEmbed(db)],
          components: [prematchButtons(db)]
        });

        db.prematchPanelMessageId = msg.id;
        saveDb(db);

        return interaction.reply({ content: "✅ Før-kamp panel posted.", ephemeral: true });
      }

      if (interaction.commandName === "setuplive") {
        const channel = await client.channels.fetch(CHANNELS.LIVE);
        const msg = await channel.send({
          embeds: [livePanelEmbed(db)],
          components: liveButtons()
        });

        db.livePanelMessageId = msg.id;
        saveDb(db);

        return interaction.reply({ content: "✅ Live panel posted.", ephemeral: true });
      }

      if (interaction.commandName === "addpoints") {
        const user = interaction.options.getUser("user");
        const amount = interaction.options.getInteger("amount");
        const reason = interaction.options.getString("reason") || "Manual add";

        addPoints(user.id, amount);
        await updateScoreboard();
        await sendPointFeed(user.id, amount, reason);

        return interaction.reply({
          content: `✅ Gav ${amount} points til ${user}.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "removepoints") {
        const user = interaction.options.getUser("user");
        const amount = interaction.options.getInteger("amount");
        const reason = interaction.options.getString("reason") || "Manual remove";

        addPoints(user.id, -Math.abs(amount));
        await updateScoreboard();
        await sendPointFeed(user.id, -Math.abs(amount), reason);

        return interaction.reply({
          content: `✅ Fjernede ${amount} points fra ${user}.`,
          ephemeral: true
        });
      }
    }

    if (interaction.isButton()) {
      const db = loadDb();

      if (interaction.customId === "refresh_scoreboard") {
        await updateScoreboard();
        return interaction.reply({ content: "✅ Scoreboard refreshed.", ephemeral: true });
      }

      if (interaction.customId === "admin_add_points") {
        if (!isAdmin(interaction)) return adminOnlyReply(interaction);
        return interaction.showModal(pointsModal("modal_add_points"));
      }

      if (interaction.customId === "admin_remove_points") {
        if (!isAdmin(interaction)) return adminOnlyReply(interaction);
        return interaction.showModal(pointsModal("modal_remove_points"));
      }

      if (interaction.customId === "prematch_create") {
        if (!isAdmin(interaction)) return adminOnlyReply(interaction);
        return interaction.showModal(prematchCreateModal());
      }

      if (interaction.customId === "prematch_submit") {
        if (!db.prematch.active) {
          return interaction.reply({ content: "❌ Der er ingen aktiv prediction.", ephemeral: true });
        }

        if (Date.now() > db.prematch.closesAt) {
          return interaction.reply({ content: "🔒 Prediction er lukket.", ephemeral: true });
        }

        if (db.prematch.predictions[interaction.user.id]) {
          return interaction.reply({ content: "❌ Du har allerede givet prediction.", ephemeral: true });
        }

        return interaction.showModal(prematchSubmitModal());
      }

      if (interaction.customId === "prematch_live_score") {
        if (!isAdmin(interaction)) return adminOnlyReply(interaction);
        return interaction.showModal(liveScoreModal());
      }

if (interaction.customId === "prematch_end") {
  if (!isAdmin(interaction)) return adminOnlyReply(interaction);

  const p = db.prematch;
  if (!p.active || !p.liveScore) {
    return interaction.reply({
      content: "❌ Der er ingen aktiv kamp eller live score sat.",
      ephemeral: true
    });
  }

  let winners = 0;

  for (const [userId, pred] of Object.entries(p.predictions)) {
    if (pred.score.trim() === p.liveScore.trim()) {
      changePoints(db, userId, POINTS.EXACT_RESULT);
      winners++;
    }
  }

  db.prematch = defaultDb().prematch;
  saveDb(db);

  for (const [userId, pred] of Object.entries(p.predictions)) {
    if (pred.score.trim() === p.liveScore.trim()) {
      await sendPointFeed(userId, POINTS.EXACT_RESULT, `Korrekt resultat: ${p.home} vs ${p.away} (${p.liveScore})`);
    }
  }

  await updateScoreboard();
  await updatePrematchPanel();

  return interaction.reply({
    content: `🏁 Kamp afsluttet. ${winners} fik +${POINTS.EXACT_RESULT} points.`,
    ephemeral: true
  });
}

      if (interaction.customId === "goal_start") {
        if (!isAdmin(interaction)) return adminOnlyReply(interaction);

        db.goal = {
          active: true,
          closesAt: Date.now() + 2 * 60 * 1000,
          predictions: {},
          awarded: {}
        };

        saveDb(db);
        await updateLivePanel();

        const channel = await client.channels.fetch(CHANNELS.LIVE);
        await channel.send("@everyone 🔴 **Næste Scorer Prediction er åben i 2 minutter!**");

        return interaction.reply({ content: "✅ Næste scorer startet.", ephemeral: true });
      }

      if (interaction.customId === "goal_submit") {
        if (!db.goal.active) {
          return interaction.reply({ content: "❌ Næste scorer er ikke startet.", ephemeral: true });
        }

        if (Date.now() > db.goal.closesAt) {
          return interaction.reply({ content: "🔒 Runden er lukket.", ephemeral: true });
        }

        if (db.goal.predictions[interaction.user.id]) {
          return interaction.reply({ content: "❌ Du har allerede gættet.", ephemeral: true });
        }

        return interaction.showModal(goalSubmitModal());
      }

      if (interaction.customId === "goal_scored") {
        if (!isAdmin(interaction)) return adminOnlyReply(interaction);

        const entries = Object.entries(db.goal.predictions);

        if (!entries.length) {
          return interaction.reply({ content: "❌ Ingen predictions at give points til.", ephemeral: true });
        }

        const options = entries.slice(0, 25).map(([userId, p]) => ({
          label: `${p.player} / ${p.team}`.slice(0, 90),
          description: `User ID: ${userId}`,
          value: userId
        }));

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("goal_award_select")
            .setPlaceholder("Vælg person der skal vurderes")
            .addOptions(options)
        );

        return interaction.reply({
          content: "Vælg en prediction. Derefter får du buttons: Rigtigt hold / Rigtig spiller / Ingen.",
          components: [row],
          ephemeral: true
        });
      }

      if (interaction.customId === "goal_reset") {
        if (!isAdmin(interaction)) return adminOnlyReply(interaction);

        db.goal = defaultDb().goal;
        saveDb(db);
        await updateLivePanel();

        return interaction.reply({ content: "🔁 Næste scorer reset.", ephemeral: true });
      }

      if (interaction.customId === "yellow_start") {
        if (!isAdmin(interaction)) return adminOnlyReply(interaction);

        db.yellow = {
          active: true,
          closesAt: Date.now() + 2 * 60 * 1000,
          predictions: {},
          awarded: {}
        };

        saveDb(db);
        await updateLivePanel();

        const channel = await client.channels.fetch(CHANNELS.LIVE);
        await channel.send("@everyone 🟨 **Gult Kort Prediction er åben i 2 minutter!**");

        return interaction.reply({ content: "✅ Gult kort prediction startet.", ephemeral: true });
      }

      if (interaction.customId === "yellow_submit") {
        if (!db.yellow.active) {
          return interaction.reply({ content: "❌ Gult kort prediction er ikke startet.", ephemeral: true });
        }

        if (Date.now() > db.yellow.closesAt) {
          return interaction.reply({ content: "🔒 Prediction er lukket.", ephemeral: true });
        }

        if (db.yellow.predictions[interaction.user.id]) {
          return interaction.reply({ content: "❌ Du har allerede gættet.", ephemeral: true });
        }

        return interaction.showModal(yellowSubmitModal());
      }

if (interaction.customId === "yellow_award") {
  if (!isAdmin(interaction)) return adminOnlyReply(interaction);

  const entries = Object.entries(db.yellow.predictions)
    .filter(([userId]) => {
      const awarded = db.yellow.awarded[userId] || {};
      return !awarded.player1 || !awarded.player2;
    });

  if (!entries.length) {
    return interaction.reply({
      content: "✅ Alle yellow-card predictions er færdig-vurderet.",
      ephemeral: true
    });
  }

  const options = entries.slice(0, 25).map(([userId, p]) => {
    const awarded = db.yellow.awarded[userId] || {};

    const p1 = awarded.player1 ? `✅ ${p.player1}` : `⏳ ${p.player1}`;
    const p2 = awarded.player2 ? `✅ ${p.player2}` : `⏳ ${p.player2}`;

    return {
      label: `${p1} / ${p2}`.slice(0, 100),
      description: `User ID: ${userId}`,
      value: userId
    };
  });

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("yellow_award_select")
      .setPlaceholder("Vælg hvem der skal vurderes")
      .addOptions(options)
  );

  return interaction.reply({
    content: "Vælg en person. Bagefter kan du give points til spiller 1 eller spiller 2 hver for sig.",
    components: [row],
    ephemeral: true
  });
}

      if (interaction.customId === "yellow_end") {
        if (!isAdmin(interaction)) return adminOnlyReply(interaction);

        db.yellow.active = false;
        saveDb(db);
        await updateLivePanel();

        return interaction.reply({ content: "🏁 Yellow-card loop afsluttet.", ephemeral: true });
      }

      if (interaction.customId.startsWith("goal_award_")) {
        if (!isAdmin(interaction)) return adminOnlyReply(interaction);

        const [, , type, userId] = interaction.customId.split("_");

        let amount = 0;
        let reason = "";

        if (type === "team") {
          amount = POINTS.NEXT_TEAM;
          reason = "Rigtigt hold på næste mål";
        }

        if (type === "player") {
          amount = POINTS.NEXT_SCORER;
          reason = "Rigtig målscorer";
        }

        if (type === "none") {
          db.goal.awarded[userId] = true;
          saveDb(db);
          await updateLivePanel();

          return interaction.update({
            content: `❌ <@${userId}> fik ingen points.`,
            components: []
          });
        }

changePoints(db, userId, amount);
db.goal.awarded[userId] = true;
saveDb(db);

        await sendPointFeed(userId, amount, reason);
        await updateScoreboard();
        await updateLivePanel();

        return interaction.update({
          content: `✅ <@${userId}> fik +${amount} points. Klik evt. igen via menuen hvis samme person også skal have anden type points.`,
          components: []
        });
      }

if (interaction.customId.startsWith("yellow_award_")) {
  if (!isAdmin(interaction)) return adminOnlyReply(interaction);

  const parts = interaction.customId.split("_");
  const type = parts[2];
  const userId = parts[3];

  if (!db.yellow.awarded[userId]) {
    db.yellow.awarded[userId] = {};
  }

  const prediction = db.yellow.predictions[userId];

  if (!prediction) {
    return interaction.update({
      content: "❌ Den prediction findes ikke længere.",
      components: []
    });
  }

  if (type === "player1" || type === "player2") {
    if (db.yellow.awarded[userId][type]) {
      return interaction.update({
        content: `❌ <@${userId}> har allerede fået points for ${type}.`,
        components: []
      });
    }

    db.yellow.awarded[userId][type] = true;
    changePoints(db, userId, POINTS.YELLOW_CARD);
    saveDb(db);

    const playerName = type === "player1" ? prediction.player1 : prediction.player2;

    await sendPointFeed(
      userId,
      POINTS.YELLOW_CARD,
      `Rigtig gult kort prediction: ${playerName}`
    );

    await updateScoreboard();
    await updateLivePanel();

    const awarded = db.yellow.awarded[userId];

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`yellow_award_player1_${userId}`)
        .setLabel(awarded.player1 ? "✅ SPILLER 1 GIVET" : `SPILLER 1: ${prediction.player1}`.slice(0, 80))
        .setStyle(awarded.player1 ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setDisabled(!!awarded.player1),

      new ButtonBuilder()
        .setCustomId(`yellow_award_player2_${userId}`)
        .setLabel(awarded.player2 ? "✅ SPILLER 2 GIVET" : `SPILLER 2: ${prediction.player2}`.slice(0, 80))
        .setStyle(awarded.player2 ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setDisabled(!!awarded.player2),

      new ButtonBuilder()
        .setCustomId(`yellow_award_none_${userId}`)
        .setLabel("INGEN / LUK")
        .setStyle(ButtonStyle.Danger)
    );

    const p1Text = awarded.player1 ? `~~${prediction.player1}~~ ✅` : `${prediction.player1} ⏳`;
    const p2Text = awarded.player2 ? `~~${prediction.player2}~~ ✅` : `${prediction.player2} ⏳`;

    return interaction.update({
      content: `✅ <@${userId}> fik +${POINTS.YELLOW_CARD} for **${playerName}**.\n\nSpiller 1: **${p1Text}**\nSpiller 2: **${p2Text}**`,
      components: [row]
    });
  }

  if (type === "none") {
    saveDb(db);
    await updateLivePanel();

    return interaction.update({
      content: `Lukket uden at give flere yellow-card points til <@${userId}>.`,
      components: []
    });
  }
}
    }

    if (interaction.isStringSelectMenu()) {
      const db = loadDb();

      if (!isAdmin(interaction)) return adminOnlyReply(interaction);

      if (interaction.customId === "goal_award_select") {
        const userId = interaction.values[0];
        const p = db.goal.predictions[userId];

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`goal_award_team_${userId}`)
            .setLabel("RIGTIGT HOLD")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`goal_award_player_${userId}`)
            .setLabel("RIGTIG SPILLER")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`goal_award_none_${userId}`)
            .setLabel("INGEN")
            .setStyle(ButtonStyle.Danger)
        );

        return interaction.update({
          content: `Valgt: <@${userId}> → **${p.team} / ${p.player}**`,
          components: [row]
        });
      }

if (interaction.customId === "yellow_award_select") {
  const userId = interaction.values[0];
  const p = db.yellow.predictions[userId];
  const awarded = db.yellow.awarded[userId] || {};

  const row = new ActionRowBuilder();

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`yellow_award_player1_${userId}`)
      .setLabel(awarded.player1 ? "✅ SPILLER 1 GIVET" : `SPILLER 1: ${p.player1}`.slice(0, 80))
      .setStyle(awarded.player1 ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(!!awarded.player1),

    new ButtonBuilder()
      .setCustomId(`yellow_award_player2_${userId}`)
      .setLabel(awarded.player2 ? "✅ SPILLER 2 GIVET" : `SPILLER 2: ${p.player2}`.slice(0, 80))
      .setStyle(awarded.player2 ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(!!awarded.player2),

    new ButtonBuilder()
      .setCustomId(`yellow_award_none_${userId}`)
      .setLabel("INGEN / LUK")
      .setStyle(ButtonStyle.Danger)
  );

  const player1Text = awarded.player1 ? `~~${p.player1}~~ ✅` : `${p.player1} ⏳`;
  const player2Text = awarded.player2 ? `~~${p.player2}~~ ✅` : `${p.player2} ⏳`;

  return interaction.update({
    content: `Valgt: <@${userId}>\nSpiller 1: **${player1Text}**\nSpiller 2: **${player2Text}**`,
    components: [row]
  });
}
    }

    if (interaction.isModalSubmit()) {
      const db = loadDb();

      if (interaction.customId === "modal_add_points" || interaction.customId === "modal_remove_points") {
        if (!isAdmin(interaction)) return adminOnlyReply(interaction);

        const userId = interaction.fields.getTextInputValue("userId").trim();
        const amountRaw = Number(interaction.fields.getTextInputValue("amount").trim());
        const reason = interaction.fields.getTextInputValue("reason") || "Manual button change";

        if (!userId || Number.isNaN(amountRaw)) {
          return interaction.reply({ content: "❌ Ugyldigt user ID eller amount.", ephemeral: true });
        }

        const amount =
          interaction.customId === "modal_add_points"
            ? Math.abs(amountRaw)
            : -Math.abs(amountRaw);

        addPoints(userId, amount);
        await sendPointFeed(userId, amount, reason);
        await updateScoreboard();

        return interaction.reply({
          content: `✅ Points ændret for <@${userId}> med ${amount}.`,
          ephemeral: true
        });
      }

      if (interaction.customId === "modal_prematch_create") {
        if (!isAdmin(interaction)) return adminOnlyReply(interaction);

        const home = interaction.fields.getTextInputValue("home").trim();
        const away = interaction.fields.getTextInputValue("away").trim();
        const minutes = Number(interaction.fields.getTextInputValue("minutes").trim());

        if (!home || !away || Number.isNaN(minutes)) {
          return interaction.reply({ content: "❌ Ugyldige værdier.", ephemeral: true });
        }

        db.prematch = {
          active: true,
          home,
          away,
          liveScore: null,
          closesAt: Date.now() + minutes * 60 * 1000,
          predictions: {}
        };

        saveDb(db);
        await updatePrematchPanel();

        const channel = await client.channels.fetch(CHANNELS.PREMATCH);
        await channel.send(`@everyone 📋 **Ny før-kamp prediction:** ${home} vs ${away} — svar inden **${minutes} min**!`);

        return interaction.reply({
          content: `✅ Prediction oprettet: ${home} vs ${away}.`,
          ephemeral: true
        });
      }

      if (interaction.customId === "modal_prematch_submit") {
        const score = interaction.fields.getTextInputValue("score").trim();

        if (!parseScore(score)) {
          return interaction.reply({ content: "❌ Brug format fx `2-1`.", ephemeral: true });
        }

        db.prematch.predictions[interaction.user.id] = {
          score,
          createdAt: Date.now()
        };

        saveDb(db);
        await updatePrematchPanel();

        return interaction.reply({
          content: `✅ Din prediction er låst: **${score}**`,
          ephemeral: true
        });
      }

      if (interaction.customId === "modal_prematch_live_score") {
        if (!isAdmin(interaction)) return adminOnlyReply(interaction);

        const score = interaction.fields.getTextInputValue("score").trim();

        if (!parseScore(score)) {
          return interaction.reply({ content: "❌ Brug format fx `2-0`.", ephemeral: true });
        }

        db.prematch.liveScore = score;
        saveDb(db);
        await updatePrematchPanel();

        return interaction.reply({
          content: `✅ Live score sat til **${score}**.`,
          ephemeral: true
        });
      }

      if (interaction.customId === "modal_goal_submit") {
        const team = interaction.fields.getTextInputValue("team").trim();
        const player = interaction.fields.getTextInputValue("player").trim();

        db.goal.predictions[interaction.user.id] = {
          team,
          player,
          createdAt: Date.now()
        };

        saveDb(db);
        await updateLivePanel();

        return interaction.reply({
          content: `✅ Din næste scorer prediction er låst: **${team} / ${player}**`,
          ephemeral: true
        });
      }

      if (interaction.customId === "modal_yellow_submit") {
        const player1 = interaction.fields.getTextInputValue("player1").trim();
        const player2 = interaction.fields.getTextInputValue("player2").trim();

        db.yellow.predictions[interaction.user.id] = {
          player1,
          player2,
          createdAt: Date.now()
        };

        saveDb(db);
        await updateLivePanel();

        return interaction.reply({
          content: `✅ Dine yellow-card guesses er låst: **${player1} / ${player2}**`,
          ephemeral: true
        });
      }
    }
  } catch (err) {
    console.error(err);

    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply({
        content: "❌ Der skete en fejl. Tjek console.",
        ephemeral: true
      });
    }
  }
});

/* =========================
   READY
========================= */

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await deployCommands();
});

client.login(process.env.DISCORD_TOKEN);