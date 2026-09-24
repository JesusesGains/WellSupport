const SUPPORT_MESSAGE_COLUMNS = {
  id: "TEXT",
  conversation_id: "TEXT",
  sender_type: "TEXT",
  sender_user_id: "TEXT",
  sender_display_name: "TEXT",
  sender_avatar_url: "TEXT",
  client_message_id: "TEXT",
  body: "TEXT",
  created_at: "TEXT"
};

async function messageSchema(db) {
  const result = await db.prepare("PRAGMA table_info(support_messages)").all();
  return new Map(
    (result.results || []).map((column) => [
      String(column.name || ""),
      {
        type: String(column.type || "").toUpperCase(),
        pk: Number(column.pk || 0) === 1
      }
    ])
  );
}

export async function ensureSupportMessageSchema(db) {
  let schema = await messageSchema(db);
  if (!schema.size) throw new Error("support_messages table is missing from Well Support D1.");

  for (const [name, type] of Object.entries(SUPPORT_MESSAGE_COLUMNS)) {
    if (schema.has(name)) continue;
    await db.prepare(`ALTER TABLE support_messages ADD COLUMN ${name} ${type}`).run().catch((error) => {
      if (!/duplicate column/i.test(String(error?.message || ""))) throw error;
    });
  }

  schema = await messageSchema(db);
  for (const required of ["conversation_id", "sender_type", "body", "created_at"]) {
    if (!schema.has(required)) throw new Error(`support_messages.${required} is required for live support.`);
  }

  await db.prepare("CREATE INDEX IF NOT EXISTS support_messages_conversation_created_idx ON support_messages(conversation_id, created_at)").run().catch(() => {});
  await db.prepare("CREATE INDEX IF NOT EXISTS support_messages_client_message_idx ON support_messages(conversation_id, client_message_id)").run().catch(() => {});
  return schema;
}

export async function findSupportMessageByClientId(db, conversationId, clientMessageId, senderType = "") {
  if (!clientMessageId) return null;
  const schema = await ensureSupportMessageSchema(db);
  if (!schema.has("client_message_id")) return null;
  const senderFilter = senderType && schema.has("sender_type") ? " AND sender_type = ?" : "";
  const statement = db.prepare(`SELECT * FROM support_messages WHERE conversation_id = ? AND client_message_id = ?${senderFilter} LIMIT 1`);
  return senderFilter
    ? statement.bind(conversationId, clientMessageId, senderType).first()
    : statement.bind(conversationId, clientMessageId).first();
}

export async function insertSupportMessage(db, message) {
  const schema = await ensureSupportMessageSchema(db);
  const values = {
    id: message.id || crypto.randomUUID(),
    conversation_id: message.conversation_id,
    sender_type: message.sender_type,
    sender_user_id: message.sender_user_id ?? null,
    sender_display_name: message.sender_display_name ?? null,
    sender_avatar_url: message.sender_avatar_url ?? null,
    client_message_id: message.client_message_id ?? null,
    body: message.body,
    created_at: message.created_at || new Date().toISOString()
  };
  const columns = [];
  const bindings = [];
  for (const [name, value] of Object.entries(values)) {
    const info = schema.get(name);
    if (!info) continue;
    if (name === "id" && info.pk && /INT/.test(info.type)) continue;
    columns.push(name);
    bindings.push(value);
  }
  const result = await db.prepare(`INSERT INTO support_messages (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).bind(...bindings).run();
  let row = null;
  if (columns.includes("id")) {
    row = await db.prepare("SELECT * FROM support_messages WHERE id = ? LIMIT 1").bind(values.id).first();
  } else if (result?.meta?.last_row_id != null) {
    row = await db.prepare("SELECT * FROM support_messages WHERE rowid = ? LIMIT 1").bind(result.meta.last_row_id).first();
  }
  if (!row && values.client_message_id) {
    row = await findSupportMessageByClientId(db, values.conversation_id, values.client_message_id, values.sender_type);
  }
  if (!row) {
    row = await db.prepare("SELECT * FROM support_messages WHERE conversation_id = ? AND sender_type = ? AND body = ? ORDER BY created_at DESC LIMIT 1").bind(values.conversation_id, values.sender_type, values.body).first();
  }
  return row || values;
}
