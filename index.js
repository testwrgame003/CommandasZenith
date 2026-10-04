//510 y 811 cambiotiempo
//240,1118
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js')
const { Redis } = require("@upstash/redis")




const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ] 
})

const TOKEN = process.env.TOKEN

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
  
})



//detecta onlineppm
const GROUP_CONFIG = {
  Trainer: {
    label: "Trainer"
  },
  Gym_Leader: {
    label: "Gym Leader"
  },
  Elite_Four: {
    label: "Elite Four"
  }
}

function onlineKey(group) {
  return `online:${group}`
}

function usersKey(group) {
  return `users:${group}`
}

function vipKey(group) {
  return `vip:${group}`
}

function schedulesKey() {
  return "daily_schedules"
}

function activeRolesKey() {
  return "active_roles"
}

function historyKey() {
  return "ppm_history"
}

function safeJsonParse(value, fallback = {}) {
  let v = value

  for (let i = 0; i < 3; i++) {
    if (v === null || v === undefined || v === "") return fallback
    if (typeof v === "object") return v
    if (typeof v !== "string") return fallback

    const s = v
      .trim()
      .replace(/^\uFEFF/, "")
      .replace(/[“”]/g, '"')
      .replace(/,\s*$/, "")

    try {
      v = JSON.parse(s)
    } catch {
      console.error("❌ JSON ilegible en Redis:", s.slice(0, 200))
      return fallback
    }
  }

  return typeof v === "object" ? v : fallback
}

function uniqueList(arr) {
  return [...new Set(
    arr
      .map(x => String(x || "").trim())
      .filter(Boolean)
  )]
}

function buildUserData(oldData, interaction, updates = {}) {

  const discordName =
    interaction.member?.displayName ||
    interaction.user?.username ||
    "Unknown"

  const oldAliases = Array.isArray(oldData.aliases)
    ? oldData.aliases
    : []

  const finalMainId =
    updates.main_id !== undefined
      ? updates.main_id
      : oldData.main_id || null

  const finalSecId =
    updates.sec_id !== undefined
      ? updates.sec_id
      : oldData.sec_id || null

  const name =
    updates.name ||
    oldData.name ||
    discordName

  const heartbeatName =
    updates.heartbeatName ||
    oldData.heartbeatName ||
    name

  const aliases = uniqueList([
    ...oldAliases,
    oldData.name,
    oldData.heartbeatName,
    discordName,
    name,
    heartbeatName
  ])

  return {
    ...oldData,

    name,
    heartbeatName,
    aliases,

    main_id: finalMainId,
    sec_id: finalSecId,

    ...updates
  }
}


function normalizeRedisIds(ids) {
  if (!Array.isArray(ids)) return []

  return ids
    .map(id => String(id).replace(/\D/g, ""))
    .filter(id => /^\d{16}$/.test(id))
}
function normalizeGroupRoleName(roleName) {
  const map = {
    "Trainer": "Trainer",
    "Gym_Leader": "Gym_Leader",
    "Gym Leader": "Gym_Leader",
    "Elite_Four": "Elite_Four",
    "Elite Four": "Elite_Four"
  }

  return map[roleName] || null
}
function getGroupLabel(group) {
  const labels = {
    Trainer: "Trainer",
    Gym_Leader: "Gym Leader",
    Elite_Four: "Elite Four"
  };
  return labels[group] || group;
}

const CHANNEL_GROUP_MAP = {
  "1486277594629275770": "Elite_Four",  // canal elite
  "1487362022864588902": "Trainer",     // canal trainer
  "1484015417411244082": "Gym_Leader"   // canal gym
}

function getMemberGroups(member) {
  return member.roles.cache
    .map(role => normalizeGroupRoleName(role.name))
    .filter(Boolean)
    .filter((group, index, arr) => arr.indexOf(group) === index)
}

function normalizeSelectableRoleName(roleName) {
  const normalGroup = normalizeGroupRoleName(roleName)

  if (normalGroup) return normalGroup

  if (roleName === "Rival_Duo" || roleName === "Rival Duo") {
    return "Rival_Duo"
  }

  return null
}

function getMemberSelectableRoles(member) {
  return member.roles.cache
    .map(role => normalizeSelectableRoleName(role.name))
    .filter(Boolean)
    .filter((group, index, arr) => arr.indexOf(group) === index)
}

function getSelectableRoleLabel(group) {
  if (group === "Rival_Duo") return "Rival Duo"
  return getGroupLabel(group)
}
function isValidId(id) {
  return /^\d{16}$/.test(String(id).trim())
}

async function isGameIdAlreadyUsed(id, group, ignoreDiscordId = null) {
  id = String(id).trim()

  const users = await getUsers(group)

  for (const uid in users) {
    if (ignoreDiscordId && uid === String(ignoreDiscordId)) {
      continue
    }

    const u = users[uid]

    if (
      String(u.main_id || "").trim() === id ||
      String(u.sec_id || "").trim() === id
    ) {
      return true
    }
  }

  return false
}




async function getActiveRoles(userId) {
  try {
    const role = await redis.hget(activeRolesKey(), String(userId))

    if (!role) return null

    return role
  } catch (error) {
    console.error("Error loading active role:", error)
    return null
  }
}

async function saveActiveRoles(data) {
  try {
    await redis.set(activeRolesKey(), JSON.stringify(data || {}))
  } catch (err) {
    console.error("Error saving active roles:", err)
  }
}




async function getUserGroup(interaction) {

  const memberGroups = getMemberSelectableRoles(interaction.member)

  if (!memberGroups.length) {
    return null
  }

  // intentar formato NUEVO
  let savedRole = await redis.get(`active_roles:${interaction.user.id}`)

  // fallback formato VIEJO HASH
  if (!savedRole) {
    try {
      const oldRoles = await redis.hgetall(activeRolesKey())

      if (oldRoles && typeof oldRoles === "object") {
        savedRole = oldRoles[interaction.user.id]
      }
    } catch (err) {
      console.error("Error loading old active roles:", err)
    }
  }

  // usar rol guardado si aún lo tiene
  if (
    savedRole &&
    memberGroups.includes(savedRole)
  ) {
    return savedRole
  }

  // fallback automático por prioridad
  const priority = [
    "Rival_Duo",
    "Elite_Four",
    "Gym_Leader",
    "Trainer"
  ]

  for (const role of priority) {
    if (memberGroups.includes(role)) {
      return role
    }
  }

  return null
}

async function isActiveRivalDuo(interaction) {
  const hasRivalDuoRole = interaction.member.roles.cache.some(role =>
    role.name === "Rival_Duo" || role.name === "Rival Duo"
  )

  if (!hasRivalDuoRole) return false

  return (await getUserGroup(interaction)) === "Rival_Duo"
}

async function getOnlineIDs(group) {
  if (!GROUP_CONFIG[group]) return []

  try {
    const ids = await redis.smembers(onlineKey(group))
    return normalizeRedisIds(ids)
  } catch (err) {
    console.error(`getOnlineIDs Redis error for ${group}:`, err)
    return []
  }
}



//
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function buildUserLabel(user, id) {
 if (!user) return `Unknown (${id})`;
  if (user.main_id === id) return `${user.name} (Main)`;
  if (user.sec_id === id) return `${user.name} (Sec)`;
  return `${user.name}`;
}

async function getOnlineUsersByGroup(group) {
  if (!GROUP_CONFIG[group]) return []

  const onlineIds = await getOnlineIDs(group)

  if (!onlineIds.length) return []

  const users = await getUsers(group)
  const results = []

  // Obtener Rival Duos activos
  const duos = await loadAllRivalDuos()

  const activeDuoIds = new Map()

  for (const duo of Object.values(duos)) {
    if (!duo) continue

    if (
      duo.status === "online" &&
      duo.activeGroup === group &&
      duo.activeGameId
    ) {
      activeDuoIds.set(
        String(duo.activeGameId),
        duo
      )
    }
  }

  // Usuarios normales
  for (const id of onlineIds) {

    // Si este ID pertenece a un Rival Duo,
    // lo agregamos abajo como Duo.
    if (activeDuoIds.has(String(id))) {
      continue
    }

    let foundUser = null

    for (const uid in users) {
      const u = users[uid]

      if (
        u.main_id === id ||
        u.sec_id === id
      ) {
        foundUser = u
        break
      }
    }

    results.push({
      id,
      label: buildUserLabel(foundUser, id),
      user: foundUser,
      duoId: null
    })
  }

  // Rival Duos
  for (const [id, duo] of activeDuoIds.entries()) {

    const activeMember = getRivalDuoMember(
      duo,
      duo.activeDiscordId
    )

    results.push({
      id,
      label:
        `🤝 Rival Duo: ${displayRivalDuoName(duo)}`,
      user: null,
      duoId: duo.id,
      duo: true,
      activeMember
    })
  }

  return results
}


// ================= DAILY SCHEDULE SYSTEM =================

async function loadSchedules() {
  try {
    const data = await redis.get(schedulesKey())
    return safeJsonParse(data, {})
  } catch (err) {
    console.error("Error loading schedules from Redis:", err)
    return {}
  }
}

async function saveSchedules(data) {
  try {
    await redis.set(schedulesKey(), JSON.stringify(data || {}))
  } catch (err) {
    console.error("Error saving schedules to Redis:", err)
  }
}

