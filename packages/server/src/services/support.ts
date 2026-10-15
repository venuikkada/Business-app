import type { Tenant } from "../context";
import { AppError, notFound } from "../errors";
import { camelize } from "../util";

export async function listSupportTickets(t: Tenant) {
  return camelize(await t.db.query("select st.*, (select count(*)::int from support_ticket_messages m where m.ticket_id = st.id) as messages from support_tickets st order by updated_at desc limit 50"));
}

export async function createSupportTicket(t: Tenant, subject: string, body: string) {
  if (!subject || subject.trim().length < 3 || !body || body.trim().length < 3) throw new AppError("VALIDATION", "Enter a subject and a message");
  const priority = t.hasFeature("priority_support") ? "high" : "normal";
  const r = await t.db.one<{ id: string }>("insert into support_tickets(business_id, created_by, subject, priority) values ($1,$2,$3,$4) returning id", [t.businessId, t.userId, subject.trim().slice(0, 200), priority]);
  await t.db.exec("insert into support_ticket_messages(business_id, ticket_id, author_user_id, body) values ($1,$2,$3,$4)", [t.businessId, r.id, t.userId, body.trim().slice(0, 5000)]);
  return r;
}

export async function getSupportTicket(t: Tenant, id: string) {
  const tk = await t.db.maybe("select * from support_tickets where id = $1", [id]);
  if (!tk) throw notFound("Support ticket");
  const msgs = await t.db.query("select m.id, m.body, m.is_staff, m.created_at, u.full_name as author from support_ticket_messages m left join users u on u.id = m.author_user_id where m.ticket_id = $1 order by m.created_at", [id]);
  return { ...camelize<Record<string, unknown>>(tk), messages: camelize(msgs) };
}

export async function replySupportTicket(t: Tenant, id: string, body: string) {
  if (!body || body.trim().length < 1) throw new AppError("VALIDATION", "Enter a message");
  const tk = await t.db.maybe("select 1 from support_tickets where id = $1", [id]);
  if (!tk) throw notFound("Support ticket");
  await t.db.exec("insert into support_ticket_messages(business_id, ticket_id, author_user_id, body) values ($1,$2,$3,$4)", [t.businessId, id, t.userId, body.trim().slice(0, 5000)]);
  await t.db.exec("update support_tickets set status = 'open' where id = $1", [id]);
}
