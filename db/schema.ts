import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';

// Only anonymous access handles and usage counts live here. Profile evidence,
// original documents and approvals retain their existing Supabase storage.
export const visitorSessions=sqliteTable('career_visitor_sessions',{
  tokenHash:text('token_hash').primaryKey(),
  owner:text('owner').notNull().unique(),
  expiresAt:integer('expires_at').notNull(),
},table=>[index('career_visitor_expiry').on(table.expiresAt)]);

export const visitorUsage=sqliteTable('career_visitor_usage',{
  bucket:text('bucket').primaryKey(),
  used:integer('used').notNull(),
  expiresAt:integer('expires_at').notNull(),
},table=>[index('career_visitor_usage_expiry').on(table.expiresAt)]);