function startDailyScheduler() {
  setInterval(async () => {
    try {
      const schedules = await loadSchedules()
      const now = new Date()

      const utcHour = now.getUTCHours()
      const utcMinute = now.getUTCMinutes()
      const todayUTC = now.toISOString().slice(0, 10)

      let changed = false

      for (const userId in schedules) {
        const data = schedules[userId]
        if (!data.group || !data.main_id) continue

        // ONLINE
        if (
          data.online_hour === utcHour &&
          data.online_minute === utcMinute &&
          data.last_online !== todayUTC
        ) {
          const ok = await setOnlineStatus("online", data.main_id, data.group)

          if (ok) {
            data.last_online = todayUTC
            changed = true
            console.log("🟢 Daily ONLINE ejecutado:", data.main_id)
          }
        }

        // OFFLINE
        if (
          data.offline_hour === utcHour &&
          data.offline_minute === utcMinute &&
          data.last_offline !== todayUTC
        ) {
          const ok = await setOnlineStatus("offline", data.main_id, data.group)

          if (ok) {
            data.last_offline = todayUTC
            changed = true
            console.log("🔴 Daily OFFLINE ejecutado:", data.main_id)
          }
        }
      }

      // solo guarda si algo cambió
      if (changed) await saveSchedules(schedules)

    } catch (err) {
      console.error("Scheduler error:", err)
    }
  }, 60 * 1000)
}


async function loadHistory() {
  try {
    const data = await redis.get(historyKey())
    return safeJsonParse(data, [])
  } catch (err) {
    console.error("Error loading history from Redis:", err)
    return []
  }
}

async function saveHistory(data) {
  try {
    await redis.set(historyKey(), JSON.stringify(data || []))
  } catch (err) {
    console.error("Error saving history to Redis:", err)
  }
}
//let onlineUsers = {}
async function setOnlineStatus(action, id, group) {
  try {
    id = String(id || "").trim()

    if (!["online", "offline"].includes(action)) {
      console.error("Invalid action:", action)
      return false
    }

    if (!isValidId(id)) {
      console.error("Invalid ID:", id)
      return false
    }

    if (!GROUP_CONFIG[group]) {
      console.error("Invalid group:", group)
      return false
    }

    if (action === "online") {
      await redis.sadd(onlineKey(group), id)
    }

    if (action === "offline") {
      await redis.srem(onlineKey(group), id)
    }

    return true
  } catch (err) {
    console.error(`setOnlineStatus ${action} error:`, err)
    return false
  }
}


function normalizeUser(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null

  const cleanId = v => {
    const s = String(v ?? "").replace(/\s+/g, "").trim()
    return s || null
  }

  const name = String(raw.name ?? "").trim() || "Unknown"

  return {
    ...raw,
    name,
    heartbeatName: String(raw.heartbeatName ?? "").trim() || name,
    aliases: Array.isArray(raw.aliases)
      ? uniqueList(raw.aliases)
      : uniqueList([name]),
    main_id: cleanId(raw.main_id ?? raw.mainId),
    sec_id: cleanId(raw.sec_id ?? raw.secId)
  }
}

async function getUsers(group) {
  try {
    if (!GROUP_CONFIG[group]) {
      console.error("getUsers invalid group:", group)
      return {}
    }

    const data = await redis.hgetall(usersKey(group))
    if (!data || typeof data !== "object") return {}

    const users = {}

    for (const uid in data) {
      const user = normalizeUser(safeJsonParse(data[uid], null))

      if (!user) {
        // se omite y NO se reescribe, así el registro original queda intacto en Redis
        console.error(`⚠️ Registro inválido: ${usersKey(group)} -> ${uid}`, data[uid])
        continue
      }

      users[String(uid).trim()] = user
    }

    return users
  } catch (err) {
    console.error(`Error loading users from Redis for ${group}:`, err)
    return {}
  }
}

async function findUserFlexible(discordId, preferredGroup = null) {
  const all = Object.keys(GROUP_CONFIG)

  const groups = (preferredGroup && GROUP_CONFIG[preferredGroup])
    ? [preferredGroup, ...all.filter(g => g !== preferredGroup)]
    : all

  for (const group of groups) {
    const users = await getUsers(group)
    const userData = users[String(discordId)]

    if (userData) return { group, userData, users }
  }

  return null
}
async function findUserEverywhere(discordId) {

  for (const group of Object.keys(GROUP_CONFIG)) {

    const users = await getUsers(group)

    if (users[discordId]) {
      return {
        group,
        user: users[discordId]
      }
    }
  }

  return null
}


async function saveUsers(users, group) {
  try {
    if (!GROUP_CONFIG[group]) {
      console.error("saveUsers invalid group:", group)
      return false
    }

    const key = usersKey(group)


    const payload = {}

    for (const uid in users) {
      payload[uid] = JSON.stringify(users[uid])
    }

    if (Object.keys(payload).length > 0) {
      await redis.hset(key, payload)
    }

    return true
  } catch (err) {
    console.error(`Error saving users to Redis for ${group}:`, err)
    return false
  }
}

//advio
async function addVipID(id, group) {
  try {
    id = String(id || "").trim()

    if (!isValidId(id)) {
      console.error("Invalid VIP ID:", id)
      return false
    }

    if (!GROUP_CONFIG[group]) {
      console.error("Invalid VIP group:", group)
      return false
    }

    await redis.sadd(vipKey(group), id)

    console.log(`✅ VIP added to Redis ${group}:`, id)
    return true
  } catch (err) {
    console.error("Error saving VIP to Redis:", err)
    return false
  }
}

// ================= RIVAL DUO SYSTEM =================

const RIVAL_DUOS_KEY = "rival_duos"
const RIVAL_DUO_BY_USER_KEY = "rival_duo_by_user"
const RIVAL_DUO_BY_GAMEID_KEY = "rival_duo_by_gameid"
const RIVAL_DUO_ROTATION_MS = 60 * 60 * 1000
//const RIVAL_DUO_ROTATION_MS = 2 * 60 * 1000

function rivalDuoPendingKey(discordId) {
  return `rival_duo_pending:${discordId}`
}

function createRivalDuoId() {
  return `duo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function rivalNow() {
  return Date.now()
}

function isValidGameId(id) {
  return /^\d{16}$/.test(String(id || "").trim())
}

function parseRivalJson(value, fallback = {}) {
  return safeJsonParse(value, fallback)
}

function getRivalDuoMembers(duo) {
  return Object.entries(duo?.members || {}).map(([discordId, member]) => ({
    discordId,
    ...member
  }))
}

function getRivalDuoMember(duo, discordId) {
  return duo?.members?.[String(discordId)] || null
}

function isRivalDuoFull(duo) {
  return getRivalDuoMembers(duo).length >= 2
}

function displayRivalDuoName(duo) {
  const members = getRivalDuoMembers(duo)

  if (!members.length) return "Empty Duo"

  return members
    .map(m => m.name || m.heartbeatName || "Unknown")
    .join(" & ")
}

async function loadAllRivalDuos() {
  try {
    const data = await redis.hgetall(RIVAL_DUOS_KEY)

    if (!data || typeof data !== "object") return {}

    const out = {}

    for (const duoId in data) {
      out[duoId] = parseRivalJson(data[duoId], null)
    }

    return out
  } catch (err) {
    console.error("Error loading rival duos:", err)
    return {}
  }
}

async function saveRivalDuo(duo) {
  try {
    if (!duo?.id) return false

await redis.hset(RIVAL_DUOS_KEY, {
  [duo.id]: JSON.stringify(duo)
})

    return true
  } catch (err) {
    console.error("Error saving rival duo:", err)
    return false
  }
}

async function getRivalDuoById(duoId) {
  try {
    const raw = await redis.hget(RIVAL_DUOS_KEY, String(duoId))
    return parseRivalJson(raw, null)
  } catch (err) {
    console.error("Error loading rival duo by id:", err)
    return null
  }
}

async function getRivalDuoByUser(discordId) {
  discordId = String(discordId)

  try {
    const raw = await redis.hget(RIVAL_DUO_BY_USER_KEY, discordId)
    const ref = parseRivalJson(raw, null)

    if (ref?.duoId) {
      const duo = await getRivalDuoById(ref.duoId)
      if (duo?.members?.[discordId]) return duo
    }
  } catch (err) {
    console.error("Error loading rival duo by user index:", err)
  }

  // fallback: escanear todos
  const duos = await loadAllRivalDuos()

  for (const duo of Object.values(duos)) {
    if (duo?.members?.[discordId]) return duo
  }

  return null
}

async function getAllRivalDuosByUser(discordId) {
  const duos = await loadAllRivalDuos()
  const found = []

  for (const duo of Object.values(duos)) {
    if (!duo) continue

    if (duo.members && duo.members[String(discordId)]) {
      found.push(duo)
    }
  }

  return found
}
async function saveRivalDuoIndexes(duo) {
  try {
    for (const member of getRivalDuoMembers(duo)) {
      await redis.hset(RIVAL_DUO_BY_USER_KEY, {
        [member.discordId]: JSON.stringify({
          duoId: duo.id,
          discordId: member.discordId
        })
      })

      await redis.hset(RIVAL_DUO_BY_GAMEID_KEY, {
        [member.gameId]: JSON.stringify({
          duoId: duo.id,
          discordId: member.discordId
        })
      })
    }

    return true
  } catch (err) {
    console.error("Error saving rival duo indexes:", err)
    return false
  }
}

async function findOpenRivalDuos() {
  const duos = await loadAllRivalDuos()

  return Object.values(duos)
    .filter(Boolean)
    .filter(duo => !isRivalDuoFull(duo))
}

async function savePendingRivalDuoRegistration(discordId, data) {
  await redis.set(rivalDuoPendingKey(discordId), JSON.stringify(data), {
    ex: 10 * 60
  })
}

async function loadPendingRivalDuoRegistration(discordId) {
  const raw = await redis.get(rivalDuoPendingKey(discordId))
  return parseRivalJson(raw, null)
}

async function clearPendingRivalDuoRegistration(discordId) {
  await redis.del(rivalDuoPendingKey(discordId))
}

async function registerRivalDuoMember({
  discordId,
  name,
  heartbeatName,
  gameId,
  duoId = null
}) {
  discordId = String(discordId)
  gameId = String(gameId || "").trim()
  duoId = duoId ? String(duoId) : null



  if (!isValidGameId(gameId)) {
    return {
      ok: false,
      message: "❌ ID must be exactly 16 digits."
    }
  }

  
  let duo = null

  if (duoId) {
    duo = await getRivalDuoById(duoId)

    if (!duo) {
      return {
        ok: false,
        message: "❌ This Rival Duo no longer exists."
      }
    }

    if (!duo.members || typeof duo.members !== "object") {
      duo.members = {}
    }

    if (duo.members[discordId]) {
      return {
        ok: false,
        message: "❌ You are already registered in this Rival Duo."
      }
    }

    if (isRivalDuoFull(duo)) {
      return {
        ok: false,
        message: "❌ This Rival Duo is already full."
      }
    }
  } else {
duo = {
  id: createRivalDuoId(),
  createdAt: rivalNow(),
  members: {},
  onlineUsers: {},

  // ===== GROUP SELECTION =====
  groupSelections: {},
  activeGroup: null,

  // ===== ACTIVE REROLL =====
  activeGameId: null,
  activeDiscordId: null,
  activeIndex: 0,
  lastRotationAt: 0,

  lastHeartbeatAt: {},
  lastHeartbeatStats: {},

  status: "waiting",
  offlineReason: null,
  offlineAt: null
}
  }

  duo.members[discordId] = {
    discordId,
    name: name || "Unknown",
    heartbeatName: heartbeatName || name || "Unknown",
    gameId,
    aliases: [
      name,
      heartbeatName
    ].filter(Boolean),
    joinedAt: rivalNow()
  }

  const saved = await saveRivalDuo(duo)

  if (!saved) {
    return {
      ok: false,
      message: "❌ Could not save Rival Duo in Redis."
    }
  }

  const reloaded = await getRivalDuoById(duo.id)

  if (!reloaded?.members?.[discordId]) {
    return {
      ok: false,
      message: "❌ Rival Duo was not saved correctly. Try again."
    }
  }

  const indexed = await saveRivalDuoIndexes(reloaded)

  if (!indexed) {
    return {
      ok: false,
      message: "❌ Rival Duo was saved, but indexes could not be updated."
    }
  }

  if (isRivalDuoFull(reloaded)) {
    return {
      ok: true,
      message: `✅ Rival Duo completed: **${displayRivalDuoName(reloaded)}**.`
    }
  }

  return {
    ok: true,
    message: "✅ Rival Duo created. Waiting for your reroll partner."
  }
}

async function removeRivalDuoIdsFromElite(duo) {
  const ids = getRivalDuoMembers(duo)
    .map(m => String(m.gameId || "").trim())
    .filter(isValidGameId)

  if (!ids.length) return

  await redis.srem("online:Elite_Four", ...ids)
}

function ensureRivalDuoGroupState(duo) {
  if (!duo.groupSelections || typeof duo.groupSelections !== "object") {
    duo.groupSelections = {}
  }

  if (!duo.activeGroup) {
    duo.activeGroup = null
  }

  return duo
}


async function removeRivalDuoIdsFromGroups(duo) {
  const ids = getRivalDuoMembers(duo)
    .map(m => String(m.gameId || "").trim())
    .filter(isValidGameId)

  if (!ids.length) return

  await redis.srem("online:Elite_Four", ...ids)
  await redis.srem("online:Gym_Leader", ...ids)
}


async function getRivalDuoSelectedGroup(duo) {
  ensureRivalDuoGroupState(duo)

  const members = getRivalDuoMembers(duo)

  if (members.length < 2) {
    return {
      ok: false,
      reason: "waiting_partner"
    }
  }

  const firstGroup = duo.groupSelections[members[0].discordId]
  const secondGroup = duo.groupSelections[members[1].discordId]

  if (!firstGroup || !secondGroup) {
    return {
      ok: false,
      reason: "waiting_selection"
    }
  }

  if (firstGroup !== secondGroup) {
    return {
      ok: false,
      reason: "selection_mismatch",
      firstGroup,
      secondGroup
    }
  }

  return {
    ok: true,
    group: firstGroup
  }
}


async function getOnlineUserCountExcludingDuo(group, duoId = null) {
  const onlineUsers = await getOnlineUsersByGroup(group)

  return onlineUsers.filter(user => {
    if (!duoId) return true
    return user.duoId !== duoId
  }).length
}


function buildRivalDuoGroupMenu(duo, discordId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`rival_duo_group_select_${duo.id}_${discordId}`)
    .setPlaceholder("Select the group for your Rival Duo")
    .addOptions([
      {
        label: "Elite Four",
        description: "Join the Elite Four group",
        value: "Elite_Four"
      },
      {
        label: "Gym Leader",
        description: "Join the Gym Leader group",
        value: "Gym_Leader"
      }
    ])

  return new ActionRowBuilder().addComponents(menu)
}

async function activateRivalDuoId(duo, force = false) {
  ensureRivalDuoGroupState(duo)

  const members = getRivalDuoMembers(duo)

  if (members.length < 2) {
    await removeRivalDuoIdsFromGroups(duo)

    duo.activeGameId = null
    duo.activeDiscordId = null
    duo.activeGroup = null
    duo.status = "waiting_partner"

    await saveRivalDuo(duo)

    return {
      ok: false,
      waiting: true,
      message: "⏳ Waiting for reroll partner."
    }
  }

  if (!duo.onlineUsers || typeof duo.onlineUsers !== "object") {
    duo.onlineUsers = {}
  }

  const allOnline = members.every(
    member => duo.onlineUsers[member.discordId] === true
  )

  if (!allOnline) {
    await removeRivalDuoIdsFromGroups(duo)

    duo.activeGameId = null
    duo.activeDiscordId = null
    duo.activeGroup = null
    duo.status = "offline"

    await saveRivalDuo(duo)

    return {
      ok: false,
      waiting: false,
      message: "🔴 Rival Duo offline."
    }
  }

  // =====================================================
  // BOTH MEMBERS MUST SELECT THE SAME GROUP
  // =====================================================

  const selection = await getRivalDuoSelectedGroup(duo)

  if (!selection.ok) {

    if (selection.reason === "waiting_selection") {
      duo.activeGameId = null
      duo.activeDiscordId = null
      duo.activeGroup = null
      duo.status = "waiting_selection"

      await removeRivalDuoIdsFromGroups(duo)
      await saveRivalDuo(duo)

      return {
        ok: false,
        waiting: true,
        message:
          "⏳ Both members must select the same group.\n" +
          "Please use `/online` and select **Elite Four** or **Gym Leader**."
      }
    }

    if (selection.reason === "selection_mismatch") {
      duo.activeGameId = null
      duo.activeDiscordId = null
      duo.activeGroup = null
      duo.status = "selection_mismatch"

      await removeRivalDuoIdsFromGroups(duo)
      await saveRivalDuo(duo)

      return {
        ok: false,
        waiting: true,
        message:
          "⚠️ Your Rival Duo members selected different groups.\n" +
          "Both members must select the **same group**."
      }
    }
  }

  const selectedGroup = selection.group

  // =====================================================
  // CHECK GROUP CAPACITY
  // =====================================================

  const onlineCount = await getOnlineUserCountExcludingDuo(
    selectedGroup,
    duo.id
  )

  if (onlineCount >= 25) {

    await removeRivalDuoIdsFromGroups(duo)

    duo.activeGameId = null
    duo.activeDiscordId = null
    duo.activeGroup = selectedGroup
    duo.status = "waiting_capacity"

    await saveRivalDuo(duo)

    return {
      ok: false,
      waiting: true,
      full: true,
      group: selectedGroup,
      message:
        `⚠️ The **${getGroupLabel(selectedGroup)}** group is currently full ` +
        `(**25/25**).\n` +
        `Your Rival Duo remains **online** and will stay waiting for a free slot.`
    }
  }

  // =====================================================
  // NORMAL HOURLY ROTATION
  // =====================================================

  const now = rivalNow()

  const shouldRotate =
    force ||
    !duo.lastRotationAt ||
    now - Number(duo.lastRotationAt || 0) >= RIVAL_DUO_ROTATION_MS

  if (!duo.activeGameId || shouldRotate) {

    if (!duo.cededUsers) {
      duo.cededUsers = {}
    }

    let index =
      Number(duo.activeIndex || 0) % members.length

    let activeMember = members[index]

    // Si el miembro elegido cedió su reroll,
    // pasamos automáticamente al otro.
    if (duo.cededUsers[activeMember.discordId] === true) {

      index = (index + 1) % members.length
      activeMember = members[index]

      // Ambos cedieron
      if (duo.cededUsers[activeMember.discordId] === true) {

        await removeRivalDuoIdsFromGroups(duo)

        duo.activeGameId = null
        duo.activeDiscordId = null
        duo.activeGroup = selectedGroup
        duo.status = "idle"

        await saveRivalDuo(duo)

        return {
          ok: false,
          waiting: false,
          message:
            "⚫ Both members have yielded their reroll. Duo is idle."
        }
      }
    }

    await removeRivalDuoIdsFromGroups(duo)

    duo.activeGameId = activeMember.gameId
    duo.activeDiscordId = activeMember.discordId
    duo.activeGroup = selectedGroup
    duo.lastRotationAt = now
    duo.activeIndex = (index + 1) % members.length
    duo.status = "online"

    await redis.sadd(
      onlineKey(selectedGroup),
      activeMember.gameId
    )

    await saveRivalDuo(duo)

    return {
      ok: true,
      waiting: false,
      message:
        `🟢 Rival Duo online in **${getGroupLabel(selectedGroup)}**.\n` +
        `Active ID: **${activeMember.gameId}**\n` +
        `Active user: <@${activeMember.discordId}>`
    }
  }

  // =====================================================
  // ALREADY ONLINE
  // =====================================================

  if (duo.activeGameId && duo.activeGroup) {
    await redis.sadd(
      onlineKey(duo.activeGroup),
      duo.activeGameId
    )
  }

  duo.status = "online"

  await saveRivalDuo(duo)

  return {
    ok: true,
    waiting: false,
    message:
      `🟢 Rival Duo already online in **${getGroupLabel(duo.activeGroup)}**.\n` +
      `Active ID: **${duo.activeGameId}**\n` +
      `Active user: <@${duo.activeDiscordId}>`
  }
}

async function setRivalDuoOnline(discordId) {
  discordId = String(discordId)

  const allDuos = await loadAllRivalDuos()

  let foundDuo = null

  for (const duoId in allDuos) {
    const duo = allDuos[duoId]

    if (!duo || !duo.members) continue
    if (!duo.members[discordId]) continue

    foundDuo = duo
    break
  }

  if (!foundDuo) {
    return {
      ok: false,
      message: "❌ You are not registered in any Rival Duo."
    }
  }

  ensureRivalDuoGroupState(foundDuo)

  if (!foundDuo.onlineUsers || typeof foundDuo.onlineUsers !== "object") {
    foundDuo.onlineUsers = {}
  }

  foundDuo.onlineUsers[discordId] = true

  await saveRivalDuo(foundDuo)

  return {
    ok: true,
    duo: foundDuo,
    message:
      `🤝 **${displayRivalDuoName(foundDuo)}**\n` +
      `You are now marked as **online**.\n\n` +
      `Select the group where both members want to reroll.`
  }
}
async function selectRivalDuoGroup(discordId, selectedGroup, duoId) {
  discordId = String(discordId)

  if (!["Elite_Four", "Gym_Leader"].includes(selectedGroup)) {
    return {
      ok: false,
      message: "❌ Invalid Rival Duo group."
    }
  }

  const duo = await getRivalDuoById(duoId)

  if (!duo) {
    return {
      ok: false,
      message: "❌ You are not registered in any Rival Duo."
    }
  }

  ensureRivalDuoGroupState(duo)

  const members = getRivalDuoMembers(duo)

  if (members.length < 2) {
    return {
      ok: false,
      message: "⏳ Your Rival Duo is still waiting for its second member."
    }
  }

  if (!duo.onlineUsers || typeof duo.onlineUsers !== "object") {
    duo.onlineUsers = {}
  }

  if (duo.onlineUsers[discordId] !== true) {
    return {
      ok: false,
      message: "❌ You must use `/online` first."
    }
  }

  // Guardar la selección de este usuario
  duo.groupSelections[discordId] = selectedGroup

  await saveRivalDuo(duo)

  const otherMember = members.find(
    member => String(member.discordId) !== discordId
  )

  const otherSelection =
    otherMember
      ? duo.groupSelections[otherMember.discordId]
      : null

  // =====================================================
  // PARTNER HAS NOT SELECTED YET
  // =====================================================

  if (!otherSelection) {
    return {
      ok: true,
      waiting: true,
      duo,
      message:
        `✅ You selected **${getGroupLabel(selectedGroup)}**.\n\n` +
        `⏳ Waiting for your partner to select a group.`
    }
  }

  // =====================================================
  // DIFFERENT GROUPS
  // =====================================================

  if (otherSelection !== selectedGroup) {

    duo.activeGameId = null
    duo.activeDiscordId = null
    duo.activeGroup = null
    duo.status = "selection_mismatch"

    await removeRivalDuoIdsFromGroups(duo)
    await saveRivalDuo(duo)

    return {
      ok: true,
      mismatch: true,
      duo,
      message:
        `⚠️ **Group selection mismatch.**\n\n` +
        `You selected **${getGroupLabel(selectedGroup)}**.\n` +
        `Your partner selected **${getGroupLabel(otherSelection)}**.\n\n` +
        `Both members must select the **same group**.\n` +
        `Use \`/online\` again to select the correct group.`
    }
  }

  // =====================================================
  // BOTH SELECTED THE SAME GROUP
  // =====================================================

  const result = await activateRivalDuoId(duo, true)

  return {
    ok: result.ok,
    waiting: result.waiting,
    full: result.full || false,
    duo,
    message: result.message
  }
}


async function setRivalDuoOffline(discordId, reason = "offline") {
  discordId = String(discordId)

  const allDuos = await loadAllRivalDuos()
  const messages = []
  let found = false

  for (const duoId in allDuos) {
    const duo = allDuos[duoId]
    if (!duo || !duo.members) continue

    if (!duo.members[discordId]) continue

    found = true

    await removeRivalDuoIdsFromGroups(duo)

if (!duo.onlineUsers || typeof duo.onlineUsers !== "object") {
  duo.onlineUsers = {}
}

duo.onlineUsers[discordId] = false

const member = duo.members[discordId]

if (member?.gameId) {
  await redis.srem(
    "online:Elite_Four",
    member.gameId
  )

  await redis.srem(
    "online:Gym_Leader",
    member.gameId
  )
}
 duo.activeGroup = null   
duo.activeGameId = null
duo.activeDiscordId = null
duo.status = "offline"
    duo.offlineReason = reason
    duo.offlineAt = rivalNow()
    
    await saveRivalDuo(duo)

    messages.push(`🔴 Rival Duo offline: **${displayRivalDuoName(duo)}**.`)
  }

  if (!found) {
    return {
      ok: false,
      message: "❌ You are not registered in any Rival Duo."
    }
  }

  return {
    ok: true,
    message: messages.join("\n")
  }
}

async function tickRivalDuoRotation() {
  const duos = await loadAllRivalDuos()

  for (const duo of Object.values(duos)) {
    if (!duo) continue

    if (
      !["online", "waiting_capacity"].includes(duo.status)
    ) {
      continue
    }

    await activateRivalDuoId(duo, false)
  }
}

async function changeRivalDuoGameId(discordId, newGameId) {
  discordId = String(discordId)
  newGameId = String(newGameId || "").trim()

  if (!isValidGameId(newGameId)) {
    return {
      ok: false,
      message: "❌ ID must be exactly 16 digits."
    }
  }


  const duo = await getRivalDuoByUser(discordId)

  if (!duo) {
    return {
      ok: false,
      message: "❌ You are not registered in a Rival Duo."
    }
  }

  const member = getRivalDuoMember(duo, discordId)

  if (!member) {
    return {
      ok: false,
      message: "❌ Rival Duo member data was not found."
    }
  }

  const oldGameId = String(member.gameId || "").trim()

  if (oldGameId === newGameId) {
    return {
      ok: true,
      message: `✅ Your Rival Duo ID is already **${newGameId}**.`
    }
  }

  if (oldGameId && isValidGameId(oldGameId)) {
    await redis.srem("online:Elite_Four", oldGameId)
await redis.srem("online:Gym_Leader", oldGameId)

    if (typeof redis.hdel === "function") {
      await redis.hdel(RIVAL_DUO_BY_GAMEID_KEY, oldGameId)
    } else {
      const indexes = await redis.hgetall(RIVAL_DUO_BY_GAMEID_KEY)

      if (indexes && typeof indexes === "object") {
        delete indexes[oldGameId]

        await redis.del(RIVAL_DUO_BY_GAMEID_KEY)

        if (Object.keys(indexes).length > 0) {
          await redis.hset(RIVAL_DUO_BY_GAMEID_KEY, indexes)
        }
      }
    }
  }

  member.gameId = newGameId
  member.updatedAt = rivalNow()

  duo.members[discordId] = member

  if (String(duo.activeDiscordId || "") === discordId) {
    duo.activeGameId = newGameId
    duo.lastRotationAt = rivalNow()

if (
  duo.status === "online" &&
  duo.activeGroup
) {
  await redis.sadd(
    onlineKey(duo.activeGroup),
    newGameId
  )
}
  }

  await saveRivalDuo(duo)
  await saveRivalDuoIndexes(duo)

  return {
    ok: true,
    message:
      `🔄 Rival Duo ID updated.\n` +
      `Old ID: ${oldGameId || "None"}\n` +
      `New ID: ${newGameId}`
  }
}

function formatRivalDuoTime(ms) {
  ms = Math.max(0, Number(ms) || 0)

  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

async function getRivalDuoStatusLabel(duo) {
  const members = getRivalDuoMembers(duo)

  if (members.length < 2) {
    return "⏳ Waiting Partner"
  }

  const onlineCount = members.filter(member =>
    duo.onlineUsers?.[member.discordId] === true
  ).length

  if (onlineCount < 2) {
    return "🔴 Offline"
  }

  if (duo.activeGameId) {
    return "🟢 Online"
  }

  return "⚫ Idle"
}

async function buildRivalDuoListMessage() {
  const duos = await loadAllRivalDuos()
  const list = Object.values(duos).filter(Boolean)

  if (!list.length) {
    return "📭 No Rival Duos registered."
  }

  const rotationMs = RIVAL_DUO_ROTATION_MS
  let msg = "🤝 **Rival Duo List**\n\n"
  let index = 1

  for (const duo of list) {
    const status = await getRivalDuoStatusLabel(duo)
    const members = getRivalDuoMembers(duo)

    const activeMember = members.find(m => String(m.discordId) === String(duo.activeDiscordId))
    const nextMember = members.find(m => String(m.discordId) !== String(duo.activeDiscordId))

    let elapsedText = "0s"
    let remainingText = "Not active"

    if (duo.status === "online" && duo.activeGameId && duo.lastRotationAt) {
      const elapsed = Date.now() - Number(duo.lastRotationAt || 0)
      const remaining = Math.max(0, rotationMs - elapsed)
      elapsedText = formatRivalDuoTime(elapsed)
      remainingText = formatRivalDuoTime(remaining)
    }

    msg += `**#${index} — ${displayRivalDuoName(duo)}**\n`
    msg += `Status: ${status}\n`

    if (members[0]) {
      const onlineIcon = duo.onlineUsers?.[members[0].discordId] ? "🟢" : "🔴"
      const yieldedTag = duo.cededUsers?.[members[0].discordId] ? " 🚫 *(Yielded)*" : ""
      msg += `${onlineIcon} User A: <@${members[0].discordId}> | ID: \`${members[0].gameId}\`${yieldedTag}\n`
    } else {
      msg += `⚫ User A: Empty\n`
    }

    if (members[1]) {
      const onlineIcon = duo.onlineUsers?.[members[1].discordId] ? "🟢" : "🔴"
      const yieldedTag = duo.cededUsers?.[members[1].discordId] ? " 🚫 *(Yielded)*" : ""
      msg += `${onlineIcon} User B: <@${members[1].discordId}> | ID: \`${members[1].gameId}\`${yieldedTag}\n`
    } else {
      msg += `⚫ User B: Empty\n`
    }

    if (duo.activeGameId) {
      msg += `Active ID: \`${duo.activeGameId}\`\n`
      msg += `Active user: ${activeMember ? `<@${activeMember.discordId}>` : "Unknown"}\n`
      msg += `Active time: **${elapsedText}**\n`
      msg += `Time left: **${remainingText}**\n`
      msg += `Next: ${nextMember ? `<@${nextMember.discordId}> | \`${nextMember.gameId}\`` : "Unknown"}\n`
    } else {
      msg += `Active ID: None\n`
      msg += `Time left: Not active\n`
    }

    msg += "\n"
    index++
  }

  if (msg.length > 1900) {
    msg = msg.slice(0, 1850) + "\n\n⚠️ List truncated because Discord messages have a size limit."
  }

  return msg
}
//tewmina



//Comandos
let rivalRotationRunning = false

client.once("clientReady", async () => {
  console.log(`✅ Bot listo como ${client.user.tag}`);

  startDailyScheduler();

  setInterval(async () => {

    if (rivalRotationRunning) return

    rivalRotationRunning = true

    try {
      await tickRivalDuoRotation()
    } catch (err) {
      console.error("Rival Duo rotation error:", err)
    } finally {
      rivalRotationRunning = false
    }

  }, 60 * 1000)
 // }, 10 * 1000)
  
 
  //console.log(`🧹 Limpiando comandos...`);

//  const { REST, Routes } = require("discord.js");
// const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  //try {
    // 🔥 BORRAR TODOS LOS COMANDOS DEL SERVIDOR
   // await rest.put(
    //  Routes.applicationGuildCommands(
      //  process.env.CLIENT_ID,
      // process.env.GUILD_ID
      //),
     // { body: [] }
   // );

  // console.log("✅ Comandos eliminados del servidor");
 // } catch (error) {
   // console.error("❌ Error borrando comandos:", error);
// }
//});
  




  const { REST, Routes, SlashCommandBuilder } = require("discord.js");

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);



  // 🔥 DEFINIR COMANDOS NUEVOS
  const commands = [
  new SlashCommandBuilder()
    .setName("register")
    .setDescription("Register your main game ID")
    .addStringOption(option =>
      option.setName("id")
        .setDescription("Your 16 digit main ID")
        .setRequired(true)
    ),
new SlashCommandBuilder()
  .setName("change")
  .setDescription("Change your main game ID")
  .addStringOption(option =>
    option.setName("id")
      .setDescription("New 16 digit ID")
      .setRequired(true)
  ),

    new SlashCommandBuilder()
  .setName("register_duo")
  .setDescription("Register as Rival Duo member")
  .addStringOption(option =>
    option.setName("id")
      .setDescription("Your 16 digit Rival Duo ID")
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName("heartbeat_name")
      .setDescription("Exact name shown in your heartbeat")
      .setRequired(true)
  ),
new SlashCommandBuilder()
  .setName("duo_list")
  .setDescription("Show all Rival Duos and their active rotation status"),
new SlashCommandBuilder()
  .setName("heartbeat_name")
  .setDescription("Set your exact heartbeat name")
  .addStringOption(option =>
    option.setName("name")
      .setDescription("Exact name shown in your heartbeat")
      .setRequired(true)
  ),

   new SlashCommandBuilder()
  .setName("change_rol")
  .setDescription("Select your active group"),

    new SlashCommandBuilder()
      .setName("add_sec")
      .setDescription("Register your secondary game ID")
      .addStringOption(option =>
        option.setName("id")
          .setDescription("Your 16 digit secondary ID")
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("yield_reroll")
      .setDescription("Toggle Solo Mode by yielding or reclaiming your active reroll slot"),

      new SlashCommandBuilder()
      .setName("online_count")
  .setDescription("Shows how many users are online in each group."),



///////

new SlashCommandBuilder()
  .setName("schedule_events")
  .setDescription("Daily online/offline scheduler (UTC)")
  .addStringOption(opt =>
    opt.setName("mode")
      .setDescription("Start or Stop")
      .setRequired(true)
      .addChoices(
        { name: "Start Daily Schedule", value: "start" },
        { name: "Stop All Schedules", value: "stop" }
      )
  )
  .addIntegerOption(opt =>
    opt.setName("online_hour")
      .setDescription("Online Hour (UTC 0-23)")
      .setRequired(false)
  )
  .addIntegerOption(opt =>
    opt.setName("online_minute")
      .setDescription("Online Minute (0-59)")
      .setRequired(false)
  )
  .addIntegerOption(opt =>
    opt.setName("offline_hour")
      .setDescription("Offline Hour (UTC 0-23)")
      .setRequired(false)
  )
  .addIntegerOption(opt =>
    opt.setName("offline_minute")
      .setDescription("Offline Minute (0-59)")
      .setRequired(false)
  ),

new SlashCommandBuilder()
  .setName("set_offline")
  .setDescription("Force a user offline"),



   
/////
    new SlashCommandBuilder()
      .setName("online")
      .setDescription("Set your main account online"),

    new SlashCommandBuilder()
      .setName("online_sec")
      .setDescription("Set your secondary account online"),

    new SlashCommandBuilder()
      .setName("offline")
      .setDescription("Set your accounts offline"),

    new SlashCommandBuilder()
      .setName("list")
      .setDescription("List registered users"),

    new SlashCommandBuilder()
      .setName("online_list")
      .setDescription("List online users in your group"),

  new SlashCommandBuilder()
  .setName("add_vip")
  .setDescription("Add VIP ID")
  .addStringOption(option =>
    option.setName("id")
      .setDescription("16 digit VIP ID")
      .setRequired(true)
  )
  
      
      

  ].map(cmd => cmd.toJSON());

  try {

 //   // 🚀 REGISTRAR NUEVOS COMANDOS
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
     ),
      { body: commands }
    );

   console.log("✅ Slash commands registrados automáticamente");

  } catch (error) {
    console.error("❌ Error registrando comandos:", error);
 }
});
//termina comandos

//client.login(process.env.TOKEN)

// StartPPMCounter

const HEARTBEAT_CHANNEL_ID = "1483616146996465735"
const TOTAL_CHANNEL_ID = "1484416376436424794"

// ===== CONTADOR DE PPM =====
//const HISTORY_FILE = "./ppm_history.json";
//const TWELVE_HOURS = 12 * 60 * 60 * 1000;



// ====== NUEVO updateTotalPPM ======
//const HISTORY_FILE = "./ppm_history.json";
//const TWELVE_HOURS = 12 * 60 * 60 * 1000;





client.on("interactionCreate", async (interaction) => {
  if (
    !interaction.isChatInputCommand() &&
    !interaction.isStringSelectMenu() &&
    !interaction.isButton()
  ) return;

 // if (!interaction.isChatInputCommand()) return
  const { commandName } = interaction;

  const userId = interaction.user.id
  if (interaction.isChatInputCommand() && interaction.commandName === "register_duo") {
  const hasRole = interaction.member.roles.cache.some(r => r.name === "Rival_Duo")

  if (!hasRole) {
    return interaction.reply({
      content: "❌ You need the Rival_Duo role to use this command.",
      flags: MessageFlags.Ephemeral
    })
  }

  const gameId = interaction.options.getString("id").trim()
  const heartbeatName = interaction.options.getString("heartbeat_name").trim()

  if (!isValidId(gameId)) {
    return interaction.reply({
      content: "❌ ID must be exactly 16 digits.",
      flags: MessageFlags.Ephemeral
    })
  }

  const pending = {
    discordId: interaction.user.id,
    name: interaction.member?.displayName || interaction.user.username,
    heartbeatName,
    gameId
  }

  await savePendingRivalDuoRegistration(interaction.user.id, pending)

  const openDuos = await findOpenRivalDuos()

if (!openDuos.length) {
  const result = await registerRivalDuoMember(pending)

  if (result.ok) {
await redis.set(
  `active_roles:${interaction.user.id}`,
  "Rival_Duo"
)
  }

  return interaction.reply({
    content: result.message,
    flags: MessageFlags.Ephemeral
  })
}

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`rival_duo_select_${interaction.user.id}`)
    .setPlaceholder("Select open Duo or create new")
    .addOptions([
      {
        label: "Create new Rival Duo",
        value: "create_new"
      },
      ...openDuos.slice(0, 24).map(duo => ({
        label: displayRivalDuoName(duo).slice(0, 100),
        value: duo.id
      }))
    ])

  return interaction.reply({
    content: "There are open Rival Duo registrations. Select one or create a new Duo.",
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral
  })
}
// =====================================================
// RIVAL DUO GROUP SELECTION
// =====================================================

if (
  interaction.isStringSelectMenu() &&
  interaction.customId.startsWith("rival_duo_group_select_")
) {

  const parts = interaction.customId.split("_")

  // Formato:
  // rival_duo_group_select_DUOID_DISCORDID
  const discordId = parts.pop()
  const duoId = parts.slice(4).join("_")

  if (String(interaction.user.id) !== String(discordId)) {
    return interaction.reply({
      content: "❌ This menu is not for you.",
      flags: MessageFlags.Ephemeral
    })
  }

  const selectedGroup = interaction.values[0]

  const duo = await getRivalDuoById(duoId)

  if (!duo) {
    return interaction.update({
      content:
        "❌ This Rival Duo no longer exists.",
      components: []
    })
  }

  if (!duo.members?.[discordId]) {
    return interaction.update({
      content:
        "❌ You are not a member of this Rival Duo.",
      components: []
    })
  }

const result = await selectRivalDuoGroup(
  discordId,
  selectedGroup,
  duoId
)

  if (!result.ok) {
    return interaction.update({
      content: result.message,
      components: []
    })
  }

  // ===================================================
  // WAITING FOR PARTNER
  // ===================================================

  if (result.waiting) {
    return interaction.update({
      content: result.message,
      components: []
    })
  }

  // ===================================================
  // MISMATCH
  // ===================================================

  if (result.mismatch) {

    // Intentar avisar también al otro miembro
    const members = getRivalDuoMembers(result.duo)

    for (const member of members) {
      try {

        const discordUser =
          await client.users.fetch(member.discordId)

        await discordUser.send(
          `⚠️ **Rival Duo group selection mismatch.**\n\n` +
          `${displayRivalDuoName(result.duo)}\n\n` +
          `Both members must select the same group.\n` +
          `Use \`/online\` again to select the correct group.`
        )

      } catch (err) {
        console.warn(
          `Could not DM Rival Duo member ${member.discordId}:`,
          err.message
        )
      }
    }

    return interaction.update({
      content: result.message,
      components: []
    })
  }

  // ===================================================
  // GROUP FULL
  // ===================================================

  if (result.full) {

    const members = getRivalDuoMembers(result.duo)

    for (const member of members) {
      try {

        const discordUser =
          await client.users.fetch(member.discordId)

        await discordUser.send(
          `⚠️ **Rival Duo could not enter ${getGroupLabel(selectedGroup)}.**\n\n` +
          `The group is currently full (**25/25**).\n\n` +
          `Your Rival Duo remains **online** and will wait for a free slot.\n` +
          `You can also use \`/online\` again to select another group.`
        )

      } catch (err) {
        console.warn(
          `Could not DM Rival Duo member ${member.discordId}:`,
          err.message
        )
      }
    }

    return interaction.update({
      content: result.message,
      components: []
    })
  }

  // ===================================================
  // SUCCESS
  // ===================================================

  return interaction.update({
    content: result.message,
    components: []
  })
}
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rival_duo_select_")) {
  const targetUserId = interaction.customId.replace("rival_duo_select_", "")

  if (interaction.user.id !== targetUserId) {
    return interaction.reply({
      content: "❌ This menu is not for you.",
      flags: MessageFlags.Ephemeral
    })
  }

  const pending = await loadPendingRivalDuoRegistration(interaction.user.id)

  if (!pending) {
    return interaction.update({
      content: "❌ Registration expired. Use /register_duo again.",
      components: []
    })
  }

  const selected = interaction.values[0]

 const result = await registerRivalDuoMember({
  ...pending,
  duoId: selected === "create_new" ? null : selected
})

if (result.ok) {
await redis.set(
  `active_roles:${interaction.user.id}`,
  "Rival_Duo"
)
}

await clearPendingRivalDuoRegistration(interaction.user.id)

return interaction.update({
  content: result.message,
  components: []
})
  }

//  let users = await getUsers()
  if (interaction.isChatInputCommand() && interaction.commandName === "duo_list") {
  const hasRole =
    interaction.member.roles.cache.some(r => r.name === "Rival_Duo") ||
    interaction.member.roles.cache.some(r => r.name === "Champion")

  if (!hasRole) {
    return interaction.reply({
      content: "❌ You need the Rival_Duo or Champion role to use this command.",
      flags: MessageFlags.Ephemeral
    })
  }

  const message = await buildRivalDuoListMessage()

  return interaction.reply({
    content: message,
    flags: MessageFlags.Ephemeral
  })
}

  // Dentro de tu interactionCreate para comandos de barra:
  if (interaction.commandName === "yield_reroll") {
    const hasRole = interaction.member.roles.cache.some(r => r.name === "Rival_Duo");

    if (!hasRole) {
      return interaction.reply({
        content: "❌ You need the Rival_Duo role to use this command.",
        flags: [MessageFlags.Ephemeral]
      });
    }

    const discordId = String(interaction.user.id);
    const duo = await getRivalDuoByUser(discordId);

    if (!duo) {
      return interaction.reply({
        content: "❌ You are not registered in any active Rival Duo.",
        flags: [MessageFlags.Ephemeral]
      });
    }

    if (!duo.cededUsers) {
      duo.cededUsers = {};
    }

    // Cambiar estado (True / False)
    const isCeded = duo.cededUsers[discordId] === true;
    duo.cededUsers[discordId] = !isCeded;

    await saveRivalDuo(duo);

    // Si el usuario cede su turno y está activo en este momento, forzamos rotación inmediata
    if (duo.cededUsers[discordId] && String(duo.activeDiscordId) === discordId) {
      await activateRivalDuoId(duo, true);
    } else {
      await saveRivalDuo(duo);
    }

    const estadoMsg = duo.cededUsers[discordId]
      ? "⚠️ **You have yielded your reroll**. Your ID will be skipped during hourly rotations, keeping your partner active (Solo Mode)."
      : "✅ **You have reclaimed your reroll**. Your ID will now participate in the normal hourly rotation again.";

    return interaction.reply({
      content: estadoMsg,
      flags: [MessageFlags.Ephemeral]
    });
  }
//SCHENDULE

if (interaction.commandName === "online_count") {

  const lines = []

  for (const group of Object.keys(GROUP_CONFIG)) {
    const onlineUsers = await getOnlineUsersByGroup(group)

    lines.push(
      `**${group}**: ${onlineUsers.length}/10 online`
    )
  }

  return interaction.reply({
    content:
      "## 🟢 Online Users\n\n" +
      lines.join("\n"),
    flags: MessageFlags.Ephemeral
  })
}
  
if (interaction.commandName === "schedule_events") {

  const mode = interaction.options.getString("mode")
  const schedules = await loadSchedules()

const now = new Date()

const utcNow = now.toISOString().slice(11,16) // HH:MM en UTC real 24h
  if (mode === "stop") {

    delete schedules[interaction.user.id]
    await saveSchedules(schedules)

    return interaction.reply(`🛑 All daily schedules stopped.\n🕒 Current UTC time: ${utcNow}`)
  }

  const group = await getUserGroup(interaction)
  if (!group) return interaction.reply("❌ No reroll group detected")

  const config = GROUP_CONFIG[group]

  let users = await getUsers(group)
  const userData = users[interaction.user.id]

  if (!userData?.main_id) {
    return interaction.reply("❌ You must register first")
  }

  const onlineHour = interaction.options.getInteger("online_hour")
  const onlineMinute = interaction.options.getInteger("online_minute")
  const offlineHour = interaction.options.getInteger("offline_hour")
  const offlineMinute = interaction.options.getInteger("offline_minute")

  if (
    onlineHour == null || onlineMinute == null ||
    offlineHour == null || offlineMinute == null
  ) {
    return interaction.reply("❌ You must provide all time values")
  }

  if (
    onlineHour < 0 || onlineHour > 23 ||
    offlineHour < 0 || offlineHour > 23 ||
    onlineMinute < 0 || onlineMinute > 59 ||
    offlineMinute < 0 || offlineMinute > 59
  ) {
    return interaction.reply("❌ Invalid UTC time format")
  }

  schedules[interaction.user.id] = {
    group,
    main_id: userData.main_id,
    online_hour: onlineHour,
    online_minute: onlineMinute,
    offline_hour: offlineHour,
    offline_minute: offlineMinute,
    last_online: null,
    last_offline: null
  }

  await saveSchedules(schedules)

  return interaction.reply(
    `✅ Daily schedule activated\n\n` +
    `🟢 Online: ${onlineHour.toString().padStart(2,"0")}:${onlineMinute.toString().padStart(2,"0")} UTC\n` +
    `🔴 Offline: ${offlineHour.toString().padStart(2,"0")}:${offlineMinute.toString().padStart(2,"0")} UTC\n\n` +
    `🕒 Current UTC time: ${utcNow}`
  )
}



 
// 🔹 VIP ids
// 🔹 GP COMMAND (solo Champion + selector de grupo)
if (interaction.commandName === "add_vip") {

  const CHAMPION_ROLE_ID = "1486206362332434634"; // 👈 tu rol Champion

  // ❌ Solo funciona dentro de servidor
  if (!interaction.inGuild()) {
    return interaction.reply({
      content: "❌ This command can only be used inside a server.",
      flags: MessageFlags.Ephemeral
    });
  }

  const member = interaction.member;

  // 🔒 Verificar rol Champion
  if (!member.roles.cache.has(CHAMPION_ROLE_ID)) {
    return interaction.reply({
      content: "⛔ Only Champions can use this command.",
      flags: MessageFlags.Ephemeral
    });
  }

  const id = interaction.options.getString("id");

  if (!/^\d{16}$/.test(id)) {
    return interaction.reply({
      content: "❌ ID must be 16 digits",
      flags: MessageFlags.Ephemeral
    });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`select_gp_group_${id}`)
    .setPlaceholder("Select group to add GP")
    .addOptions([
      {
        label: "Trainer",
        value: "Trainer"
      },
      {
        label: "Gym Leader",
        value: "Gym_Leader"
      },
      {
        label: "Elite Four",
        value: "Elite_Four"
      }
    ]);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    content: `🔥 Select group to add VIP ID:\n\`${id}\``,
    components: [row],
    flags: MessageFlags.Ephemeral
  });
}

if (interaction.commandName === "heartbeat_name") {
  const group = await getUserGroup(interaction)

  if (!group) {
    return interaction.reply({
      content: "❌ No group",
      flags: MessageFlags.Ephemeral
    })
  }

  const heartbeatName = interaction.options.getString("name").trim()

  if (!heartbeatName) {
    return interaction.reply({
      content: "❌ Invalid heartbeat name.",
      flags: MessageFlags.Ephemeral
    })
  }

  let users = await getUsers(group)
  const oldData = users[interaction.user.id]

  if (!oldData?.main_id) {
    return interaction.reply({
      content: "❌ You must register first.",
      flags: MessageFlags.Ephemeral
    })
  }

  users[interaction.user.id] = buildUserData(oldData, interaction, {
    heartbeatName,
    aliases: uniqueList([
      ...(Array.isArray(oldData.aliases) ? oldData.aliases : []),
      oldData.name,
      oldData.heartbeatName,
      heartbeatName
    ])
  })

  await saveUsers(users, group)

  return interaction.reply({
    content:
      `✅ Heartbeat name updated.\n` +
      `👤 Display name: **${users[interaction.user.id].name}**\n` +
      `📡 Heartbeat name: **${users[interaction.user.id].heartbeatName}**`,
    flags: MessageFlags.Ephemeral
  })
}
  
//tegister

if (interaction.commandName === "register") {

  const group = await getUserGroup(interaction);

  if (!group) {
    return interaction.reply("❌ No group");
  }

  const config = GROUP_CONFIG[group];
  const id = interaction.options.getString("id");

  if (!/^\d{16}$/.test(id)) {
    return interaction.reply("❌ ID must be 16 digits");
  }
  if (await isGameIdAlreadyUsed(id, group)) {
  return interaction.reply("❌ This ID is already being used by another user.")
}

  let users = await getUsers(group)

  const oldData = users[interaction.user.id] || {};

users[interaction.user.id] = buildUserData(oldData, interaction, {
  main_id: id,
  sec_id: oldData.sec_id || null
});

await saveUsers(users, group)

return interaction.reply(
  `✅ Main ID registered in **${group}**\n` +
  `👤 Display name: **${users[interaction.user.id].name}**\n` +
  `📡 Heartbeat name: **${users[interaction.user.id].heartbeatName}**`
);
}

  // 🔥 Guardar en archivo correcto del gist correcto       

//adsec
if (interaction.commandName === "add_sec") {

const group = await getUserGroup(interaction);

if (!group) {
  return interaction.reply("❌ No group");
}

  const config = GROUP_CONFIG[group]

  const secId = interaction.options.getString("id")

  if (!/^\d{16}$/.test(secId)) {
    return interaction.reply("❌ ID must be 16 digits")
  }
  if (await isGameIdAlreadyUsed(secId, group)) {
  return interaction.reply("❌ This ID is already being used by another user.")
}
  

  // 🔥 Cargar desde el archivo correcto
  let users = await getUsers(group)

  const userData = users[interaction.user.id]

  if (!userData) {
    return interaction.reply("❌ You must register main ID first")
  }

users[interaction.user.id] = buildUserData(userData, interaction, {
  sec_id: secId
})

await saveUsers(users, group)

return interaction.reply("✅ Secondary ID added")
}


//change

if (interaction.commandName === "change") {

try {

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const newId = interaction.options.getString("id")

  if (!/^\d{16}$/.test(newId)) {
    return interaction.editReply("❌ ID must be exactly 16 digits (numbers only)")
  }

const group = await getUserGroup(interaction)

if (await isGameIdAlreadyUsed(newId, group, interaction.user.id)) {
  return interaction.editReply("❌ This ID is already being used by another user.")
}

// RIVAL DUO
if (group === "Rival_Duo") {

  const result = await changeRivalDuoGameId(
    interaction.user.id,
    newId
  )

  return interaction.editReply(result.message)
}

let users = await getUsers(group)

const userData = users[interaction.user.id]

if (!userData) {
  return interaction.editReply("❌ You must register first")
}

  // OFFLINE ID VIEJO
  if (userData.main_id) {
    await setOnlineStatus(
      "offline",
      userData.main_id,
      group
    )
  }

  // ACTUALIZAR
  users[interaction.user.id] = buildUserData(
    userData,
    interaction,
    {
      main_id: newId,
      sec_id: userData.sec_id || null
    }
  )

  await saveUsers(users, group)

  return interaction.editReply(
    `🔄 Main ID updated in **${group}**\n` +
    `👤 Display name: **${users[interaction.user.id].name}**\n` +
    `📡 Heartbeat name: **${users[interaction.user.id].heartbeatName}**`
  )

} catch (error) {

  console.error("CHANGE ERROR:", error)

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply("❌ Unexpected error updating ID")
  } else {
    return interaction.reply("❌ Unexpected error updating ID")
  }
}
}

  
if (interaction.commandName === "online") {

const activeRole = await getUserGroup(interaction)

if (activeRole === "Rival_Duo") {
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  })

  const result = await setRivalDuoOnline(
    interaction.user.id
  )

  if (!result.ok) {
    return interaction.editReply(result.message)
  }

  return interaction.editReply({
    content:
      result.message +
      "\n\n**Both members must select the same group.**",
    components: [
      buildRivalDuoGroupMenu(
        result.duo,
        interaction.user.id
      )
    ]
  })
}

if (!activeRole) {
  return interaction.reply({
    content: "❌ No active group selected.",
    flags: MessageFlags.Ephemeral
  })
}


// Buscar SOLO dentro del grupo activo
const found = await findUserFlexible(interaction.user.id, activeRole)

if (!found) {
  return interaction.reply({
    content: "❌ You are not registered yet. Use /register first.",
    flags: MessageFlags.Ephemeral
  })
}

const { userData, group } = found


if (!userData.main_id) {
  return interaction.reply({
    content: "❌ You must register your main ID first",
    flags: MessageFlags.Ephemeral
  })
}

await interaction.deferReply({ flags: MessageFlags.Ephemeral })


const onlineUsers = await getOnlineUsersByGroup(group)

if (onlineUsers.length >= 25) {
  return interaction.editReply(
    `❌ The **${group}** group already has the maximum of **10** users online.`
  )
}


const ok = await setOnlineStatus(
  "online",
  userData.main_id,
  group
)

if (!ok) {
  return interaction.editReply("❌ Could not set main account online.")
}


return interaction.editReply(
  `🟢 Main account set online in **${group}**.`
)

}


//online sec
//online sec
if (interaction.commandName === "online_sec") {

  if (await isActiveRivalDuo(interaction)) {
    return interaction.reply({
      content: "❌ Rival Duo does not use secondary ID. Use /online instead.",
      flags: MessageFlags.Ephemeral
    })
  }

  const activeRole = await getUserGroup(interaction)

  if (!activeRole) {
    return interaction.reply({
      content: "❌ No active group selected.",
      flags: MessageFlags.Ephemeral
    })
  }

  const found = await findUserFlexible(interaction.user.id, activeRole)

  if (!found) {
    return interaction.reply({
      content: "❌ You are not registered yet. Use /register first.",
      flags: MessageFlags.Ephemeral
    })
  }

  const { userData, group } = found

  if (!userData.sec_id) {
    return interaction.reply({
      content: "❌ You must register your secondary ID first",
      flags: MessageFlags.Ephemeral
    })
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const ok = await setOnlineStatus("online", userData.sec_id, group)

  if (!ok) {
    return interaction.editReply("❌ Could not set secondary account online.")
  }

  return interaction.editReply(`🟢 Secondary account set online in **${group}**.`)
}




 

  // 🔹 OFFLINE
// 🔹 OFFLINE
if (interaction.commandName === "offline") {

await interaction.deferReply({
  flags: MessageFlags.Ephemeral
})


const activeRole = await getUserGroup(interaction)


if (activeRole === "Rival_Duo") {

  const result = await setRivalDuoOffline(
    interaction.user.id,
    "manual_offline"
  )

  return interaction.editReply(result.message)
}



if (!activeRole) {
  return interaction.editReply(
    "❌ No active group selected."
  )
}


// Buscar SOLO en grupo activo
const found = await findUserFlexible(interaction.user.id, activeRole)

if (!found) {
  return interaction.editReply("❌ You are not registered yet. Use /register first.")
}

const { userData, group } = found

let okMain = true
let okSec = true

if (userData.main_id) {
  okMain = await setOnlineStatus("offline", userData.main_id, group)
}

if (userData.sec_id) {
  okSec = await setOnlineStatus("offline", userData.sec_id, group)
}

if (!okMain || !okSec) {
  return interaction.editReply("❌ Some IDs could not be updated.")
}

return interaction.editReply(
  `🔴 ${userData.name} is now OFFLINE in **${group}**`
)

}
 
//SETOFFLINE

if (interaction.commandName === "set_offline") {
  const member = interaction.member;

  if (!member.roles.cache.some(role => role.name === "Champion")) {
    return interaction.reply({
      content: "❌ You need the **Champion** role to use this command.",
      flags: MessageFlags.Ephemeral
    });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId("select_offline_group")
    .setPlaceholder("Select group")
    .addOptions([
      {
        label: "Trainer",
        value: "Trainer"
      },
      {
        label: "Gym Leader",
        value: "Gym_Leader"
      },
      {
        label: "Elite Four",
        value: "Elite_Four"
      }
    ]);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    content: "Select the group:",
    components: [row],
    flags: MessageFlags.Ephemeral
  });
}

// 🔹 SELECT GP GROUP
if (interaction.isStringSelectMenu() && interaction.customId.startsWith("select_gp_group_")) {

  const id = interaction.customId.replace("select_gp_group_", "")
  const group = interaction.values[0]

  if (!GROUP_CONFIG[group]) {
    return interaction.update({
      content: "❌ Invalid group",
      components: []
    })
  }

  await addVipID(id, group)

  return interaction.update({
    content: `✅ VIP ID \`${id}\` added to **${group}**`,
    components: []
  })
}



if (interaction.isStringSelectMenu() && interaction.customId === "select_active_role") {

  const selected = interaction.values[0]

await redis.set(
  `active_roles:${interaction.user.id}`,
  selected
)

  return interaction.update({
    content: `✅ Active role set to **${getSelectableRoleLabel(selected)}**`,
    components: []
  })
}
if (interaction.isStringSelectMenu() && interaction.customId === "select_offline_group") {

  const group = interaction.values[0];

  if (!GROUP_CONFIG[group]) {
    return interaction.update({
      content: "❌ Invalid group selected.",
      components: []
    });
  }

  const onlineUsers = await getOnlineUsersByGroup(group);

  if (onlineUsers.length === 0) {
    return interaction.update({
      content: `⚫ No active users in **${group}**`,
      components: []
    });
  }

  const options = onlineUsers.slice(0, 25).map(user => ({
    label: user.label,
    description: user.id,
    value: `${group}|${user.id}`
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId("select_offline_user")
    .setPlaceholder("Select active user")
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.update({
    content: `Select active user from **${group}**:`,
    components: [row]
  });
}
 
 
//////
if (interaction.isStringSelectMenu() && interaction.customId === "select_offline_user") {

  const selected = interaction.values[0];
  const [group, id] = selected.split("|");

  const confirm = new ButtonBuilder()
    .setCustomId(`confirm_offline_${group}|${id}`)
    .setLabel("Confirm")
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(confirm);

   return interaction.update({
    content: `⚠️ Confirm OFFLINE for ID: ${id}\n📂 Group: ${group}`,
    components: [row]
  });
}

if (interaction.isButton() && interaction.customId.startsWith("confirm_offline_")) {

  const raw = interaction.customId.replace("confirm_offline_", "");
  const [group, id] = raw.split("|");

  if (!GROUP_CONFIG[group] || !id) {
    return interaction.update({
      content: "❌ Invalid offline action.",
      components: []
    });
  }

const ok = await setOnlineStatus("offline", id, group);

if (!ok) {
  return interaction.update({
    content: "❌ Could not set this ID offline.",
    components: []
  });
}

await interaction.update({
  content: `🔴 ID ${id} set OFFLINE in **${group}**`,
  components: []
});
}
 //////////

// 🔹 LIST
if (interaction.commandName === "list") {

  const group = await getUserGroup(interaction);
  if (!group) {
    return interaction.reply("❌ No reroll group detected");
  }

 const registeredUsers = await getUsers(group)

  if (Object.keys(registeredUsers).length === 0) {
    return interaction.reply("📭 No users registered");
  }

  let msg = `📋 **Registered users in ${group}:**\n\n`;

  for (const uid in registeredUsers) {
    const user = registeredUsers[uid];
    msg += `👤 ${user.name} | 📡 ${user.heartbeatName || user.name} → Main ID: ${user.main_id}\n`;
  }

  return interaction.reply(msg);
}

 // 🔹 ONLINE LIST
if (interaction.commandName === "online_list") {

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  })

  try {

    // 🔥 USAR ROL ACTIVO
    const group = await getUserGroup(interaction)

    if (!group) {
      return interaction.editReply("❌ No active role selected.")
    }

    // ===== RIVAL DUO =====
    if (group === "Rival_Duo") {

      const duos = await getAllRivalDuosByUser(interaction.user.id)

      if (!duos.length) {
        return interaction.editReply(
          "❌ You are not registered in any Rival Duo."
        )
      }

      let msg = ""

      for (const duo of duos) {

        const members = getRivalDuoMembers(duo)

        msg += `🤝 **${displayRivalDuoName(duo)}**\n`

        for (const member of members) {

          const online =
            duo.onlineUsers?.[member.discordId]
              ? "🟢"
              : "🔴"

          const active =
            String(member.discordId) === String(duo.activeDiscordId)
              ? " ⭐ ACTIVE"
              : ""

          msg += `${online} <@${member.discordId}> | \`${member.gameId}\`${active}\n`
        }

        msg += "\n"
      }

      return interaction.editReply(msg)
    }

    // 🔥 CARGAR SOLO EL GRUPO ACTIVO
    const onlineUsers = await getOnlineUsersByGroup(group)
    // ===== AGREGAR RIVAL DUOS ACTIVOS =====

if (group === "Elite_Four") {

  const duos = await loadAllRivalDuos()

  for (const duo of Object.values(duos)) {

    if (!duo) continue

    if (duo.status !== "online") continue

    if (!duo.activeGameId) continue

    const activeMember = getRivalDuoMembers(duo).find(m =>
      String(m.discordId) === String(duo.activeDiscordId)
    )

    if (!activeMember) continue

    onlineUsers.push({
      id: duo.activeGameId,
      label:
        `🤝 ${displayRivalDuoName(duo)} ` +
        `(ACTIVE: ${activeMember.name})`,
      user: null
    })
  }
}

    if (!onlineUsers.length) {
      return interaction.editReply(
        `⚫ No users online in ${group}`
      )
    }

    let msg = `🟢 Online users in **${group}**\n\n`

    for (const user of onlineUsers) {
      msg += `• ${user.label} — \`${user.id}\`\n`
    }

    return interaction.editReply(msg)

  } catch (err) {

    console.error("ONLINE_LIST ERROR:", err)

    return interaction.editReply(
      "❌ Something went wrong loading online list."
    )
  }
}

/////change_rol

if (interaction.commandName === "change_rol") {

  const member = interaction.member;

  const userGroups = getMemberSelectableRoles(member)

  if (userGroups.length === 0) {
    return interaction.reply({
      content: "❌ You don't have any valid reroll roles.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (userGroups.length === 1) {
    return interaction.reply({
      content: `⚠️ You only have one role (**${getSelectableRoleLabel(userGroups[0])}**).\nYou need at least 2 roles to switch.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const options = userGroups.map(group => ({
    label: getSelectableRoleLabel(group),
    value: group
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId("select_active_role")
    .setPlaceholder("Select your active group")
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    content: "🎯 Select your active group:",
    components: [row],
    flags: MessageFlags.Ephemeral
  });
}


 

if (commandName === "editpanel") {
  try {
    // Verificar si el usuario tiene el rol Champion
    const member = interaction.member; // miembro que ejecuta el comando
    if (!member.roles.cache.some(role => role.name === "Champion")) {
      return interaction.reply({
        content: "❌ You need the **Champion** role to use this command.",
        flags: MessageFlags.Ephemeral
      });
    }

    // ----- Resto del comando aquí -----
    await interaction.reply({
      content: "📝 Please send the **Message ID** of the panel you want to edit:",
      flags: MessageFlags.Ephemeral
    });

    const filter = m => m.author.id === interaction.user.id;
    const collectedId = await interaction.channel.awaitMessages({
      filter,
      max: 1,
      time: 60000,
      errors: ["time"]
    });
    const messageId = collectedId.first().content.trim();

    const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
    if (!message) {
      return interaction.followUp({ content: "❌ Message not found.", flags: MessageFlags.Ephemeral });
    }

    if (!message.embeds.length) {
      return interaction.followUp({ content: "❌ That message has no embed.", flags: MessageFlags.Ephemeral });
    }

    await interaction.followUp({
      content: "🔢 Now, please send the new **Rarity (1-5)**:",
      flags: MessageFlags.Ephemeral
    });

    const collectedRarity = await interaction.channel.awaitMessages({
      filter,
      max: 1,
      time: 60000,
      errors: ["time"]
    });

    const rarityInput = parseInt(collectedRarity.first().content.trim());
    if (isNaN(rarityInput) || rarityInput < 1 || rarityInput > 5) {
      return interaction.followUp({
        content: "❌ Invalid rarity. Must be a number between 1 and 5.",
        flags: MessageFlags.Ephemeral
      });
    }

    const oldEmbed = message.embeds[0];

    let color = 0x999999;
    if (rarityInput === 5) color = 0xFFD700;
    if (rarityInput === 4) color = 0x00ffcc;
    if (rarityInput === 3) color = 0x0099ff;

    const descMatch = oldEmbed.description?.match(/• (\d+)P\s+\|\s+\*\*(.+)\*\*/i);
    const pack = descMatch ? parseInt(descMatch[1]) : 1;
    const username = descMatch ? descMatch[2] : "Unknown";

    const newEmbed = new EmbedBuilder()
      .setColor(color)
      .setDescription(`## ✨ ${rarityInput}/5 • ${pack}P  |  **${username}**`);

    if (oldEmbed.image?.url) newEmbed.setImage(oldEmbed.image.url);

    await message.edit({ embeds: [newEmbed] });

    await interaction.followUp({
      content: `✅ Panel updated successfully to **${rarityInput}/5**!`,
      flags: MessageFlags.Ephemeral
    });

  } catch (err) {
    console.error("EDIT PANEL ERROR:", err);
    if (!interaction.replied) {
      await interaction.reply({
        content: "❌ Something went wrong.",
        flags: MessageFlags.Ephemeral
      });
    }
  }
}
});
    
  // 🔹 CIERRE CORRECTO DE client.on("interactionCreate")

    

client.on("messageCreate", async (message) => {

  // permitir webhooks o bots específicos
if (message.author.bot && !message.webhookId) return

  const text = message.content || ""
  const match = text.match(/\((\d{16})\)/)

  if (!match) return

  const id = match[1]

  // 🔥 detectar grupo por ID del canal
  const group = CHANNEL_GROUP_MAP[message.channel.id]

  if (!group) {
    console.log("⚠️ Canal no configurado:", message.channel.id)
    return
  }

  console.log(`🔥 GP detectado en ${group}:`, id)

  await addVipID(id, group)
})

client.login(TOKEN)
